package standalone

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateEndpointsRequireLocalBrowserAndConfirmation(t *testing.T) {
	mux := http.NewServeMux()
	registerUpdates(mux, "dev")
	for _, tt := range []struct {
		name, method, path, body, remote, origin string
		csrf                                     bool
		status                                   int
	}{
		{"read local", "GET", "state", "", "127.0.0.1:1234", "", true, 200},
		{"remote", "GET", "state", "", "192.0.2.1:1234", "", true, 403},
		{"foreign origin", "POST", "check", `{"channel":"stable"}`, "127.0.0.1:1234", "https://example.org", true, 403},
		{"csrf", "POST", "check", `{"channel":"stable"}`, "127.0.0.1:1234", "", false, 403},
		{"get mutation", "GET", "apply", "", "127.0.0.1:1234", "", true, 405},
		{"confirmation", "POST", "apply", `{"id":"id"}`, "127.0.0.1:1234", "", true, 400},
		{"unknown input", "POST", "apply", `{"id":"id","confirm":true,"url":"https://example.org"}`, "127.0.0.1:1234", "", true, 400},
		{"missing preview", "POST", "apply", `{"id":"id","confirm":true}`, "127.0.0.1:1234", "", true, 409},
		{"invalid channel", "POST", "check", `{"channel":"unknown"}`, "127.0.0.1:1234", "", true, 409},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, "http://127.0.0.1:8844/api/update/"+tt.path, strings.NewReader(tt.body))
			r.RemoteAddr = tt.remote
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if tt.csrf {
				r.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "test"})
				r.Header.Set(csrfHeaderName, "test")
			}
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != tt.status {
				t.Fatalf("%d: %s", w.Code, w.Body.String())
			}
		})
	}
}
