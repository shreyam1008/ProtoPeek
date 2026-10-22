package standalone

import (
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/capnpwork"
	"github.com/shreyam1008/ProtoPeek/testing/capnpfixture"
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

func TestCapnpCallPlanHTTPBoundaryAndPartialEvidence(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	raw, err := os.ReadFile("../internal/capnpwork/testdata/workbench.bin")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	var connections atomic.Int32
	go func() {
		for {
			socket, err := listener.Accept()
			if err != nil {
				return
			}
			connections.Add(1)
			go capnpfixture.ServeConnection(socket)
		}
	}()
	post := func(steps []capnpwork.CallStep, csrf bool) *httptest.ResponseRecorder {
		t.Helper()
		input := struct {
			SchemaBase64 string `json:"schemaBase64"`
			capnpwork.CallRequest
		}{base64.StdEncoding.EncodeToString(raw), capnpwork.CallRequest{
			Address: listener.Addr().String(), Transport: "tcp", TimeoutMs: 1000, Steps: steps,
		}}
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(http.MethodPost, "/api/capnp/call", strings.NewReader(string(body)))
		r.Header.Set("Content-Type", "application/json")
		if csrf {
			r.AddCookie(cookie)
			r.Header.Set(csrfHeaderName, cookie.Value)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	steps := []capnpwork.CallStep{
		{InterfaceID: "0xb1529bf8e102de33", Ordinal: 1, Params: json.RawMessage(`{"a":9007199254740993,"b":7}`)},
		{InterfaceID: "0xb1529bf8e102de33", Ordinal: 1, Params: json.RawMessage(`{"a":2,"b":3}`)},
	}
	if w := post(steps, false); w.Code != http.StatusUnauthorized || connections.Load() != 0 {
		t.Fatalf("unadmitted plan status=%d connections=%d", w.Code, connections.Load())
	}
	w := post(steps, true)
	var result capnpwork.CallResult
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Plan == nil || !result.Plan.Completed || result.Plan.SentSteps != 2 || len(result.Plan.Steps) != 2 || connections.Load() != 1 {
		t.Fatalf("single-connection plan status=%d connections=%d body=%s", w.Code, connections.Load(), w.Body.String())
	}
	if strings.TrimSpace(string(result.Plan.Steps[0].Result)) != `{"sum":"9007199254741000"}` {
		t.Fatalf("lost exact numeric token: %s", result.Plan.Steps[0].Result)
	}
	steps[1].Ordinal, steps[1].Params = 2, json.RawMessage(`{}`)
	w = post(steps, true)
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Plan == nil || result.Plan.Completed || len(result.Plan.Steps) != 2 || string(result.Plan.Steps[0].Result) != `{"sum":"9007199254741000"}` || !strings.Contains(result.Plan.Steps[1].Error, "deliberate QA RPC failure") || connections.Load() != 2 {
		t.Fatalf("partial evidence status=%d connections=%d body=%s", w.Code, connections.Load(), w.Body.String())
	}
	steps[0].Target = &capnpwork.CapabilityTarget{Step: 0, Path: []string{"child"}}
	if w := post(steps, true); w.Code != http.StatusBadGateway || connections.Load() != 2 {
		t.Fatalf("invalid plan reached peer: status=%d connections=%d", w.Code, connections.Load())
	}
}
