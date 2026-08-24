package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

const (
	maxTransferAddBodyBytes    = 144 << 10
	maxTransferBatchBodyBytes  = 1 << 20
	maxTransferActionBodyBytes = 1 << 10
	maxTransferImportBodyBytes = 2 << 10
	maxTransferConfigBodyBytes = 16 << 10
	maxConcurrentTransferOps   = 2
)

// TransferService is the process-scoped downloader contract injected into the
// standalone console. Both browser handlers and CLI commands use the same
// internal/transfer service implementation rather than duplicating state.
type TransferService interface {
	Snapshot(context.Context) (transfer.Snapshot, error)
	Start(context.Context) (transfer.Health, error)
	Add(context.Context, transfer.AddRequest) (transfer.AddResult, error)
	Pause(context.Context, string) error
	Resume(context.Context, string) error
	Retry(context.Context, string) (transfer.AddResult, error)
	Cancel(context.Context, string) error
	Shutdown(context.Context) error
}

// transferHostConfigService is deliberately optional so existing embedders
// that provide only the queue contract keep compiling. The process-scoped
// internal/transfer.Service implements this stronger host-settings contract.
type transferHostConfigService interface {
	ConfigureAndSavePatch(string, transfer.HostConfigPatch) (transfer.HostConfig, string, error)
}

type transferHostConfigResponse struct {
	transfer.HostConfig
	ConfigRevision string `json:"configRevision"`
	Warning        string `json:"warning,omitempty"`
}

type goBarryMigrationService interface {
	PreviewGoBarry(context.Context) (transfer.GoBarryMigrationPreview, error)
	ImportGoBarry(context.Context, transfer.GoBarryImportRequest) (transfer.GoBarryImportResult, error)
	RollbackGoBarry(context.Context, transfer.GoBarryRollbackRequest) (transfer.GoBarryRollbackResult, error)
}

type transferBatchService interface {
	AddBatch(context.Context, transfer.BatchAddRequest) (transfer.BatchAddResult, error)
}

type transferGlobalControlService interface {
	PauseAll(context.Context) error
	ResumeAll(context.Context) error
}

func registerTransferHandlers(mux *http.ServeMux, service TransferService) {
	if service == nil {
		return
	}
	admission := newAdmissionLimiter(maxConcurrentTransferOps)

	mux.HandleFunc("/api/transfers/snapshot", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", http.MethodGet)
			http.Error(writer, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		snapshot, err := service.Snapshot(request.Context())
		if err != nil && snapshot.Health.Status != "unavailable" {
			writeTransferError(writer, err, http.StatusServiceUnavailable)
			return
		}
		writeTransferJSON(writer, http.StatusOK, snapshot)
	})

	registerTransferPOST(mux, admission, "/api/transfers/start", "transfer start", func(writer http.ResponseWriter, request *http.Request) {
		if !requireEmptyTransferBody(writer, request) {
			return
		}
		health, err := service.Start(request.Context())
		if err != nil {
			writeTransferError(writer, err, http.StatusInternalServerError)
			return
		}
		writeTransferJSON(writer, http.StatusOK, health)
	})

	if hostConfig, ok := service.(transferHostConfigService); ok {
		registerTransferConfigPOST(mux, admission, "/api/transfers/config", "transfer host configuration", func(writer http.ResponseWriter, request *http.Request) {
			var input transfer.HostConfigPatchRequest
			if !decodeStrictTransferJSON(writer, request, maxTransferConfigBodyBytes, &input) {
				return
			}
			if err := transfer.ValidateHostConfigPatch(input.HostConfigPatch); err != nil {
				http.Error(writer, "Invalid transfer host configuration", http.StatusBadRequest)
				return
			}
			if err := transfer.ValidateHostConfigRevision(input.ExpectedRevision); err != nil {
				writeTransferError(writer, err, http.StatusBadRequest)
				return
			}
			config, revision, err := hostConfig.ConfigureAndSavePatch(input.ExpectedRevision, input.HostConfigPatch)
			if err != nil {
				var committed *transfer.ConfigCommitError
				if errors.As(err, &committed) {
					writeTransferJSON(writer, http.StatusOK, transferHostConfigResponse{
						HostConfig:     config,
						ConfigRevision: revision,
						Warning:        "Host settings were saved, but directory durability could not be confirmed. Reload before starting the Downloader.",
					})
					return
				}
				writeTransferError(writer, err, http.StatusInternalServerError)
				return
			}
			writeTransferJSON(writer, http.StatusOK, transferHostConfigResponse{
				HostConfig:     config,
				ConfigRevision: revision,
			})
		})
	}

	registerTransferPOST(mux, admission, "/api/transfers/add", "transfer add", func(writer http.ResponseWriter, request *http.Request) {
		var input transfer.AddRequest
		if !decodeStrictTransferJSON(writer, request, maxTransferAddBodyBytes, &input) {
			return
		}
		result, err := service.Add(request.Context(), input)
		if err != nil {
			writeTransferError(writer, err, http.StatusInternalServerError)
			return
		}
		writeTransferJSON(writer, http.StatusCreated, result)
	})

	if batch, ok := service.(transferBatchService); ok {
		registerTransferPOST(mux, admission, "/api/transfers/batch", "transfer batch add", func(writer http.ResponseWriter, request *http.Request) {
			var input transfer.BatchAddRequest
			if !decodeStrictTransferJSON(writer, request, maxTransferBatchBodyBytes, &input) {
				return
			}
			result, err := batch.AddBatch(request.Context(), input)
			if err != nil {
				writeTransferError(writer, err, http.StatusBadRequest)
				return
			}
			status := http.StatusCreated
			if result.FailedCount > 0 {
				status = http.StatusMultiStatus
			}
			writeTransferJSON(writer, status, result)
		})
	}

	if controls, ok := service.(transferGlobalControlService); ok {
		for _, action := range []struct {
			name string
			call func(context.Context) error
		}{
			{name: "pause-all", call: controls.PauseAll},
			{name: "resume-all", call: controls.ResumeAll},
		} {
			action := action
			registerTransferPOST(mux, admission, "/api/transfers/"+action.name, "transfer "+action.name, func(writer http.ResponseWriter, request *http.Request) {
				if !requireEmptyTransferBody(writer, request) {
					return
				}
				if err := action.call(request.Context()); err != nil {
					if errors.Is(err, transfer.ErrQueueStateNotPersisted) {
						writeTransferJSON(writer, http.StatusOK, transfer.MutationResult{PersistenceWarning: transfer.PersistenceWarningMessage})
						return
					}
					writeTransferError(writer, err, http.StatusConflict)
					return
				}
				writer.WriteHeader(http.StatusNoContent)
			})
		}
	}

	if migration, ok := service.(goBarryMigrationService); ok {
		registerTransferPOST(mux, admission, "/api/transfers/migrations/gobarry/preview", "GoBarryGo state preview", func(writer http.ResponseWriter, request *http.Request) {
			if !requireEmptyTransferBody(writer, request) {
				return
			}
			preview, err := migration.PreviewGoBarry(request.Context())
			if err != nil {
				writeGoBarryMigrationError(writer, err, false)
				return
			}
			writeTransferJSON(writer, http.StatusOK, preview)
		})
		registerTransferPOST(mux, admission, "/api/transfers/migrations/gobarry/import", "GoBarryGo state import", func(writer http.ResponseWriter, request *http.Request) {
			var input transfer.GoBarryImportRequest
			if !decodeStrictTransferJSON(writer, request, maxTransferImportBodyBytes, &input) {
				return
			}
			if err := transfer.ValidateGoBarryPreviewRevision(input.ExpectedRevision); err != nil {
				writeGoBarryMigrationError(writer, err, false)
				return
			}
			result, err := migration.ImportGoBarry(request.Context(), input)
			if err != nil {
				writeGoBarryMigrationError(writer, err, false)
				return
			}
			writeTransferJSON(writer, http.StatusOK, result)
		})
		registerTransferPOST(mux, admission, "/api/transfers/migrations/gobarry/rollback", "GoBarryGo state rollback", func(writer http.ResponseWriter, request *http.Request) {
			var input transfer.GoBarryRollbackRequest
			if !decodeStrictTransferJSON(writer, request, maxTransferImportBodyBytes, &input) {
				return
			}
			result, err := migration.RollbackGoBarry(request.Context(), input)
			if err != nil {
				writeGoBarryMigrationError(writer, err, true)
				return
			}
			writeTransferJSON(writer, http.StatusOK, result)
		})
	}

	for _, action := range []struct {
		name string
		call func(context.Context, string) (any, error)
	}{
		{name: "pause", call: func(ctx context.Context, id string) (any, error) { return nil, service.Pause(ctx, id) }},
		{name: "resume", call: func(ctx context.Context, id string) (any, error) { return nil, service.Resume(ctx, id) }},
		{name: "retry", call: func(ctx context.Context, id string) (any, error) { return service.Retry(ctx, id) }},
		{name: "cancel", call: func(ctx context.Context, id string) (any, error) { return nil, service.Cancel(ctx, id) }},
	} {
		action := action
		registerTransferPOST(mux, admission, "/api/transfers/"+action.name, "transfer "+action.name, func(writer http.ResponseWriter, request *http.Request) {
			var input struct {
				ID string `json:"id"`
			}
			if !decodeStrictTransferJSON(writer, request, maxTransferActionBodyBytes, &input) {
				return
			}
			input.ID = strings.TrimSpace(input.ID)
			if !validTransferID(input.ID) {
				http.Error(writer, "Invalid transfer job id", http.StatusBadRequest)
				return
			}
			result, err := action.call(request.Context(), input.ID)
			if err != nil {
				if errors.Is(err, transfer.ErrQueueStateNotPersisted) {
					writeTransferJSON(writer, http.StatusOK, transfer.MutationResult{PersistenceWarning: transfer.PersistenceWarningMessage})
					return
				}
				writeTransferError(writer, err, http.StatusConflict)
				return
			}
			if result == nil {
				writer.WriteHeader(http.StatusNoContent)
				return
			}
			writeTransferJSON(writer, http.StatusOK, result)
		})
	}
}

func writeGoBarryMigrationError(writer http.ResponseWriter, err error, rollingBack bool) {
	status := http.StatusInternalServerError
	message := "GoBarryGo state could not be inspected or imported safely"
	if rollingBack {
		message = "Rollback did not finish cleanly. ProtoPeek state may already have been restored. Retry the same receipt so any retained recovery journal can finish safely"
	}
	switch {
	case errors.Is(err, context.Canceled):
		status = 499
		message = "GoBarryGo state operation cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = "GoBarryGo state operation timed out"
	case errors.Is(err, transfer.ErrGoBarryNotFound):
		status = http.StatusNotFound
		message = "No GoBarryGo preferences or resumable session were found"
	case errors.Is(err, transfer.ErrGoBarryUnsafeState):
		status = http.StatusUnprocessableEntity
		message = "GoBarryGo state failed the bounded migration safety checks"
	case errors.Is(err, transfer.ErrGoBarryImportActive):
		status = http.StatusConflict
		if rollingBack {
			message = "Stop the Downloader before rolling back GoBarryGo state"
		} else {
			message = "Stop the Downloader before importing GoBarryGo state"
		}
	case errors.Is(err, transfer.ErrGoBarryPreviewRevision):
		status = http.StatusBadRequest
		message = "A valid GoBarryGo migration preview revision is required"
	case errors.Is(err, transfer.ErrGoBarryPreviewConflict):
		status = http.StatusConflict
		message = "GoBarryGo or ProtoPeek transfer state changed after this preview; check again before importing"
	case errors.Is(err, transfer.ErrGoBarryRollbackConflict):
		status = http.StatusConflict
		message = "ProtoPeek transfer state changed after this migration; rollback was refused and current files were preserved"
	case strings.Contains(err.Error(), "confirm that GoBarryGo source files will be preserved") || strings.Contains(err.Error(), "confirm that rollback must refuse changed ProtoPeek state") || strings.Contains(err.Error(), "select preferences, session, or both") || strings.Contains(err.Error(), "were not found") || strings.Contains(err.Error(), "receipt id"):
		status = http.StatusBadRequest
		message = err.Error()
	}
	http.Error(writer, message, status)
}

func registerTransferPOST(mux *http.ServeMux, admission *admissionLimiter, route, operation string, handler http.HandlerFunc) {
	mux.HandleFunc(route, func(writer http.ResponseWriter, request *http.Request) {
		// Authentication and method checks happen before admission is consumed and
		// before any request body is read.
		if !validateAdmittedPOST(writer, request) {
			return
		}
		admission.serveHTTP(operation, writer, request, handler)
	})
}

// Host configuration controls executable paths, filesystem paths, and process
// policy. It remains loopback-only even when the console's general unsafe
// remote mode is enabled. This direct-console endpoint does not support
// reverse proxies: forwarding headers are rejected. The peer and header checks
// happen before admission and before the request body can be read.
func registerTransferConfigPOST(mux *http.ServeMux, admission *admissionLimiter, route, operation string, handler http.HandlerFunc) {
	mux.HandleFunc(route, func(writer http.ResponseWriter, request *http.Request) {
		if !validateLoopbackAdmittedPOST(writer, request) {
			return
		}
		admission.serveHTTP(operation, writer, request, handler)
	})
}

func validateLoopbackAdmittedPOST(writer http.ResponseWriter, request *http.Request) bool {
	if !validateAdmittedPOST(writer, request) {
		return false
	}
	if hasForwardingHeaders(request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		http.Error(writer, "Host configuration changes do not support reverse-proxy forwarding", http.StatusForbidden)
		return false
	}
	if !isLoopbackPeer(request.RemoteAddr) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		http.Error(writer, "Host configuration changes require a loopback browser connection", http.StatusForbidden)
		return false
	}
	return true
}

var hostConfigForwardingHeaders = [...]string{
	"Forwarded",
	"X-Forwarded-For",
	"X-Real-IP",
	"X-Forwarded-Host",
	"X-Forwarded-Proto",
}

func hasForwardingHeaders(request *http.Request) bool {
	for key := range request.Header {
		for _, forwardingHeader := range hostConfigForwardingHeaders {
			if strings.EqualFold(key, forwardingHeader) {
				return true
			}
		}
	}
	return false
}

func isLoopbackPeer(remoteAddr string) bool {
	remoteAddr = strings.TrimSpace(remoteAddr)
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil || host == "" {
		return false
	}
	// This is intentionally derived only from the direct transport peer. No
	// forwarded header, Host value, or unsafe-remote setting can grant trust.
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func requireEmptyTransferBody(writer http.ResponseWriter, request *http.Request) bool {
	if request.ContentLength > 0 {
		http.Error(writer, "This transfer action does not accept a request body", http.StatusBadRequest)
		return false
	}
	if request.Body == nil {
		return true
	}
	var first [1]byte
	count, err := request.Body.Read(first[:])
	if count != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		http.Error(writer, "This transfer action does not accept a request body", http.StatusBadRequest)
		return false
	}
	return true
}

func decodeStrictTransferJSON(writer http.ResponseWriter, request *http.Request, maxBytes int64, destination any) bool {
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(contentType, "application/json") {
		http.Error(writer, "Request must use application/json", http.StatusUnsupportedMediaType)
		return false
	}
	if request.ContentLength > maxBytes {
		http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
		return false
	}
	if request.Body == nil {
		http.Error(writer, "Invalid JSON body", http.StatusBadRequest)
		return false
	}
	data, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxBytes))
	if err != nil {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(writer, "Invalid JSON body", http.StatusBadRequest)
		return false
	}
	if err := transfer.DecodeStrictJSON(data, destination); err != nil {
		if strings.Contains(err.Error(), "multiple JSON values") || strings.Contains(err.Error(), "trailing") {
			http.Error(writer, "Request body must contain one JSON object", http.StatusBadRequest)
			return false
		}
		http.Error(writer, "Invalid JSON body", http.StatusBadRequest)
		return false
	}
	return true
}

func writeTransferJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeTransferError(writer http.ResponseWriter, err error, fallbackStatus int) {
	status := fallbackStatus
	message := "Transfer operation failed"
	switch {
	case errors.Is(err, transfer.ErrLockHeld):
		status = http.StatusLocked
		message = "Another ProtoPeek process already owns the downloader"
	case errors.Is(err, transfer.ErrAria2NotFound):
		status = http.StatusServiceUnavailable
		message = "aria2c was not found; install it or configure its executable path"
	case errors.Is(err, transfer.ErrInvalidAddRequest), errors.Is(err, transfer.ErrInvalidBatchRequest):
		status = http.StatusBadRequest
		message = "Invalid transfer request"
	case errors.Is(err, transfer.ErrInvalidHostConfig):
		status = http.StatusBadRequest
		message = "Invalid transfer host configuration"
	case errors.Is(err, transfer.ErrHostConfigRunning):
		status = http.StatusConflict
		message = "Stop the downloader before changing host configuration"
	case errors.Is(err, transfer.ErrHostConfigConflict):
		status = http.StatusConflict
		message = "Host settings changed on this host; reload before saving"
	case errors.Is(err, transfer.ErrHostConfigRevision):
		status = http.StatusBadRequest
		message = "A valid host-settings revision is required"
	case errors.Is(err, transfer.ErrEngineNotRunning), errors.Is(err, transfer.ErrAlreadyStarting), errors.Is(err, transfer.ErrQueueFull):
		status = http.StatusConflict
		message = "The downloader cannot perform that operation in its current state"
	case errors.Is(err, transfer.ErrRetryMetadataMissing):
		status = http.StatusConflict
		message = "Exact retry options are unavailable; queue a new job and re-enter any required headers"
	case errors.Is(err, transfer.ErrQueueStateNotPersisted):
		status = http.StatusConflict
		message = "The transfer action may have changed state; refresh before retrying"
	case errors.Is(err, transfer.ErrInsufficientDisk):
		status = http.StatusInsufficientStorage
		message = "The download directory is below its configured free-space reserve"
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
		message = "Transfer operation cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = "Transfer operation timed out"
	default:
		var rpcError *transfer.RPCError
		if errors.As(err, &rpcError) {
			status = http.StatusConflict
			message = "aria2c rejected the transfer operation"
		} else {
			switch fallbackStatus {
			case http.StatusBadRequest:
				message = "Invalid transfer request"
			case http.StatusConflict:
				message = "The transfer operation conflicts with current downloader state"
			case http.StatusServiceUnavailable:
				message = "Transfer state is temporarily unavailable"
			}
		}
	}
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	http.Error(writer, message, status)
}

func validTransferID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, character := range id {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
