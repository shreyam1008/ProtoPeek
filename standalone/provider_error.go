package standalone

import (
	"context"
	"errors"
	"net/http"
)

// Provider errors use fixed domain guidance; native stderr can contain private sign-in links.
func writeProviderError(writer http.ResponseWriter, err error, fallback int, message string) {
	status := fallback
	if errors.Is(err, context.Canceled) {
		status = http.StatusRequestTimeout
	}
	if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	}
	writer.Header().Set("Cache-Control", "no-store")
	http.Error(writer, message, status)
}
