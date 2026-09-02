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
	"github.com/shreyam1008/ProtoPeek/internal/tunnels"
)

const maxTunnelSnapshotResponseBytes = 512 << 10

const (
	maxTunnelActionRequestBytes = 1024
	maxTunnelOperationResponse  = 32 << 10
)

// TunnelService is injected only by local CLI/browser mode. A nil service
// mounts no tunnel API, keeping this host-inspection surface out of embedders
// and unsafe remote mode by default.
type TunnelService interface {
	Capabilities(context.Context) tunnels.Capabilities
	Snapshot(context.Context) (tunnels.Snapshot, error)
	LatestRelease(context.Context) (tunnels.Release, error)
	ServiceAction(context.Context, tunnels.ServiceActionRequest) (tunnels.ServiceActionResponse, error)
}

func registerTunnelHandlers(mux *http.ServeMux, service TunnelService) {
	if service == nil {
		return
	}
	admission := newAdmissionLimiter(1)
	mux.HandleFunc("/api/tunnels/capabilities", func(writer http.ResponseWriter, request *http.Request) {
		setTunnelHeaders(writer)
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", http.MethodGet)
			writeTunnelError(writer, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		writeTunnelJSON(writer, http.StatusOK, service.Capabilities(request.Context()))
	})
	mux.HandleFunc("/api/tunnels/snapshot", func(writer http.ResponseWriter, request *http.Request) {
		setTunnelHeaders(writer)
		if !validateAdmittedPOST(writer, request) {
			return
		}
		admission.serveHTTP("tunnel snapshot", writer, request, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			value, err := service.Snapshot(request.Context())
			if err != nil {
				writeTunnelServiceError(writer, err, "Tunnel snapshot failed")
				return
			}
			encoded, err := json.Marshal(value)
			if err != nil || len(encoded)+1 > maxTunnelSnapshotResponseBytes {
				writeTunnelError(writer, http.StatusInternalServerError, "Tunnel snapshot could not be encoded within its safety limit")
				return
			}
			setTunnelHeaders(writer)
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(encoded)
			_, _ = writer.Write([]byte("\n"))
		}))
	})
	mux.HandleFunc("/api/tunnels/release", func(writer http.ResponseWriter, request *http.Request) {
		setTunnelHeaders(writer)
		if !validateTunnelPOST(writer, request) || !ensureEmptyTunnelBody(writer, request) {
			return
		}
		admission.serveHTTP("tunnel release check", writer, request, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			value, err := service.LatestRelease(request.Context())
			if err != nil {
				writeTunnelServiceError(writer, err, "Tunnel release check failed")
				return
			}
			writeBoundedTunnelJSON(writer, http.StatusOK, value, maxTunnelOperationResponse, "Tunnel release response could not be encoded within its safety limit")
		}))
	})
	mux.HandleFunc("/api/tunnels/service-action", func(writer http.ResponseWriter, request *http.Request) {
		setTunnelHeaders(writer)
		if !validateTunnelPOST(writer, request) {
			return
		}
		var action tunnels.ServiceActionRequest
		if !decodeStrictTunnelJSON(writer, request, &action) {
			return
		}
		admission.serveHTTP("tunnel service action", writer, request, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			value, err := service.ServiceAction(request.Context(), action)
			if err != nil {
				writeTunnelServiceError(writer, err, "Tunnel service action failed")
				return
			}
			// Stale, elevation-required, not-installed, unchanged, and failed are
			// expected operation outcomes, not transport errors. Keep them parseable.
			writeBoundedTunnelJSON(writer, http.StatusOK, value, maxTunnelOperationResponse, "Tunnel service action response could not be encoded within its safety limit")
		}))
	})
}

func validateTunnelPOST(writer http.ResponseWriter, request *http.Request) bool {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		writeTunnelError(writer, http.StatusMethodNotAllowed, "Method Not Allowed")
		return false
	}
	if !validCSRF(request) {
		writeTunnelError(writer, http.StatusUnauthorized, "incorrect CSRF token")
		return false
	}
	return true
}

func ensureEmptyTunnelBody(writer http.ResponseWriter, request *http.Request) bool {
	if request.ContentLength > 0 {
		writeTunnelError(writer, http.StatusBadRequest, "Request body must be empty")
		return false
	}
	data, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, 1))
	if err != nil || len(data) != 0 {
		writeTunnelError(writer, http.StatusBadRequest, "Request body must be empty")
		return false
	}
	return true
}

func decodeStrictTunnelJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(contentType, "application/json") {
		writeTunnelError(writer, http.StatusUnsupportedMediaType, "Request must use application/json")
		return false
	}
	if request.ContentLength > maxTunnelActionRequestBytes {
		writeTunnelError(writer, http.StatusRequestEntityTooLarge, "Request body is too large")
		return false
	}
	request.Body = http.MaxBytesReader(writer, request.Body, maxTunnelActionRequestBytes)
	data, err := io.ReadAll(request.Body)
	if err != nil {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			writeTunnelError(writer, http.StatusRequestEntityTooLarge, "Request body is too large")
			return false
		}
		writeTunnelError(writer, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	if err := transfer.DecodeStrictJSON(data, destination); err != nil {
		writeTunnelError(writer, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	return true
}

func setTunnelHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func writeTunnelJSON(writer http.ResponseWriter, status int, value any) {
	setTunnelHeaders(writer)
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeBoundedTunnelJSON(writer http.ResponseWriter, status int, value any, maximum int, failure string) {
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded)+1 > maximum {
		writeTunnelError(writer, http.StatusInternalServerError, failure)
		return
	}
	setTunnelHeaders(writer)
	writer.WriteHeader(status)
	_, _ = writer.Write(encoded)
	_, _ = writer.Write([]byte("\n"))
}

func writeTunnelError(writer http.ResponseWriter, status int, message string) {
	writeTunnelJSON(writer, status, struct {
		SchemaVersion int    `json:"schemaVersion"`
		Error         string `json:"error"`
	}{SchemaVersion: tunnels.SchemaVersion, Error: message})
}

func writeTunnelServiceError(writer http.ResponseWriter, err error, fallback string) {
	status := http.StatusServiceUnavailable
	message := fallback
	if errors.Is(err, context.Canceled) {
		status = 499
		message += ": cancelled"
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
		message += ": timed out"
	}
	writeTunnelError(writer, status, message)
}
