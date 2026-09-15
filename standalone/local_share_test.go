package standalone

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
