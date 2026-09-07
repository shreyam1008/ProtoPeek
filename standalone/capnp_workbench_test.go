package standalone

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCapnpSchemaBoundaryAndNoCompilerRequiredForBinary(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	raw, err := os.ReadFile("../internal/capnpwork/testdata/workbench.bin")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"schemaBase64": base64.StdEncoding.EncodeToString(raw)})
	for _, test := range []struct {
		body   string
		csrf   bool
		status int
	}{
		{string(body), true, 200}, {string(body), false, 401}, {`{"schemaBase64":"bad"}`, true, 400}, {`{"schemaBase64":"AAAA","extra":true}`, true, 400},
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/capnp/schema", strings.NewReader(test.body))
		r.Header.Set("Content-Type", "application/json")
		if test.csrf {
			r.AddCookie(cookie)
			r.Header.Set(csrfHeaderName, cookie.Value)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("status=%d want=%d body=%s", w.Code, test.status, w.Body.String())
		}
		if w.Code == 200 && !strings.Contains(w.Body.String(), `"name":"echo"`) {
			t.Fatal("schema methods missing")
		}
	}
	for _, route := range []string{"schema", "call"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/capnp/"+route, nil))
		if w.Code != 405 {
			t.Fatalf("GET %s returned %d", route, w.Code)
		}
	}
}
