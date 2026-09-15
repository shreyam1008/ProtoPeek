package standalone

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalShareControlsRequireLocalCSRFBeforeBody(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	for _, action := range []string{"snapshot", "start", "stop", "discover", "connect", "decide", "cancel", "send"} {
		for _, authorized := range []bool{false, true} {
			body := &failOnReadBody{}
			req := httptest.NewRequest("POST", "/api/local-share/"+action, body)
			req.RemoteAddr = "203.0.113.5:4321"
			if authorized {
				req.AddCookie(cookie)
				req.Header.Set(csrfHeaderName, cookie.Value)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			want := http.StatusUnauthorized
			if authorized {
				want = http.StatusForbidden
			}
			if w.Code != want || body.read {
				t.Fatalf("%s authorized=%v: %d read=%v", action, authorized, w.Code, body.read)
			}
		}
	}
	req := httptest.NewRequest("POST", "/api/local-share/snapshot", strings.NewReader("{}"))
	req.RemoteAddr = "127.0.0.1:4321"
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, cookie.Value)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"running":false`) {
		t.Fatalf("Initial state: %d %s", w.Code, w.Body.String())
	}
}
