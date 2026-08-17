package cli

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateWebBind(t *testing.T) {
	t.Parallel()

	for _, bindAddress := range []string{"localhost", "localhost.", "127.0.0.1", "::1"} {
		bindAddress := bindAddress
		t.Run("allows "+bindAddress, func(t *testing.T) {
			t.Parallel()
			if err := validateWebBind(bindAddress, false); err != nil {
				t.Fatalf("validateWebBind(%q, false) returned %v", bindAddress, err)
			}
		})
	}

	for _, bindAddress := range []string{"0.0.0.0", "192.168.1.10", "example.internal"} {
		bindAddress := bindAddress
		t.Run("rejects "+bindAddress, func(t *testing.T) {
			t.Parallel()
			if err := validateWebBind(bindAddress, false); err == nil {
				t.Fatalf("validateWebBind(%q, false) unexpectedly succeeded", bindAddress)
			}
			if err := validateWebBind(bindAddress, true); err != nil {
				t.Fatalf("validateWebBind(%q, true) returned %v", bindAddress, err)
			}
		})
	}
}

func TestLocalAccessHandlerRejectsUntrustedHostAndOrigin(t *testing.T) {
	t.Parallel()

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := localAccessHandler(next, false)

	tests := []struct {
		name   string
		host   string
		origin string
		want   int
	}{
		{name: "loopback host", host: "127.0.0.1:8080", want: http.StatusNoContent},
		{name: "localhost host", host: "localhost:8080", origin: "http://localhost:8080", want: http.StatusNoContent},
		{name: "localhost dot host", host: "localhost.:8080", origin: "http://localhost.:8080", want: http.StatusNoContent},
		{name: "ipv6 loopback host", host: "[::1]:8080", want: http.StatusNoContent},
		{name: "host rebinding", host: "attacker.example", want: http.StatusForbidden},
		{name: "non-loopback host", host: "192.168.1.10:8080", want: http.StatusForbidden},
		{name: "foreign origin", host: "localhost:8080", origin: "http://attacker.example", want: http.StatusForbidden},
		{name: "malformed origin", host: "localhost:8080", origin: "://bad", want: http.StatusForbidden},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "http://"+test.host+"/", nil)
			req.Host = test.host
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != test.want {
				t.Fatalf("status = %d, want %d", res.Code, test.want)
			}
		})
	}
}
