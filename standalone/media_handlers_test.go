package standalone

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	r := httptest.NewRequest(http.MethodGet, "/api/media/snapshot", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d", w.Code)
	}
}

func TestMediaFactoryOnlyRunsAfterRequestAdmission(t *testing.T) {
	calls := 0
	handler := Handler(nil, "", nil, nil, WithMediaServiceFactory(func() (*media.Service, error) {
		calls++
		return nil, errors.New("media queue is in use by another instance")
	}))
	if calls != 0 {
		t.Fatal("handler construction initialized media")
	}
	cookie := handlerCSRFCookie(t, handler)
	for _, route := range []string{"snapshot", "install", "inspect", "add", "action"} {
		for _, input := range []struct {
			name, method, peer, forwarding string
			csrf                           bool
			want                           int
		}{
			{"wrong-method", http.MethodDelete, "127.0.0.1:1234", "", true, http.StatusMethodNotAllowed},
			{"remote", http.MethodPost, "203.0.113.1:1234", "", true, http.StatusForbidden},
			{"forwarded", http.MethodPost, "127.0.0.1:1234", "127.0.0.1", true, http.StatusForbidden},
			{"csrf", http.MethodPost, "127.0.0.1:1234", "", false, http.StatusUnauthorized},
		} {
			if route == "snapshot" {
				if input.name == "csrf" {
					continue // Read-only snapshots do not require a CSRF header.
				}
				if input.name != "wrong-method" {
					input.method = http.MethodGet
				}
			}
			body := &failOnReadBody{}
			request := httptest.NewRequest(input.method, "/api/media/"+route, body)
			request.RemoteAddr = input.peer
			request.Header.Set("X-Forwarded-For", input.forwarding)
			if input.csrf {
				request.AddCookie(cookie)
				request.Header.Set(csrfHeaderName, cookie.Value)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != input.want || calls != 0 || body.read {
				t.Fatalf("%s/%s: status=%d, factory calls=%d, body read=%v", route, input.name, response.Code, calls, body.read)
			}
		}
	}
	for _, route := range []string{"install", "inspect", "add", "action"} {
		request := httptest.NewRequest(http.MethodPost, "/api/media/"+route, strings.NewReader("{"))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		request.Header.Set(csrfHeaderName, cookie.Value)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || calls != 0 {
			t.Fatalf("malformed %s started media: status=%d, calls=%d", route, response.Code, calls)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/api/media/snapshot", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || calls != 1 ||
		!strings.Contains(response.Body.String(), "queue is in use by another instance") || strings.Contains(response.Body.String(), "remote mode") {
		t.Fatalf("untruthful factory failure: %d, %d, %s", response.Code, calls, response.Body.String())
	}
}

func TestMediaEmbeddingOptionRemainsCompatibleAndLastOptionWins(t *testing.T) {
	service, err := media.NewAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	factoryCalls := 0
	factory := func() (*media.Service, error) { factoryCalls++; return nil, errors.New("factory unavailable") }
	for _, input := range []struct {
		options []HandlerOption
		want    int
	}{
		{[]HandlerOption{WithMediaServiceFactory(factory), WithMediaService(service)}, http.StatusOK},
		{[]HandlerOption{WithMediaService(service), WithMediaServiceFactory(factory)}, http.StatusServiceUnavailable},
	} {
		handler := Handler(nil, "", nil, nil, input.options...)
		request := httptest.NewRequest(http.MethodGet, "/api/media/snapshot", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != input.want {
			t.Fatalf("embedding returned %d, want %d", response.Code, input.want)
		}
	}
	if factoryCalls != 1 {
		t.Fatalf("unexpected factory calls: %d", factoryCalls)
	}
}

func TestCrossSiteMediaSnapshotCannotInitializeQueue(t *testing.T) {
	calls := 0
	handler := Handler(nil, "", nil, nil, WithMediaServiceFactory(func() (*media.Service, error) {
		calls++
		return nil, errors.New("fixture queue unavailable")
	}))
	for _, input := range []struct {
		site  string
		want  int
		calls int
	}{
		{"cross-site", http.StatusForbidden, 0},
		{"same-site", http.StatusForbidden, 0},
		{"unexpected", http.StatusForbidden, 0},
		{"same-origin", http.StatusServiceUnavailable, 1},
		{"", http.StatusServiceUnavailable, 2}, // Native clients do not send Fetch Metadata.
		{"none", http.StatusServiceUnavailable, 3},
	} {
		request := httptest.NewRequest(http.MethodGet, "/api/media/snapshot", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		if input.site != "" {
			request.Header.Set("Sec-Fetch-Site", input.site)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != input.want || calls != input.calls {
			t.Fatalf("site %q: status=%d, factory calls=%d", input.site, response.Code, calls)
		}
	}
}
