package standalone

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/localshare"
)

func TestLocalShareControlsRequireLocalCSRFBeforeBody(t *testing.T) {
	handler := Handler(nil, "", nil, nil, WithLocalShareService(localshare.New()))
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

func TestLocalShareIsOptInBeforeReadingHostInput(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	for _, action := range []string{"snapshot", "start", "stop", "discover", "connect", "decide", "cancel", "send"} {
		body := &failOnReadBody{}
		request := httptest.NewRequest(http.MethodPost, "/api/local-share/"+action, body)
		request.RemoteAddr = "127.0.0.1:4321"
		request.AddCookie(cookie)
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable || body.read {
			t.Fatalf("%s: code=%d read=%v", action, response.Code, body.read)
		}
		if !strings.Contains(response.Body.String(), "Local transfer is disabled") {
			t.Fatalf("%s: missing domain-specific unavailable guidance", action)
		}
	}
}

func TestLocalShareTypedNilIsUnavailable(t *testing.T) {
	var service *localshare.Service
	handler := Handler(nil, "", nil, nil, WithLocalShareService(service))
	cookie := handlerCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/local-share/snapshot", strings.NewReader("{}"))
	request.RemoteAddr = "127.0.0.1:4321"
	request.AddCookie(cookie)
	request.Header.Set(csrfHeaderName, cookie.Value)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil native service should be unavailable: %d %s", response.Code, response.Body.String())
	}
}

type localShareStateStub struct {
	LocalShareService
	state localshare.Snapshot
}

func (service *localShareStateStub) Start(name, directory string, _ int) error {
	service.state.Name, service.state.Directory, service.state.Running = name, directory, true
	return nil
}

func (service *localShareStateStub) Snapshot() localshare.Snapshot { return service.state }

func TestLocalShareHandlersShareTheInjectedSession(t *testing.T) {
	service := &localShareStateStub{}
	first := Handler(nil, "", nil, nil, WithLocalShareService(service))
	second := Handler(nil, "", nil, nil, WithLocalShareService(service))
	for index, handler := range []http.Handler{first, second} {
		cookie := handlerCSRFCookie(t, handler)
		action, body := "start", `{"name":"Shared session","directory":"owned test folder"}`
		if index == 1 {
			action, body = "snapshot", "{}"
		}
		request := httptest.NewRequest(http.MethodPost, "/api/local-share/"+action, strings.NewReader(body))
		request.RemoteAddr = "127.0.0.1:4321"
		request.AddCookie(cookie)
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"name":"Shared session"`) || !strings.Contains(response.Body.String(), `"running":true`) {
			t.Fatalf("handler %d did not retain the shared host session: %d %s", index, response.Code, response.Body.String())
		}
	}
}

func TestLocalShareCancellationUnblocksStalledBrowserBody(t *testing.T) {
	done := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := &localShareBody{ReadCloser: r.Body, controller: http.NewResponseController(w)}
		timer := time.AfterFunc(100*time.Millisecond, func() { _ = body.Close() })
		defer timer.Stop()
		_, err := io.Copy(io.Discard, body)
		done <- err
	}))
	defer server.Close()
	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = io.WriteString(conn, "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1024\r\n\r\nx")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Stalled upload unexpectedly completed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Cancellation left the browser body blocked")
	}
}
