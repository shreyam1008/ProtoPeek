package standalone

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
	"github.com/shreyam1008/ProtoPeek/testing/capnpfixture"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

func callAgentProtocol(t *testing.T, handler http.Handler, token, name string, args json.RawMessage) agentlink.Result {
	t.Helper()
	body, err := json.Marshal(agentlink.Call{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	response := agentRequest(handler, "/api/agent/call", string(body), token, false)
	if response.Code != http.StatusOK {
		t.Fatalf("%s: outer status %d: %s", name, response.Code, response.Body.String())
	}
	if response.Body.Len() > agentlink.MaxOutput {
		t.Fatal("agent envelope exceeded output cap")
	}
	var result agentlink.Result
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

type agentProtocolHealthServer struct {
	grpc_health_v1.UnimplementedHealthServer
}

func (agentProtocolHealthServer) Check(ctx context.Context, input *grpc_health_v1.HealthCheckRequest) (*grpc_health_v1.HealthCheckResponse, error) {
	_ = grpc.SetHeader(ctx, metadata.Pairs("x-fixture", "headers"))
	grpc.SetTrailer(ctx, metadata.Pairs("x-fixture", "trailers"))
	if input.Service == "denied" {
		return nil, status.Error(codes.PermissionDenied, "fixture denied")
	}
	if input.Service == "metadata" {
		md, _ := metadata.FromIncomingContext(ctx)
		if len(md.Get("x-request")) != 1 || md.Get("x-request")[0] != "fixture" {
			return nil, status.Error(codes.InvalidArgument, "missing fixture metadata")
		}
	}
	return &grpc_health_v1.HealthCheckResponse{Status: grpc_health_v1.HealthCheckResponse_SERVING}, nil
}

func TestAgentGRPCReflectionSchemaCallAndDisconnect(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	grpc_health_v1.RegisterHealthServer(server, agentProtocolHealthServer{})
	reflection.Register(server)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	manager := NewWorkspaceManager(WorkspaceManagerOptions{ConnectFailFast: true})
	t.Cleanup(func() { _ = manager.Close() })
	mux, agent := agentHarness(t)
	agent.mux = Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	token := agentEnable(t, mux, agent, false)
	args, _ := json.Marshal(map[string]any{"address": listener.Addr().String(), "plaintext": true})
	denied, _ := json.Marshal(agentlink.Call{Name: "grpc_connect", Arguments: args})
	if response := agentRequest(mux, "/api/agent/call", string(denied), token, false); response.Code != 403 || len(agent.snapshot().Records) != 0 {
		t.Fatal("connection bypassed write policy")
	}
	token = agentEnable(t, mux, agent, true)
	connected := callAgentProtocol(t, mux, token, "grpc_connect", args)
	var connection WorkspaceConnectResponse
	if connected.Status != 200 || json.Unmarshal(connected.Data, &connection) != nil || connection.SessionID == "" {
		t.Fatalf("connect: %+v", connected)
	}
	if _, found := manager.Session(connection.SessionID); !found {
		t.Fatal("no actual workspace session")
	}
	schema := callAgentProtocol(t, mux, token, "grpc_schema", json.RawMessage(`{"sessionId":"`+connection.SessionID+`","method":"grpc.health.v1.Health.Check"}`))
	if schema.Status != 200 || !bytes.Contains(schema.Data, []byte("HealthCheckRequest")) {
		t.Fatalf("schema: %+v", schema)
	}
	called := callAgentProtocol(t, mux, token, "grpc_call", json.RawMessage(`{"sessionId":"`+connection.SessionID+`","method":"grpc.health.v1.Health.Check","data":[{"service":"metadata"}],"metadata":[{"name":"x-request","value":"fixture"}],"timeoutSeconds":1}`))
	for _, evidence := range []string{"SERVING", `"headers"`, `"trailers"`, "x-fixture"} {
		if !bytes.Contains(called.Data, []byte(evidence)) {
			t.Fatalf("missing native %q: %s", evidence, called.Data)
		}
	}
	failed := callAgentProtocol(t, mux, token, "grpc_call", json.RawMessage(`{"sessionId":"`+connection.SessionID+`","method":"grpc.health.v1.Health.Check","data":[{"service":"denied"}]}`))
	if failed.Status != 200 || failed.State != "failed" || !bytes.Contains(failed.Data, []byte(`"code":7`)) || !bytes.Contains(failed.Data, []byte("fixture denied")) {
		t.Fatalf("lost protocol error: %+v", failed)
	}
	disconnected := callAgentProtocol(t, mux, token, "grpc_disconnect", json.RawMessage(`{"sessionId":"`+connection.SessionID+`"}`))
	if disconnected.Status != 204 || disconnected.Truncated || len(disconnected.Data) > 0 {
		t.Fatalf("disconnect: %+v", disconnected)
	}
	if _, found := manager.Session(connection.SessionID); found {
		t.Fatal("workspace connection survived explicit disconnect")
	}
}

func TestAgentCapnpBinarySchemaAndExactTypedCall(t *testing.T) {
	raw, err := os.ReadFile("../internal/capnpwork/testdata/workbench.bin")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			socket, err := listener.Accept()
			if err != nil {
				return
			}
			go capnpfixture.ServeConnection(socket)
		}
	}()
	mux, agent := agentHarness(t)
	backend := http.NewServeMux()
	registerCapnpWorkbench(backend)
	agent.mux = backend
	token := agentEnable(t, mux, agent, true)
	encoded := base64.StdEncoding.EncodeToString(raw)
	parsed := callAgentProtocol(t, mux, token, "capnp_schema", json.RawMessage(`{"schemaBase64":"`+encoded+`"}`))
	if parsed.Status != 200 || !bytes.Contains(parsed.Data, []byte(`"name":"echo"`)) {
		t.Fatalf("schema: %+v", parsed)
	}
	called := callAgentProtocol(t, mux, token, "capnp_call", json.RawMessage(`{"schemaBase64":"`+encoded+`","address":"`+listener.Addr().String()+`","transport":"tcp","timeoutMs":1000,"interfaceId":"0xb1529bf8e102de33","ordinal":1,"params":{"a":9007199254740993,"b":7}}`))
	if called.Status != 200 || !bytes.Contains(called.Data, []byte(`"sum":"9007199254741000"`)) {
		t.Fatalf("typed call: %+v", called)
	}
	partial := callAgentProtocol(t, mux, token, "capnp_call", json.RawMessage(`{"schemaBase64":"`+encoded+`","address":"`+listener.Addr().String()+`","transport":"tcp","timeoutMs":1000,"steps":[{"interfaceId":"0xb1529bf8e102de33","ordinal":1,"params":{"a":9007199254740993,"b":7}},{"interfaceId":"0xb1529bf8e102de33","ordinal":2,"params":{}}]}`))
	if partial.Status != 200 || partial.State != "partial" || !bytes.Contains(partial.Data, []byte(`"sum":"9007199254741000"`)) || !bytes.Contains(partial.Data, []byte("deliberate QA RPC failure")) {
		t.Fatalf("lost partial plan evidence: %+v", partial)
	}
}

func TestAgentFiniteSSEAndWebSocketCleanup(t *testing.T) {
	closed := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sse" {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "id: 17\nevent: fixture\ndata: received\n\n")
			return
		}
		if r.URL.Path == "/sse-limit" {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, strings.Repeat("data: x\n\n", maxStreamEvents+1))
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		defer close(closed)
		if err := conn.Write(r.Context(), websocket.MessageText, []byte("fixture-push")); err != nil {
			return
		}
		if _, _, err := conn.Read(r.Context()); err == nil {
			t.Error("receive-only adapter sent an application message")
		}
	}))
	t.Cleanup(upstream.Close)
	streams := &eventStreams{sockets: make(map[string]*liveWebSocket)}
	backend := http.NewServeMux()
	limiter := newAdmissionLimiter(2)
	backend.HandleFunc("/api/events/connect", func(w http.ResponseWriter, r *http.Request) {
		if validateAdmittedPOST(w, r) {
			limiter.serveHTTP("Event streams", w, r, http.HandlerFunc(streams.connect))
		}
	})
	mux, agent := agentHarness(t)
	agent.mux = backend
	token := agentEnable(t, mux, agent, false)
	sse := callAgentProtocol(t, mux, token, "events_read", json.RawMessage(`{"protocol":"sse","url":"`+upstream.URL+`/sse","timeoutMs":1000}`))
	for _, evidence := range []string{`"format":"ndjson"`, `"kind":"open"`, `"data":"received"`, `"id":"17"`, `"kind":"closed"`} {
		if sse.Status != 200 || !bytes.Contains(sse.Data, []byte(evidence)) {
			t.Fatalf("missing SSE %q: %+v", evidence, sse)
		}
	}
	limited := callAgentProtocol(t, mux, token, "events_read", json.RawMessage(`{"protocol":"sse","url":"`+upstream.URL+`/sse-limit","timeoutMs":1000}`))
	if limited.State != "partial" || !bytes.Contains(limited.Data, []byte("stopped after 500 events")) {
		t.Fatalf("native SSE cap presented as completed: %+v", limited)
	}
	ws := callAgentProtocol(t, mux, token, "events_read", json.RawMessage(`{"protocol":"websocket","url":"`+strings.Replace(upstream.URL, "http", "ws", 1)+`/ws","timeoutMs":100}`))
	if ws.Status != 200 || !bytes.Contains(ws.Data, []byte("fixture-push")) || !bytes.Contains(ws.Data, []byte("Session duration reached")) {
		t.Fatalf("websocket: %+v", ws)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("WebSocket socket survived result")
	}
	streams.mu.Lock()
	remaining := len(streams.sockets)
	streams.mu.Unlock()
	if remaining != 0 {
		t.Fatal("event session remained reusable after result")
	}
}

func TestAgentPacketFileMetadataAndCaptureTranslation(t *testing.T) {
	raw, err := os.ReadFile("../internal/packetwork/testdata/tcp-evidence.pcap")
	if err != nil {
		t.Fatal(err)
	}
	mux, agent := agentHarness(t)
	backend := http.NewServeMux()
	registerPacketWorkbench(backend)
	agent.mux = backend
	token := agentEnable(t, mux, agent, false)
	analyzed := callAgentProtocol(t, mux, token, "packets_analyze", json.RawMessage(`{"captureBase64":"`+base64.StdEncoding.EncodeToString(raw)+`","acknowledgeSharing":true}`))
	if analyzed.Status != 200 || !bytes.Contains(analyzed.Data, []byte(`"format":"PCAP"`)) || bytes.Contains(analyzed.Data, []byte(`"reconstruction"`)) || bytes.Contains(analyzed.Data, []byte(`"payload"`)) {
		t.Fatalf("packet metadata: %+v", analyzed)
	}
	var captureCalls atomic.Int32
	captureBackend := http.NewServeMux()
	captureBackend.HandleFunc("/api/packets/capture", func(w http.ResponseWriter, r *http.Request) {
		if !validateAdmittedPOST(w, r) {
			return
		}
		var capture packetwork.CaptureRequest
		if !decodeStrictTransferJSON(w, r, 4096, &capture) {
			return
		}
		if !capture.Consent || capture.Interface != "lo" || capture.Port != 443 || capture.Seconds != 1 || capture.Packets != 2 {
			t.Errorf("wrong capture arguments: %+v", capture)
		}
		captureCalls.Add(1)
		writeTransferJSON(w, 200, map[string]bool{"fixtureOnly": true})
	})
	agent.mux = captureBackend
	capture := json.RawMessage(`{"interface":"lo","port":443,"seconds":1,"packets":2,"consent":true,"acknowledgeSharing":true}`)
	body, _ := json.Marshal(agentlink.Call{Name: "packets_capture", Arguments: capture})
	if response := agentRequest(mux, "/api/agent/call", string(body), token, false); response.Code != 403 || captureCalls.Load() != 0 {
		t.Fatal("capture bypassed write policy")
	}
	token = agentEnable(t, mux, agent, true)
	called := callAgentProtocol(t, mux, token, "packets_capture", capture)
	if called.Status != 200 || captureCalls.Load() != 1 {
		t.Fatalf("capture fixture translation: %+v", called)
	}
	invalid := callAgentProtocol(t, mux, token, "packets_capture", json.RawMessage(`{"interface":"tcp@remote","port":443,"seconds":1,"packets":2,"consent":true,"acknowledgeSharing":true}`))
	if invalid.Status != 400 || captureCalls.Load() != 1 {
		t.Fatal("invalid remote capture interface reached operation")
	}
}

func TestAgentProtocolBinaryAndOutputBounds(t *testing.T) {
	if _, err := decodeAgentBinary(base64.StdEncoding.EncodeToString(make([]byte, agentlink.MaxSharedBinaryBytes+1))); err == nil {
		t.Fatal("decoded boundary bypassed equal encoded length")
	}
	if _, err := decodeAgentBinary("AB=="); err == nil {
		t.Fatal("noncanonical base64 accepted")
	}
	writer := &agentResponseWriter{header: make(http.Header)}
	if err := http.NewResponseController(writer).Flush(); err != nil {
		t.Fatal(err)
	}
	_, _ = writer.Write(bytes.Repeat([]byte{'x'}, agentlink.MaxOutput))
	if writer.body.Len() != agentlink.MaxOutput/2 || !writer.overflow || writer.FlushError() == nil {
		t.Fatal("stream sink is unbounded or ignored overflow")
	}
	writer = &agentResponseWriter{header: make(http.Header)}
	_, _ = writer.Write([]byte("{\"kind\":\"open\"}\n{\"kind\":\"message\",\"data\":\"partial"))
	result := agentEventResult(writer)
	if !result.Truncated || !bytes.Contains(result.Data, []byte(`"kind":"open"`)) || bytes.Contains(result.Data, []byte(`"kind":"message"`)) {
		t.Fatalf("fabricated truncated event: %+v", result)
	}
}

func TestAgentEventOutputLimitClosesUpstreamAndRetainsCompleteEvents(t *testing.T) {
	finished := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		defer close(finished)
		w.Header().Set("Content-Type", "text/event-stream")
		for range 2000 {
			if _, err := io.WriteString(w, "data: "+strings.Repeat("x", 2048)+"\n\n"); err != nil {
				return
			}
		}
	}))
	t.Cleanup(upstream.Close)
	mux, agent := agentHarness(t)
	backend := http.NewServeMux()
	registerEventStreams(backend)
	agent.mux = backend
	token := agentEnable(t, mux, agent, false)
	result := callAgentProtocol(t, mux, token, "events_read", json.RawMessage(`{"protocol":"sse","url":"`+upstream.URL+`","timeoutMs":1000}`))
	if result.Status != 200 || !result.Truncated || result.State != "partial" || !json.Valid(result.Data) || len(result.Data) > agentlink.MaxOutput {
		t.Fatalf("output boundary: status=%d state=%s bytes=%d", result.Status, result.State, len(result.Data))
	}
	var captured struct {
		Events []streamEvent `json:"events"`
	}
	if json.Unmarshal(result.Data, &captured) != nil || len(captured.Events) < 2 || captured.Events[len(captured.Events)-1].Kind == "closed" {
		t.Fatal("fabricated terminal event after overflow")
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("upstream response remained live after bounded result")
	}
}

func TestAgentRPCDeadlinesReserveNativeResultMargin(t *testing.T) {
	for _, test := range []struct {
		name, args, timeoutField, data, state string
		nativeTimeout                         float64
	}{
		{"grpc_call", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"service.Method","data":[{}]}`, "timeout_seconds", `{"error":{"code":4,"message":"native deadline"},"responses":[{"observed":true}]}`, "failed", 30},
		{"capnp_call", `{"schemaBase64":"AAAA","address":"localhost:1","transport":"tcp","timeoutMs":30000}`, "timeoutMs", `{"plan":{"completed":false,"sentSteps":2,"steps":[{"result":{"observed":true}},{"error":"native deadline"}]}}`, "partial", 30000},
	} {
		t.Run(test.name, func(t *testing.T) {
			mux, agent := agentHarness(t)
			agent.mux = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				deadline, ok := r.Context().Deadline()
				remaining := time.Until(deadline)
				if !ok || remaining < 33*time.Second || remaining > 35*time.Second {
					t.Errorf("RPC agent wall lacks fixed native-result margin: %v", remaining)
				}
				var input map[string]any
				if json.NewDecoder(r.Body).Decode(&input) != nil || input[test.timeoutField] != test.nativeTimeout {
					t.Errorf("native timeout changed: %+v", input)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, test.data)
			})
			token := agentEnable(t, mux, agent, true)
			result := callAgentProtocol(t, mux, token, test.name, json.RawMessage(test.args))
			if result.Status != 200 || result.State != test.state || string(result.Data) != test.data {
				t.Fatalf("native deadline evidence was replaced: %+v", result)
			}
		})
	}
}

func TestAgentProtocolCompletionUsesNativeEvidence(t *testing.T) {
	for _, test := range []struct{ name, data, state string }{
		{"grpc_call", `{"error":{"code":7,"message":"denied"}}`, "failed"},
		{"grpc_call", `{"error":null,"localLimit":{"reason":"response-count"}}`, "partial"},
		{"grpc_call", `{"error":null,"localLimit":null}`, "completed"},
		{"capnp_call", `{"plan":{"completed":false,"sentSteps":1}}`, "partial"},
		{"capnp_call", `{"plan":{"completed":true,"sentSteps":2}}`, "completed"},
		{"packets_analyze", `{"limited":true}`, "partial"},
		{"events_read", `{"events":[{"kind":"open"},{"kind":"limit"}]}`, "partial"},
		{"events_read", `{"events":[{"kind":"closed","detail":"event exceeds 64 KiB"}]}`, "partial"},
		{"events_read", `{"events":[{"kind":"closed","status":1008,"detail":"policy violation"}]}`, "failed"},
		{"events_read", `{"events":[{"kind":"closed","status":1000,"detail":"normal close"}]}`, "completed"},
	} {
		tool, err := agentlink.Lookup(test.name, minimalProtocolArguments(test.name))
		if err != nil {
			t.Fatal(err)
		}
		result := agentlink.Result{Status: 200, Data: json.RawMessage(test.data)}
		if got := agentCompletionState(tool, result); got != test.state {
			t.Fatalf("%s: %s want %s", test.name, got, test.state)
		}
		if string(result.Data) != test.data || result.Status != 200 {
			t.Fatal("classification changed original protocol evidence")
		}
		result.Truncated = true
		if agentCompletionState(tool, result) != "partial" {
			t.Fatal("truncation presented as complete")
		}
	}
}

func minimalProtocolArguments(name string) json.RawMessage {
	switch name {
	case "grpc_call":
		return json.RawMessage(`{"sessionId":"` + strings.Repeat("a", 24) + `","method":"service.Method","data":[{}]}`)
	case "capnp_call":
		return json.RawMessage(`{"schemaBase64":"AAAA","address":"localhost:1","transport":"tcp","timeoutMs":100}`)
	case "packets_analyze":
		return json.RawMessage(`{"captureBase64":"AAAA","acknowledgeSharing":true}`)
	default:
		return json.RawMessage(`{"protocol":"sse","url":"http://localhost:1","timeoutMs":100}`)
	}
}
