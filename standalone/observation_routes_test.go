package standalone

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestHandlerWiresObservationRoutesWithValidationBeforeBody(t *testing.T) {
	handler := Handler(nil, "", nil, nil)

	for _, path := range []string{"/api/domain/candidates", "/api/security/web"} {
		path := path
		t.Run(path, func(t *testing.T) {
			getResponse := httptest.NewRecorder()
			handler.ServeHTTP(getResponse, httptest.NewRequest(http.MethodGet, path, nil))
			if getResponse.Code != http.StatusMethodNotAllowed || getResponse.Header().Get("Allow") != http.MethodPost {
				t.Fatalf("GET response = %d Allow=%q", getResponse.Code, getResponse.Header().Get("Allow"))
			}

			body := &observationRouteUnreadBody{}
			postResponse := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, path, body)
			request.Header.Set("Content-Type", "application/json")
			handler.ServeHTTP(postResponse, request)
			if postResponse.Code != http.StatusUnauthorized || body.reads.Load() != 0 {
				t.Fatalf("POST response = %d body reads=%d", postResponse.Code, body.reads.Load())
			}
			if postResponse.Header().Get("Cache-Control") != "no-store" || postResponse.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("security headers = %#v", postResponse.Header())
			}
		})
	}
}

func TestHandlerObservationRoutesValidateConsentWithoutNetworkIO(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)

	for _, test := range []struct {
		path string
		body string
		want string
	}{
		{path: "/api/domain/candidates", body: `{"host":"example.com"}`, want: "acknowledgeThirdParty"},
		{path: "/api/security/web", body: `{"url":"https://example.com"}`, want: "acknowledgePublicRequest"},
	} {
		test := test
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set(csrfHeaderName, cookie.Value)
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("response = %d %q", response.Code, response.Body.String())
			}
		})
	}
}

type observationRouteUnreadBody struct {
	reads atomic.Int32
}

func (body *observationRouteUnreadBody) Read([]byte) (int, error) {
	body.reads.Add(1)
	return 0, errors.New("body must not be read before CSRF validation")
}

func (*observationRouteUnreadBody) Close() error { return nil }
