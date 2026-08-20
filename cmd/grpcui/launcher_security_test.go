package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLegacyBrowserURLFormatsIPv6(t *testing.T) {
	t.Parallel()
	for _, bind := range []string{"::1", "[::1]"} {
		if got, want := legacyBrowserURL(bind, 8080, "/"), "http://[::1]:8080/"; got != want {
			t.Fatalf("URL = %q, want %q", got, want)
		}
	}
}

func TestLegacyWebAccessDefaultsToLoopback(t *testing.T) {
	t.Parallel()
	if err := validateLegacyWebBind("0.0.0.0", false); err == nil {
		t.Fatal("non-loopback bind unexpectedly accepted")
	}
	if err := validateLegacyWebBind("0.0.0.0", true); err != nil {
		t.Fatalf("explicit remote bind rejected: %v", err)
	}

	handler := legacyLocalAccessHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), false)
	req := httptest.NewRequest(http.MethodGet, "http://attacker.example/", nil)
	req.Host = "attacker.example"
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
}
