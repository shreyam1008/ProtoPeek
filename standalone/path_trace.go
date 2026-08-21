package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/netpath"
	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

const maxPathTraceBodyBytes = 32 << 10

type pathService interface {
	Capabilities(context.Context) netpath.CapabilitiesResponse
	Trace(context.Context, netpath.Request) (netpath.Response, error)
}

// PathCapabilitiesHandler returns the no-probe GET capability endpoint. The
// handler performs only local socket capability checks.
func PathCapabilitiesHandler() http.HandlerFunc {
	return pathCapabilitiesHandler(defaultPathService())
}

// PathTraceHandler returns the bounded active-probe endpoint. The caller must
// enforce ProtoPeek's local-access, CSRF, and process-admission policy.
func PathTraceHandler() http.HandlerFunc {
	return pathTraceHandler(defaultPathService())
}

func defaultPathService() *netpath.Engine {
	return netpath.NewEngine(net.DefaultResolver, netroute.Lookup, netpath.NewNativeBackend())
}

func pathCapabilitiesHandler(service pathService) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", http.MethodGet)
			http.Error(writer, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(writer).Encode(service.Capabilities(request.Context()))
	}
}

func pathTraceHandler(service pathService) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		if request.Method != http.MethodPost {
			writer.Header().Set("Allow", http.MethodPost)
			http.Error(writer, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		if request.ContentLength > maxPathTraceBodyBytes {
			http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
			return
		}

		var input netpath.Request
		if !decodeJSONRequest(writer, request, maxPathTraceBodyBytes, &input) {
			return
		}
		response, err := service.Trace(request.Context(), input)
		if err != nil {
			http.Error(writer, err.Error(), pathTraceErrorStatus(err))
			return
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(writer).Encode(response)
	}
}

func pathTraceErrorStatus(err error) int {
	switch {
	case errors.Is(err, context.Canceled):
		return 499
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout
	case errors.Is(err, netpath.ErrInvalidRequest):
		return http.StatusBadRequest
	case errors.Is(err, netpath.ErrConsentRequired):
		return http.StatusForbidden
	case errors.Is(err, netpath.ErrUnsupported):
		return http.StatusNotImplemented
	case errors.Is(err, netpath.ErrResolve):
		return http.StatusBadGateway
	default:
		return http.StatusServiceUnavailable
	}
}
