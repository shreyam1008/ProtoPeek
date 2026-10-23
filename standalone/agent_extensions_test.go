package standalone

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
	"github.com/shreyam1008/ProtoPeek/internal/extensions"
)

func TestAgentExtensionMetadataAndSingleLookupPreserveGETArgumentsAndReadOnlyPolicy(t *testing.T) {
	mux, agent := agentHarness(t)
	var uris []string
	agent.mux = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uris = append(uris, r.URL.RequestURI())
		raw, err := io.ReadAll(r.Body)
		if err != nil || len(raw) != 0 || r.Method != http.MethodGet {
			t.Errorf("GET leaked request body/method: %s %q %v", r.Method, raw, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schemaVersion":2,"extensions":[{"id":"lm-studio","status":"missing"}]}`))
	})
	token := agentEnable(t, mux, agent, false)
	for _, test := range []struct{ name, args, uri string }{
		{"extensions_list", `{}`, "/api/extensions/catalog"},
		{"extension_inspect", `{"id":"lm-studio"}`, "/api/extensions?id=lm-studio"},
	} {
		result := callAgentProtocol(t, mux, token, test.name, json.RawMessage(test.args))
		if result.Status != 200 || result.State != "completed" || uris[len(uris)-1] != test.uri {
			t.Fatalf("%s result=%+v uri=%v", test.name, result, uris)
		}
	}
	if len(uris) != 2 {
		t.Fatalf("unexpected native requests: %v", uris)
	}
}

func TestAgentExtensionsTraverseMountedNativeHandlersAndRetainTimedOutLookupSlots(t *testing.T) {
	mux, agent := agentHarness(t)
	agent.basePath = "/mounted"
	mounted := http.StripPrefix("/mounted", mux)
	started := make(chan string, 2)
	returned := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var lookups atomic.Int32
	registerExtensionsWithInspector(mux, nil,
		func(extensions.Options) extensions.Snapshot {
			t.Error("agent single lookup unexpectedly invoked the legacy detector")
			return extensions.Snapshot{}
		},
		func(id string, _ extensions.Options) (extensions.Snapshot, error) {
			lookups.Add(1)
			if id == "caddy" || id == "ngrok" {
				started <- id
				<-release
				returned <- struct{}{}
			}
			return fixtureExtensionSnapshot(2, id), nil
		},
	)
	var dispatches atomic.Int32
	agent.mux = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.RemoteAddr != "127.0.0.1:0" || !validCSRF(r) || r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/api/extensions") {
			t.Errorf("invalid internal native dispatch: method=%s path=%s remote=%s csrf=%v", r.Method, r.URL.Path, r.RemoteAddr, validCSRF(r))
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) != 0 {
			t.Error("internal GET retained agent JSON arguments")
		}
		dispatches.Add(1)
		mux.ServeHTTP(w, r)
	})
	response := agentRequest(mounted, "/mounted/api/agent/control", `{"action":"enable","allowWrites":false}`, "", true)
	if response.Code != 200 {
		t.Fatalf("mount pairing failed: %d", response.Code)
	}
	t.Cleanup(func() {
		agentRequest(mounted, "/mounted/api/agent/control", `{"action":"disable"}`, "", true)
	})
	connectionPath, err := agent.connectionPath()
	if err != nil {
		t.Fatal(err)
	}
	connectionData, err := os.ReadFile(connectionPath)
	if err != nil {
		t.Fatal(err)
	}
	var connection agentlink.Connection
	if json.Unmarshal(connectionData, &connection) != nil || connection.URL != "http://127.0.0.1:8844/mounted" {
		t.Fatal("pairing lost its mounted base path")
	}
	call := func(ctx context.Context, name string, arguments json.RawMessage) (agentlink.Result, error) {
		body, err := json.Marshal(agentlink.Call{Name: name, Arguments: arguments})
		if err != nil {
			return agentlink.Result{}, err
		}
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8844/mounted/api/agent/call", strings.NewReader(string(body))).WithContext(ctx)
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+connection.Token)
		response := httptest.NewRecorder()
		mounted.ServeHTTP(response, request)
		if response.Code != 200 {
			return agentlink.Result{}, fmt.Errorf("outer agent response=%d", response.Code)
		}
		var result agentlink.Result
		err = json.Unmarshal(response.Body.Bytes(), &result)
		return result, err
	}
	result, err := call(context.Background(), "extension_inspect", json.RawMessage(`{"id":"lm-studio"}`))
	var snapshot extensions.Snapshot
	if err != nil || result.Status != 200 || result.State != "completed" || json.Unmarshal(result.Data, &snapshot) != nil || snapshot.SchemaVersion != 2 || len(snapshot.Extensions) != 1 || snapshot.Extensions[0].ID != "lm-studio" {
		t.Fatalf("real single handler result=%+v err=%v", result, err)
	}
	type completion struct {
		result agentlink.Result
		err    error
	}
	timedOut := make(chan completion, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	go func() {
		result, err := call(ctx, "extension_inspect", json.RawMessage(`{"id":"caddy"}`))
		timedOut <- completion{result, err}
	}()
	select {
	case id := <-started:
		if id != "caddy" {
			t.Fatalf("wrong timed lookup: %s", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed agent lookup did not start")
	}
	directCtx, directCancel := context.WithCancel(context.Background())
	defer directCancel()
	directDone := make(chan int, 1)
	go func() {
		response := httptest.NewRecorder()
		mounted.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/mounted/api/extensions?id=ngrok", nil).WithContext(directCtx))
		directDone <- response.Code
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("second native lookup did not start")
	}
	checkBusy := func() {
		t.Helper()
		busy, err := call(context.Background(), "extension_inspect", json.RawMessage(`{"id":"lm-studio"}`))
		if err != nil || busy.Status != 429 || busy.State != "failed" || !strings.Contains(busy.Preview, "two extension lookups") || lookups.Load() != 3 {
			t.Fatalf("native lookup admission was bypassed: result=%+v lookups=%d err=%v", busy, lookups.Load(), err)
		}
	}
	checkBusy()
	select {
	case completion := <-timedOut:
		if completion.err != nil || completion.result.Status != 504 || completion.result.State != "timed_out" {
			t.Fatalf("parent deadline result=%+v err=%v", completion.result, completion.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("parent deadline failed to detach from the native lookup")
	}
	directCancel()
	select {
	case status := <-directDone:
		if status != 499 {
			t.Fatalf("direct cancellation status=%d", status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("direct caller did not detach")
	}
	checkBusy()
	for _, test := range []struct{ name, args string }{
		{"extensions_list", `{}`},
		{"extension_inspect", `{"id":"chatgpt"}`},
	} {
		result, err := call(context.Background(), test.name, json.RawMessage(test.args))
		if err != nil || result.Status != 200 || result.State != "completed" || lookups.Load() != 3 {
			t.Fatalf("pure metadata waited for native slots: tool=%s result=%+v err=%v", test.name, result, err)
		}
	}
	releaseOnce.Do(func() { close(release) })
	for range 2 {
		select {
		case <-returned:
		case <-time.After(2 * time.Second):
			t.Fatal("blocked native fixture did not return")
		}
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		result, err := call(context.Background(), "extension_inspect", json.RawMessage(`{"id":"lm-studio"}`))
		if err == nil && result.Status == 200 && result.State == "completed" {
			break
		}
		if err != nil || result.Status != 429 || time.Now().After(deadline) {
			t.Fatalf("native slot did not recover: result=%+v err=%v", result, err)
		}
		time.Sleep(time.Millisecond)
	}
	if dispatches.Load() < 7 || agent.snapshot().AllowWrites {
		t.Fatal("expected read-only native internal dispatches")
	}
}
