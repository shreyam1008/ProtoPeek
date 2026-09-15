package standalone

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/media"
)

func TestMediaMutationsRemainLocalAndCSRFProtected(t *testing.T) {
	s, err := media.NewAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	handler := Handler(nil, "", nil, nil, WithMediaService(s))
	cookie := handlerCSRFCookie(t, handler)
	for _, route := range []string{"install", "inspect", "add", "action"} {
		for _, tc := range []struct {
			peer string
			csrf bool
			want int
		}{{"127.0.0.1:1234", false, 401}, {"203.0.113.1:1234", true, 403}} {
			body := &failOnReadBody{}
			r := httptest.NewRequest(http.MethodPost, "/api/media/"+route, body)
			r.RemoteAddr = tc.peer
			r.Header.Set("Content-Type", "application/json")
			if tc.csrf {
				r.AddCookie(cookie)
				r.Header.Set(csrfHeaderName, cookie.Value)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.want || body.read {
				t.Fatalf("%s: status=%d body read=%v", route, w.Code, body.read)
			}
		}
	}
}

func TestUnavailableMediaDoesNotPreventConsole(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/media/snapshot", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d", w.Code)
	}
}
