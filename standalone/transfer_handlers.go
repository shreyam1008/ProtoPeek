package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

const (
	maxTransferAddBodyBytes    = 144 << 10
	maxTransferActionBodyBytes = 1 << 10
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
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(writer, "Invalid JSON body", http.StatusBadRequest)
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(writer, "Request body must contain one JSON object", http.StatusBadRequest)
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
	case errors.Is(err, transfer.ErrInvalidAddRequest):
		status = http.StatusBadRequest
		message = "Invalid transfer request"
	case errors.Is(err, transfer.ErrEngineNotRunning), errors.Is(err, transfer.ErrAlreadyStarting), errors.Is(err, transfer.ErrQueueFull):
		status = http.StatusConflict
		message = "The downloader cannot perform that operation in its current state"
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
