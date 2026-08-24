package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/thispc"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

const (
	maxThisPCRequestBodyBytes = 2 << 10
	maxConcurrentThisPCOps    = 2
)

// ThisPCService is injected only by the local CLI/browser mode. A standalone
// embedder must opt in explicitly; a nil service mounts no This PC routes.
type ThisPCService interface {
	Capabilities(context.Context) thispc.Capabilities
	Snapshot(context.Context) (thispc.Snapshot, error)
	Activity(context.Context) (thispc.Activity, error)
	SampleTraffic(context.Context, time.Duration) (thispc.TrafficSample, error)
	PublicIdentity(context.Context, []string) (thispc.PublicIdentity, error)
}

func registerThisPCHandlers(mux *http.ServeMux, service ThisPCService) {
	if service == nil {
		return
	}
	admission := newThisPCAdmissionLimiter(maxConcurrentThisPCOps)

	registerThisPCGET(mux, "/api/this-pc/capabilities", func(writer http.ResponseWriter, request *http.Request) {
		writeThisPCJSON(writer, http.StatusOK, service.Capabilities(request.Context()))
	})
	registerThisPCGET(mux, "/api/this-pc/snapshot", func(writer http.ResponseWriter, request *http.Request) {
		result, err := service.Snapshot(request.Context())
		if err != nil {
			writeThisPCServiceError(writer, err, "Local snapshot failed")
			return
		}
		writeThisPCSnapshotJSON(writer, result)
	})

	registerThisPCPOST(mux, admission, "/api/this-pc/activity", "local activity inspection", func(writer http.ResponseWriter, request *http.Request) {
		var input struct {
			AcknowledgeLocalInspection bool `json:"acknowledgeLocalInspection"`
		}
		if !decodeStrictThisPCJSON(writer, request, &input) {
			return
		}
		if !input.AcknowledgeLocalInspection {
			writeThisPCError(writer, http.StatusBadRequest, "acknowledgeLocalInspection must be true")
			return
		}
		result, err := service.Activity(request.Context())
		if err != nil {
			writeThisPCServiceError(writer, err, "Local activity inspection failed")
			return
		}
		writeThisPCActivityJSON(writer, result)
	})

	registerThisPCPOST(mux, admission, "/api/this-pc/traffic/sample", "traffic sampling", func(writer http.ResponseWriter, request *http.Request) {
		var input struct {
			DurationMS int `json:"durationMs"`
		}
		if !decodeStrictThisPCJSON(writer, request, &input) {
			return
		}
		if input.DurationMS != 500 && input.DurationMS != 1000 && input.DurationMS != 2000 {
			writeThisPCError(writer, http.StatusBadRequest, "durationMs must be exactly 500, 1000, or 2000")
			return
		}
		result, err := service.SampleTraffic(request.Context(), time.Duration(input.DurationMS)*time.Millisecond)
		if err != nil {
			writeThisPCServiceError(writer, err, "Traffic sample failed")
			return
		}
		writeThisPCJSON(writer, http.StatusOK, result)
	})

	registerThisPCPOST(mux, admission, "/api/this-pc/public", "public identity observation", func(writer http.ResponseWriter, request *http.Request) {
		var input struct {
			AcknowledgeExternalRequest bool     `json:"acknowledgeExternalRequest"`
			Families                   []string `json:"families"`
		}
		if !decodeStrictThisPCJSON(writer, request, &input) {
			return
		}
		if !input.AcknowledgeExternalRequest {
			writeThisPCError(writer, http.StatusBadRequest, "acknowledgeExternalRequest must be true")
			return
		}
		result, err := service.PublicIdentity(request.Context(), input.Families)
		if err != nil {
			writeThisPCServiceError(writer, err, "Public identity request failed")
			return
		}
		writeThisPCJSON(writer, http.StatusOK, result)
	})
}

func registerThisPCGET(mux *http.ServeMux, route string, handler http.HandlerFunc) {
	mux.HandleFunc(route, func(writer http.ResponseWriter, request *http.Request) {
		setThisPCHeaders(writer)
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", http.MethodGet)
			writeThisPCError(writer, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		handler(writer, request)
	})
}

type thisPCAdmissionLimiter struct {
	slots chan struct{}
}

func newThisPCAdmissionLimiter(limit int) *thisPCAdmissionLimiter {
	return &thisPCAdmissionLimiter{slots: make(chan struct{}, limit)}
}

func (limiter *thisPCAdmissionLimiter) serveHTTP(operation string, writer http.ResponseWriter, request *http.Request, next http.Handler) {
	select {
	case limiter.slots <- struct{}{}:
		defer func() { <-limiter.slots }()
		next.ServeHTTP(writer, request)
	default:
		writer.Header().Set("Retry-After", "1")
		writeThisPCError(writer, http.StatusTooManyRequests, operation+" capacity is busy; retry shortly")
	}
}

func registerThisPCPOST(mux *http.ServeMux, admission *thisPCAdmissionLimiter, route, operation string, handler http.HandlerFunc) {
	mux.HandleFunc(route, func(writer http.ResponseWriter, request *http.Request) {
		setThisPCHeaders(writer)
		if request.Method != http.MethodPost {
			writer.Header().Set("Allow", http.MethodPost)
			writeThisPCError(writer, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		if !validCSRF(request) {
			writeThisPCError(writer, http.StatusUnauthorized, "incorrect CSRF token")
			return
		}
		admission.serveHTTP(operation, writer, request, handler)
	})
}

func decodeStrictThisPCJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(contentType, "application/json") {
		writeThisPCError(writer, http.StatusUnsupportedMediaType, "Request must use application/json")
		return false
	}
	if request.ContentLength > maxThisPCRequestBodyBytes {
		writeThisPCError(writer, http.StatusRequestEntityTooLarge, "Request body is too large")
		return false
	}
	request.Body = http.MaxBytesReader(writer, request.Body, maxThisPCRequestBodyBytes)
	data, err := io.ReadAll(request.Body)
	if err != nil {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			writeThisPCError(writer, http.StatusRequestEntityTooLarge, "Request body is too large")
			return false
		}
		writeThisPCError(writer, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	if err := transfer.DecodeStrictJSON(data, destination); err != nil {
		if strings.Contains(err.Error(), "multiple JSON values") || strings.Contains(err.Error(), "trailer") {
			writeThisPCError(writer, http.StatusBadRequest, "Request body must contain one JSON object")
			return false
		}
		writeThisPCError(writer, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	return true
}

func setThisPCHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func writeThisPCJSON(writer http.ResponseWriter, status int, value any) {
	setThisPCHeaders(writer)
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeThisPCActivityJSON(writer http.ResponseWriter, value thispc.Activity) {
	value = thispc.BoundActivityResponse(value)
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded)+1 > thispc.MaxEncodedActivityResponseBytes {
		writeThisPCError(writer, http.StatusInternalServerError, "Activity response could not be encoded within its safety limit")
		return
	}
	setThisPCHeaders(writer)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(encoded)
	_, _ = writer.Write([]byte("\n"))
}

func writeThisPCSnapshotJSON(writer http.ResponseWriter, value thispc.Snapshot) {
	value = thispc.BoundSnapshotResponse(value)
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded)+1 > thispc.MaxEncodedSnapshotResponseBytes {
		writeThisPCError(writer, http.StatusInternalServerError, "Snapshot response could not be encoded within its safety limit")
		return
	}
	setThisPCHeaders(writer)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(encoded)
	_, _ = writer.Write([]byte("\n"))
}

func writeThisPCError(writer http.ResponseWriter, status int, message string) {
	writeThisPCJSON(writer, status, struct {
		SchemaVersion int    `json:"schemaVersion"`
		Error         string `json:"error"`
	}{SchemaVersion: thispc.SchemaVersion, Error: message})
}

func writeThisPCServiceError(writer http.ResponseWriter, err error, fallback string) {
	status := http.StatusServiceUnavailable
	message := fallback
	switch {
	case errors.Is(err, thispc.ErrInvalidDuration), errors.Is(err, thispc.ErrInvalidFamily):
		status = http.StatusBadRequest
		message = err.Error()
	case errors.Is(err, thispc.ErrActivityUnsupported), errors.Is(err, thispc.ErrTrafficUnsupported):
		status = http.StatusNotImplemented
		message = err.Error()
	case errors.Is(err, context.Canceled):
		status = 499
		message = fallback + ": cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = fallback + ": timed out"
	}
	writeThisPCError(writer, status, message)
}
