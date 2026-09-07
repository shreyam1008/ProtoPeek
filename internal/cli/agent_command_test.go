package cli

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
)

func TestAgentStdioFrameLimit(t *testing.T) {
	r := newAgentMessageReader(io.NopCloser(strings.NewReader("{\"id\":1}\n{\"id\":2}\n")))
	data, err := io.ReadAll(r)
	if err != nil || string(data) != "{\"id\":1}\n{\"id\":2}\n" {
		t.Fatal(string(data), err)
	}
	r = newAgentMessageReader(io.NopCloser(strings.NewReader(strings.Repeat("x", 257<<10))))
	if _, err := io.ReadAll(r); err == nil {
		t.Fatal("unbounded stdio frame accepted")
	}
}

func TestAgentMCPDiscoveryResourceAndCall(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer local-test" || r.URL.Path != "/api/agent/call" {
			t.Error("wrong connection")
		}
		_ = json.NewEncoder(w).Encode(agentlink.Result{ID: "receipt", State: "completed", Status: 200, Data: json.RawMessage(`{"version":"test"}`)})
	}))
	defer api.Close()
	bridge, err := agentlink.NewClient(agentlink.Connection{URL: api.URL, Token: "local-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.HTTP.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := newAgentMCPServer(bridge).Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "1"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	list, err := session.ListTools(ctx, nil)
	if err != nil || len(list.Tools) != len(agentlink.Tools()) {
		t.Fatal(list, err)
	}
	guide, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "protopeek://agent-guide"})
	if err != nil || len(guide.Contents) != 1 || guide.Contents[0].Text != agentlink.Guide {
		t.Fatal(guide, err)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "workbench_info", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatal(result, err)
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "http_request", Arguments: map[string]any{"method": "DESTROY"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("invalid arguments succeeded")
	}
}
