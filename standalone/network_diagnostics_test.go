package standalone

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/netdiag"
)

func TestDiagnosticsAdmissionAndOfflineResult(t *testing.T) {
	mux := http.NewServeMux()
	registerDiagnosticsHandlers(mux)
	for _, test := range []struct {
		method, body string
		want         int
	}{
		{"GET", "", 405},
		{"POST", `{}`, 401},
	} {
		request := httptest.NewRequest(test.method, "http://localhost/api/network/diagnostics", strings.NewReader(test.body))
		request.RemoteAddr = "127.0.0.1:12345"
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != test.want {
			t.Fatalf("%s: %d %s", test.method, response.Code, response.Body.String())
		}
	}
	operation := diagnosticsHandlerForTest(t, `{"mode":"subnet","target":"10.0.0.0/24","timeoutMs":500}`)
	if operation.Code != 200 || !strings.Contains(operation.Body.String(), `"totalAddresses":"256"`) {
		t.Fatalf("%d %s", operation.Code, operation.Body.String())
	}
	if response := diagnosticsHandlerForTest(t, `{"mode":"execute","target":"localhost","timeoutMs":500}`); response.Code != 400 {
		t.Fatalf("invalid mode: %d", response.Code)
	}
	if response := diagnosticsHandlerForTest(t, strings.Repeat("x", (128<<10)+1)); response.Code != 413 {
		t.Fatalf("oversize: %d", response.Code)
	}
}

func TestDiagnosticsOptInAndDirectLoopbackBoundary(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		var options []HandlerOption
		if enabled {
			options = append(options, WithNetworkDiagnostics())
		}
		handler := Handler(nil, "", nil, nil, options...)
		cookie := handlerCSRFCookie(t, handler)
		for _, test := range []struct {
			peer, forwarded string
			want            int
		}{
			{"127.0.0.1:12345", "", 200},
			{"[::1]:12345", "", 200},
			{"203.0.113.4:12345", "", 403},
			{"127.0.0.1:12345", "203.0.113.4", 403},
		} {
			request := httptest.NewRequest("POST", "/api/network/diagnostics", strings.NewReader(`{"mode":"subnet","target":"10.0.0.0/24","timeoutMs":500}`))
			request.RemoteAddr = test.peer
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set(csrfHeaderName, cookie.Value)
			request.AddCookie(cookie)
			if test.forwarded != "" {
				request.Header.Set("X-Forwarded-For", test.forwarded)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			want := test.want
			if !enabled {
				want = http.StatusNotFound
			}
			if response.Code != want {
				t.Fatalf("enabled=%v peer=%s forwarding=%s: %d %s", enabled, test.peer, test.forwarded, response.Code, response.Body.String())
			}
		}
	}
}

func diagnosticsHandlerForTest(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest("POST", "http://localhost/api/network/diagnostics", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	diagnosticsHandler(netdiag.Engine{}).ServeHTTP(response, request)
	return response
}
