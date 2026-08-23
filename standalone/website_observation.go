package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"github.com/shreyam1008/ProtoPeek/internal/webobserve"
)

const (
	maxWebsiteObservationBodyBytes = 8 << 10
	maxWebsiteObservationURLBytes  = 8 << 10
)

type WebsiteObserver interface {
	Observe(context.Context, string) (webobserve.Result, error)
}

type WebsiteObservationRequest struct {
	URL                      string `json:"url"`
	AcknowledgePublicRequest bool   `json:"acknowledgePublicRequest"`
}

// WebsiteObservationHandler is the self-contained POST+CSRF form. Use the
// operation handler behind a shared admission limiter when wiring it into the
// application mux.
func WebsiteObservationHandler(observer WebsiteObserver) http.Handler {
	operation := WebsiteObservationOperationHandler(observer)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		setWebsiteObservationHeaders(writer)
		if !validateAdmittedPOST(writer, request) {
			return
		}
		operation.ServeHTTP(writer, request)
	})
}

// WebsiteObservationOperationHandler assumes POST and CSRF were already
// admitted. It performs no I/O before the bounded body and explicit consent
// have been validated.
func WebsiteObservationOperationHandler(observer WebsiteObserver) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		setWebsiteObservationHeaders(writer)
		if observer == nil {
			http.Error(writer, "Website observation is unavailable", http.StatusServiceUnavailable)
			return
		}
		var input WebsiteObservationRequest
		if !decodeJSONRequest(writer, request, maxWebsiteObservationBodyBytes, &input) {
			return
		}
		if !input.AcknowledgePublicRequest {
			http.Error(
				writer,
				"acknowledgePublicRequest must be true because this makes one HEAD request from the ProtoPeek host",
				http.StatusBadRequest,
			)
			return
		}
		target := strings.TrimSpace(input.URL)
		if target == "" {
			http.Error(writer, "url is required", http.StatusBadRequest)
			return
		}
		if len(target) > maxWebsiteObservationURLBytes {
			http.Error(writer, "url is too long", http.StatusBadRequest)
			return
		}

		result, err := observer.Observe(request.Context(), target)
		if err != nil {
			writeWebsiteObservationError(writer, err)
			return
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(writer).Encode(result)
	})
}

func setWebsiteObservationHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func writeWebsiteObservationError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		http.Error(writer, "Website observation cancelled", 499)
	case errors.Is(err, context.DeadlineExceeded):
		http.Error(writer, "Website observation timed out", http.StatusGatewayTimeout)
	case errors.Is(err, targetguard.ErrInvalidTarget),
		errors.Is(err, targetguard.ErrAddressBlocked),
		errors.Is(err, targetguard.ErrTooManyAddresses):
		http.Error(
			writer,
			"URL must be absolute HTTP(S), contain no credentials, query, or fragment, and resolve only to ordinary public addresses",
			http.StatusBadRequest,
		)
	default:
		http.Error(writer, "Website observation failed", http.StatusBadGateway)
	}
}
