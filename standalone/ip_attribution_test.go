package standalone

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIPAttributionEnforcesCSRFConsentAndStrictScope(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	for _, tc := range []struct {
		body   string
		csrf   bool
		status int
	}{
		{`{"addresses":["127.0.0.1"],"acknowledgeThirdParty":true}`, false, 401},
		{`{"addresses":["127.0.0.1"]}`, true, 400},
		{`{"addresses":["127.0.0.1"],"acknowledgeThirdParty":true,"provider":"https://other.example"}`, true, 400},
		{`{"addresses":["1.1.1.1","example.com"],"acknowledgeThirdParty":true}`, true, 400},
		{`{"addresses":["127.0.0.1","fe80::1%eth0"],"acknowledgeThirdParty":true}`, true, 200},
	} {
		r := httptest.NewRequest("POST", "/api/network/attribution", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		if tc.csrf {
			r.AddCookie(cookie)
			r.Header.Set(csrfHeaderName, cookie.Value)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
		if tc.status == 200 && !strings.Contains(w.Body.String(), "not sent to the provider") {
			t.Fatal(w.Body.String())
		}
	}
}
