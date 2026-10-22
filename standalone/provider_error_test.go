package standalone

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderErrorsPreserveFailureStatusAndWithholdNativeDetails(t *testing.T) {
	for _, test := range []struct {
		err  error
		want int
	}{
		{errors.New("native https://auth.test/sentinel-secret"), 502},
		{fmt.Errorf("native sentinel-secret: %w", context.Canceled), 408},
		{fmt.Errorf("native sentinel-secret: %w", context.DeadlineExceeded), 504},
	} {
		response := httptest.NewRecorder()
		writeProviderError(response, test.err, 502, "NetBird status could not be read; inspect the installed client.")
		if response.Code != test.want || !strings.Contains(response.Body.String(), "NetBird") || strings.Contains(response.Body.String(), "sentinel-secret") || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("provider error=%d %q", response.Code, response.Body.String())
		}
	}
}
