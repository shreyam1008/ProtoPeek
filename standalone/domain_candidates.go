package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/certnames"
)

const (
	maxDomainCandidatesBodyBytes = 8 << 10
	maxDomainCandidateHostBytes  = 1024
)

// DomainCandidatesSearcher intentionally exposes only the passive historical
// name search. The HTTP boundary cannot resolve or probe returned candidates.
type DomainCandidatesSearcher interface {
	Search(context.Context, string) (certnames.Result, error)
}

type DomainCandidatesRequest struct {
	Host                  string `json:"host"`
	AcknowledgeThirdParty bool   `json:"acknowledgeThirdParty"`
}

// DomainCandidatesHandler returns a self-contained POST+CSRF handler. When the
// endpoint is wired behind an admission limiter, use
// DomainCandidatesOperationHandler so validation can run before taking a slot
// and before reading the body.
func DomainCandidatesHandler(searcher DomainCandidatesSearcher) http.Handler {
	operation := DomainCandidatesOperationHandler(searcher)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		setDomainCandidatesHeaders(writer)
		if !validateAdmittedPOST(writer, request) {
			return
		}
		operation.ServeHTTP(writer, request)
	})
}

// DomainCandidatesOperationHandler assumes the caller already enforced POST
// and ProtoPeek's CSRF policy. It is the admission-ready operation body and
// reads at most maxDomainCandidatesBodyBytes.
func DomainCandidatesOperationHandler(searcher DomainCandidatesSearcher) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		setDomainCandidatesHeaders(writer)
		if searcher == nil {
			http.Error(writer, "Certificate-name lookup is unavailable", http.StatusServiceUnavailable)
			return
		}

		var input DomainCandidatesRequest
		if !decodeJSONRequest(writer, request, maxDomainCandidatesBodyBytes, &input) {
			return
		}
		if !input.AcknowledgeThirdParty {
			http.Error(
				writer,
				"acknowledgeThirdParty must be true because this sends the registrable domain to crt.name",
				http.StatusBadRequest,
			)
			return
		}
		host := strings.TrimSpace(input.Host)
		if host == "" {
			http.Error(writer, "host is required", http.StatusBadRequest)
			return
		}
		if len(host) > maxDomainCandidateHostBytes {
			http.Error(writer, "host is too long", http.StatusBadRequest)
			return
		}

		result, err := searcher.Search(request.Context(), host)
		if err != nil {
			writeDomainCandidatesError(writer, err)
			return
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(writer).Encode(result); err != nil {
			return
		}
	})
}

func setDomainCandidatesHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func writeDomainCandidatesError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		http.Error(writer, "Certificate-name lookup cancelled", 499)
	case errors.Is(err, context.DeadlineExceeded):
		http.Error(writer, "Certificate-name lookup timed out", http.StatusGatewayTimeout)
	case errors.Is(err, certnames.ErrInvalidApex):
		http.Error(writer, "Host must contain a valid registrable domain", http.StatusBadRequest)
	case errors.Is(err, certnames.ErrProviderBusy):
		writer.Header().Set("Retry-After", "1")
		http.Error(writer, "Certificate-name provider is busy; retry shortly", http.StatusTooManyRequests)
	case errors.Is(err, certnames.ErrResponseTooLarge):
		http.Error(writer, "Certificate-name provider response exceeded the safety limit", http.StatusBadGateway)
	default:
		http.Error(writer, "Certificate-name lookup failed", http.StatusBadGateway)
	}
}
