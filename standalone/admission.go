package standalone

import "net/http"

const (
	maxConcurrentGRPCInvokes  = 8
	maxConcurrentHTTPRelays   = 4
	maxConcurrentRouteLookups = 2
)

type admissionLimiter struct {
	slots chan struct{}
}

func newAdmissionLimiter(limit int) *admissionLimiter {
	return &admissionLimiter{slots: make(chan struct{}, limit)}
}

func (limiter *admissionLimiter) serveHTTP(operation string, writer http.ResponseWriter, request *http.Request, next http.Handler) {
	select {
	case limiter.slots <- struct{}{}:
		defer func() { <-limiter.slots }()
		next.ServeHTTP(writer, request)
	default:
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Retry-After", "1")
		http.Error(writer, operation+" capacity is busy; retry shortly", http.StatusTooManyRequests)
	}
}

func validateAdmittedPOST(writer http.ResponseWriter, request *http.Request) bool {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		http.Error(writer, "Method Not Allowed", http.StatusMethodNotAllowed)
		return false
	}
	if !validCSRF(request) {
		http.Error(writer, "incorrect CSRF token", http.StatusUnauthorized)
		return false
	}
	return true
}
