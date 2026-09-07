package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
)

func agentHarness(t *testing.T) (*http.ServeMux, *agentManager) {
	t.Helper()
	mux := http.NewServeMux()
	m := registerAgentLink(mux, "test", "/")
	path := filepath.Join(t.TempDir(), "connection.json")
	m.connectionPath = func() (string, error) { return path, nil }
	return mux, m
}
func agentRequest(mux http.Handler, path, body string, token string, admin bool) *httptest.ResponseRecorder {
	method := "POST"
	if strings.HasPrefix(path, "/api/agent/state") || strings.HasPrefix(path, "/api/agent/result") {
		method = "GET"
	}
	request := httptest.NewRequest(method, "http://127.0.0.1:8844"+path, strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Content-Type", "application/json")
	if admin {
		request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "test"})
		request.Header.Set(csrfHeaderName, "test")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}
func agentEnable(t *testing.T, mux http.Handler, m *agentManager, writes bool) string {
	t.Helper()
	response := agentRequest(mux, "/api/agent/control", fmt.Sprintf(`{"action":"enable","allowWrites":%t}`, writes), "", true)
	if response.Code != 200 {
		t.Fatalf("enable: %d %s", response.Code, response.Body.String())
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.token
}
func TestAgentAuthorizationAndRevocation(t *testing.T) {
	mux, m := agentHarness(t)
	body := `{"name":"workbench_info","arguments":{}}`
	if r := agentRequest(mux, "/api/agent/call", body, "", false); r.Code != 401 {
		t.Fatal(r.Code)
	}
	if r := agentRequest(mux, "/api/agent/control", `{"action":"enable"}`, "", false); r.Code != 403 {
		t.Fatal(r.Code)
	}
	token := agentEnable(t, mux, m, false)
	if r := agentRequest(mux, "/api/agent/call", body, token, false); r.Code != 200 || !strings.Contains(r.Body.String(), "test") {
		t.Fatal(r.Body.String())
	}
	if r := agentRequest(mux, "/api/agent/state", "", token, false); r.Code != 403 {
		t.Fatal("bearer must not grant UI administration")
	}
	r := agentRequest(mux, "/api/agent/state", "", "", true)
	if strings.Contains(r.Body.String(), token) {
		t.Fatal("token leaked in state")
	}
	next := agentEnable(t, mux, m, false)
	if token == next {
		t.Fatal("token not rotated")
	}
	if r := agentRequest(mux, "/api/agent/call", body, token, false); r.Code != 401 {
		t.Fatal("old token accepted")
	}
	agentRequest(mux, "/api/agent/control", `{"action":"disable"}`, "", true)
	if r := agentRequest(mux, "/api/agent/call", body, next, false); r.Code != 401 {
		t.Fatal("revoked token accepted")
	}
}
func TestAgentRejectsRemoteOriginsAndMethods(t *testing.T) {
	mux, _ := agentHarness(t)
	for _, item := range []struct{ host, remote, origin string }{
		{"127.0.0.1:8844", "10.0.0.2:1", ""}, {"evil.example:8844", "127.0.0.1:1", ""}, {"127.0.0.1:8844", "127.0.0.1:1", "https://evil.example"}, {"127.0.0.1:8844", "127.0.0.1:1", "null"},
	} {
		req := httptest.NewRequest("GET", "http://"+item.host+"/api/agent/state", nil)
		req.RemoteAddr = item.remote
		req.Header.Set("Origin", item.origin)
		req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "test"})
		req.Header.Set(csrfHeaderName, "test")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != 403 {
			t.Fatal(item, response.Code)
		}
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1:8844/api/agent/call", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, req)
	if response.Code != 405 {
		t.Fatal(response.Code)
	}
}
func TestAgentRealHTTPAndWritePolicy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		body, _ := io.ReadAll(r.Body)
		_ = json.NewEncoder(w).Encode(map[string]string{"method": r.Method, "body": string(body)})
	}))
	defer upstream.Close()
	mux, m := agentHarness(t)
	mux.Handle("/api/http/request", HTTPRequestHandler())
	token := agentEnable(t, mux, m, false)
	call := func(method string) *httptest.ResponseRecorder {
		input, _ := json.Marshal(map[string]any{"name": "http_request", "arguments": map[string]string{"url": upstream.URL, "method": method, "body": "private-input"}})
		return agentRequest(mux, "/api/agent/call", string(input), token, false)
	}
	if r := call("POST"); r.Code != 403 {
		t.Fatal(r.Body.String())
	}
	if m.snapshot().Records == nil || len(m.snapshot().Records) != 0 {
		t.Fatal("denied call executed")
	}
	r := call("GET")
	var result agentlink.Result
	_ = json.Unmarshal(r.Body.Bytes(), &result)
	if r.Code != 200 || result.State != "completed" || !bytes.Contains(result.Data, []byte(`"statusCode":404`)) {
		t.Fatal(r.Body.String())
	}
	if r := agentRequest(mux, "/api/agent/state", "", "", true); strings.Contains(r.Body.String(), "private-input") || strings.Contains(r.Body.String(), upstream.URL) {
		t.Fatal("state leaked request/result body")
	}
	token = agentEnable(t, mux, m, true)
	if r := call("POST"); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
}
func TestAgentCancellationAdmissionAndRetention(t *testing.T) {
	mux, m := agentHarness(t)
	entered := make(chan struct{}, 2)
	mux.HandleFunc("/api/http/request", func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		<-r.Context().Done()
		http.Error(w, "cancelled", 499)
	})
	token := agentEnable(t, mux, m, false)
	done := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() {
			done <- agentRequest(mux, "/api/agent/call", `{"name":"http_request","arguments":{"url":"http://127.0.0.1","method":"GET"}}`, token, false)
		}()
	}
	for range 2 {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("operation did not start")
		}
	}
	if r := agentRequest(mux, "/api/agent/call", `{"name":"workbench_info","arguments":{}}`, token, false); r.Code != 429 {
		t.Fatal("admission not bounded")
	}
	records := m.snapshot().Records
	if r := agentRequest(mux, "/api/agent/control", `{"action":"cancel","id":"`+records[0].ID+`"}`, "", true); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	agentRequest(mux, "/api/agent/control", `{"action":"disable"}`, "", true)
	for range 2 {
		select {
		case response := <-done:
			var result agentlink.Result
			_ = json.Unmarshal(response.Body.Bytes(), &result)
			if result.State != "cancelled" {
				t.Fatal(result.State)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("cancel did not reach handler")
		}
	}
	token = agentEnable(t, mux, m, false)
	for range 35 {
		r := agentRequest(mux, "/api/agent/call", `{"name":"workbench_info","arguments":{}}`, token, false)
		if r.Code != 200 {
			t.Fatal(r.Code)
		}
	}
	if len(m.snapshot().Records) != 32 {
		t.Fatal("receipt limit")
	}
	agentRequest(mux, "/api/agent/control", `{"action":"clear"}`, "", true)
	if len(m.snapshot().Records) != 0 {
		t.Fatal("clear did not erase finished results")
	}
}
func TestAgentBoundedOutputAndDownloadTranslation(t *testing.T) {
	mux, m := agentHarness(t)
	mux.HandleFunc("/api/this-pc/snapshot", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(bytes.Repeat([]byte{0}, 2<<20)) })
	mux.HandleFunc("/api/transfers/add", func(w http.ResponseWriter, r *http.Request) {
		var args struct {
			Sources    []string `json:"sources"`
			OutputName string   `json:"outputName"`
			SHA        string   `json:"sha256"`
		}
		if err := json.NewDecoder(r.Body).Decode(&args); err != nil {
			t.Error(err)
		}
		if len(args.Sources) != 1 || args.Sources[0] != "http://127.0.0.1/file" || args.OutputName != "demo.bin" || len(args.SHA) != 64 {
			t.Errorf("incorrect download adapter: %+v", args)
		}
		_, _ = w.Write([]byte(`{"queued":true}`))
	})
	token := agentEnable(t, mux, m, true)
	r := agentRequest(mux, "/api/agent/call", `{"name":"device_snapshot","arguments":{}}`, token, false)
	var result agentlink.Result
	_ = json.Unmarshal(r.Body.Bytes(), &result)
	if !result.Truncated || len(r.Body.Bytes()) > agentlink.MaxOutput || len(result.Preview) > agentReceiptBytes {
		t.Fatal("unbounded output")
	}
	r = agentRequest(mux, "/api/agent/call", `{"name":"download_add","arguments":{"url":"http://127.0.0.1/file","outputName":"demo.bin","expectedSHA256":"`+strings.Repeat("a", 64)+`"}}`, token, false)
	if !strings.Contains(r.Body.String(), `"queued":true`) {
		t.Fatal(r.Body.String())
	}
}
func TestAgentRevisionWaitIsCancelledByClient(t *testing.T) {
	mux, m := agentHarness(t)
	req := httptest.NewRequest("GET", "http://127.0.0.1:8844/api/agent/state?after=0", nil)
	req.RemoteAddr = "127.0.0.1:1"
	req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "test"})
	req.Header.Set(csrfHeaderName, "test")
	ctx, cancel := context.WithCancel(req.Context())
	done := make(chan struct{})
	go func() { mux.ServeHTTP(httptest.NewRecorder(), req.WithContext(ctx)); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("abandoned activity viewer leaked")
	}
	if len(m.watchers) != 0 {
		t.Fatal("watcher slot leaked")
	}
}

func TestAgentEmptyBodyOperationsUseExistingHandlers(t *testing.T) {
	mux, m := agentHarness(t)
	registerTransferHandlers(mux, &fakeTransferService{})
	mux.HandleFunc("/api/tailnet/inspect", func(w http.ResponseWriter, r *http.Request) {
		if !requireEmptyTransferBody(w, r) {
			return
		}
		_, _ = w.Write([]byte(`{"available":false}`))
	})
	token := agentEnable(t, mux, m, true)
	for _, tool := range []string{"download_start_engine", "tailnet_inspect"} {
		response := agentRequest(mux, "/api/agent/call", `{"name":"`+tool+`","arguments":{}}`, token, false)
		var result agentlink.Result
		_ = json.Unmarshal(response.Body.Bytes(), &result)
		if result.State != "completed" {
			t.Fatalf("%s: %s", tool, response.Body.String())
		}
	}
}

func TestAgentListenerConsentAndPortScanDefaults(t *testing.T) {
	mux, m := agentHarness(t)
	service := &fakeThisPCService{}
	registerThisPCHandlers(mux, service)
	registerPortScanner(mux)
	token := agentEnable(t, mux, m, false)
	response := agentRequest(mux, "/api/agent/call", `{"name":"device_listeners","arguments":{}}`, token, false)
	if response.Code != http.StatusBadRequest || service.activityCalls.Load() != 0 {
		t.Fatal("missing local-inspection consent accepted")
	}
	response = agentRequest(mux, "/api/agent/call", `{"name":"device_listeners","arguments":{"acknowledgeLocalInspection":true}}`, token, false)
	if response.Code != 200 || service.activityCalls.Load() != 1 {
		t.Fatal(response.Body.String())
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer upstream.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	response = agentRequest(mux, "/api/agent/call", `{"name":"scan_ports","arguments":{"host":"127.0.0.1","ports":"`+port+`"}}`, token, false)
	if !strings.Contains(response.Body.String(), `"state":"open"`) {
		t.Fatal(response.Body.String())
	}
}
