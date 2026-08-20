package standalone

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkspaceManagerDisconnectRemovesSession(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["session"] = &workspaceSession{id: "session"}
	if !manager.Disconnect("session") {
		t.Fatal("Disconnect returned false for a known session")
	}
	if _, ok := manager.Session("session"); ok {
		t.Fatal("session remains available after disconnect")
	}
	if manager.Disconnect("session") {
		t.Fatal("Disconnect returned true for an unknown session")
	}
}

func TestWorkspaceConnectAcceptsJSONParametersAndBoundsBody(t *testing.T) {
	t.Parallel()

	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(NewWorkspaceManager(WorkspaceManagerOptions{})))
	bootstrapRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	bootstrapResponse := httptest.NewRecorder()
	handler.ServeHTTP(bootstrapResponse, bootstrapRequest)
	cookies := bootstrapResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue a CSRF cookie")
	}
	if cookies[0].Path != "/" || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("CSRF cookie scope = path %q, SameSite %v", cookies[0].Path, cookies[0].SameSite)
	}

	request := func(contentType, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", strings.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		req.Header.Set(csrfHeaderName, cookies[0].Value)
		req.AddCookie(cookies[0])
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}

	parameterized := request("application/json; charset=utf-8", `{"target":{}}`)
	if parameterized.Code != http.StatusBadRequest || !strings.Contains(parameterized.Body.String(), "target address is required") {
		t.Fatalf("parameterized JSON status = %d, body = %q", parameterized.Code, parameterized.Body.String())
	}

	oversized := request("application/json", `{"target":{"address":"`+strings.Repeat("x", maxWorkspaceConnectBodyBytes)+`"}}`)
	if oversized.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d, body = %q", oversized.Code, oversized.Body.String())
	}
}

func TestHandlerServesEmbeddedFavicon(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/favicon.svg", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", res.Code, res.Body.String())
	}
	if got := res.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/svg+xml") {
		t.Fatalf("Content-Type = %q", got)
	}
}

func TestHandlerHTTPRouteUsesCSRFProtection(t *testing.T) {
	t.Parallel()
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer target.Close()

	handler := Handler(nil, "", nil, nil)
	body := `{"url":"` + target.URL + `"}`
	missingToken := httptest.NewRequest(http.MethodPost, "/api/http/request", strings.NewReader(body))
	missingToken.Header.Set("Content-Type", "application/json")
	missingResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingResponse, missingToken)
	if missingResponse.Code != http.StatusUnauthorized {
		t.Fatalf("missing-CSRF status = %d", missingResponse.Code)
	}

	bootstrapResponse := httptest.NewRecorder()
	handler.ServeHTTP(bootstrapResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	cookies := bootstrapResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue a CSRF cookie")
	}
	request := httptest.NewRequest(http.MethodPost, "/api/http/request", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookies[0].Value)
	request.AddCookie(cookies[0])
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
}

func TestHandlerRouteAndNmapEndpointsUseCSRFProtection(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)

	bootstrapResponse := httptest.NewRecorder()
	handler.ServeHTTP(bootstrapResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	cookies := bootstrapResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue a CSRF cookie")
	}

	for _, test := range []struct {
		name        string
		path        string
		contentType string
		body        string
	}{
		{name: "route", path: "/api/route/lookup", contentType: "application/json", body: `{"destination":"127.0.0.1"}`},
		{name: "nmap", path: "/api/nmap/import", contentType: "application/xml", body: `<nmaprun scanner="nmap"/>`},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			missingRequest := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			missingRequest.Header.Set("Content-Type", test.contentType)
			missingResponse := httptest.NewRecorder()
			handler.ServeHTTP(missingResponse, missingRequest)
			if missingResponse.Code != http.StatusUnauthorized {
				t.Fatalf("missing-CSRF status = %d", missingResponse.Code)
			}

			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", test.contentType)
			request.Header.Set(csrfHeaderName, cookies[0].Value)
			request.AddCookie(cookies[0])
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
			}
		})
	}
}
