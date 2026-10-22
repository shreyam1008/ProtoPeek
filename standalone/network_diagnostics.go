package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/netdiag"
)

func registerDiagnosticsHandlers(mux *http.ServeMux) {
	admission := newAdmissionLimiter(2)
	operation := diagnosticsHandler(netdiag.Engine{})
	registerTransferConfigPOST(mux, admission, "/api/network/diagnostics", "network diagnostic", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		operation(writer, request)
	})
}

func diagnosticsHandler(engine netdiag.Engine) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.ContentLength > 128<<10 {
			http.Error(writer, "Request body is too large", http.StatusRequestEntityTooLarge)
			return
		}
		var input netdiag.Request
		if !decodeJSONRequest(writer, request, 128<<10, &input) {
			return
		}
		result, err := engine.Run(request.Context(), input)
		if err != nil {
			status := http.StatusServiceUnavailable
			if errors.Is(err, netdiag.ErrInvalid) {
				status = http.StatusBadRequest
			}
			if errors.Is(err, context.Canceled) {
				status = 499
			}
			http.Error(writer, err.Error(), status)
			return
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(writer).Encode(result)
	}
}
