package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
)

func dispatchAgentCommand(args []string) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(args) > 1 && (args[1] == "--help" || args[1] == "-help" || args[1] == "help") || len(args) == 1 && args[0] == "agent" {
		fmt.Fprintln(os.Stdout, `ProtoPeek local agent connection

  protopeek mcp                 MCP server over stdio; attach to the paired UI
  protopeek agent tools         Print tool names and JSON input schemas
  protopeek agent guide         Print agent instructions
  protopeek agent call NAME     Read one JSON arguments object from stdin

First run ProtoPeek, then Settings > AI agents > Enable agent connection.
Pairing is saved in the user config directory; no token belongs in command arguments.
PROTOPEEK_AGENT_CONNECTION can select an absolute pairing-file path.
Keep the workbench running. Re-pair after a restart; disable access from the UI.
Calls and their results appear in AI agents. Ctrl+C cancels the current command.`)
		return 0
	}
	if args[0] == "agent" && len(args) == 2 && args[1] == "tools" {
		return agentPrint(os.Stdout, agentlink.Tools())
	}
	if args[0] == "agent" && len(args) == 2 && args[1] == "guide" {
		fmt.Fprintln(os.Stdout, agentlink.Guide)
		return 0
	}
	if args[0] == "mcp" && len(args) != 1 || args[0] == "agent" && (len(args) != 3 || args[1] != "call") {
		fmt.Fprintln(os.Stderr, "Use protopeek agent --help or protopeek mcp --help")
		return 2
	}
	connection, err := agentlink.LoadConnection()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	client, err := agentlink.NewClient(connection)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer client.HTTP.CloseIdleConnections()
	if args[0] == "mcp" {
		if err := newAgentMCPServer(client).Run(ctx, &mcp.IOTransport{Reader: newAgentMessageReader(os.Stdin), Writer: os.Stdout}); err != nil && ctx.Err() == nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	data, err := io.ReadAll(io.LimitReader(os.Stdin, agentlink.MaxInput+1))
	if err != nil || len(data) > agentlink.MaxInput {
		fmt.Fprintln(os.Stderr, "arguments exceed 128 KiB or cannot be read")
		return 2
	}
	result, err := client.Call(ctx, agentlink.Call{Name: args[2], Arguments: data})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	code := agentPrint(os.Stdout, result)
	if result.State != "completed" {
		return 1
	}
	return code
}

// Bound each stdio JSON-RPC frame before the SDK decoder allocates its object.
// The SDK still owns all MCP protocol handling, negotiation and cancellation.
type agentMessageReader struct {
	source  io.ReadCloser
	scanner *bufio.Scanner
	pending []byte
}

func newAgentMessageReader(source io.ReadCloser) *agentMessageReader {
	scanner := bufio.NewScanner(source)
	scanner.Buffer(make([]byte, 4096), 256<<10)
	return &agentMessageReader{source: source, scanner: scanner}
}
func (r *agentMessageReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if len(r.pending) == 0 {
		if !r.scanner.Scan() {
			if err := r.scanner.Err(); err != nil {
				return 0, fmt.Errorf("MCP input frame exceeds 256 KiB or cannot be read: %w", err)
			}
			return 0, io.EOF
		}
		r.pending = append(append([]byte(nil), r.scanner.Bytes()...), '\n')
	}
	n := copy(p, r.pending)
	r.pending = r.pending[n:]
	return n, nil
}
func (r *agentMessageReader) Close() error { return r.source.Close() }
func agentPrint(w io.Writer, value any) int {
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return 1
	}
	return 0
}

func newAgentMCPServer(client *agentlink.Client) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "protopeek", Version: Version}, &mcp.ServerOptions{Instructions: agentlink.Guide})
	for _, tool := range agentlink.Tools() {
		server.AddTool(&mcp.Tool{Name: tool.Name, Description: tool.Description, InputSchema: tool.InputSchema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: !tool.Writes && tool.Name != "http_request"}}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			result, err := client.Call(ctx, agentlink.Call{Name: request.Params.Name, Arguments: request.Params.Arguments})
			if err != nil {
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil
			}
			data, _ := json.Marshal(result)
			return &mcp.CallToolResult{IsError: result.State != "completed", Content: []mcp.Content{&mcp.TextContent{Text: string(data)}}}, nil
		})
	}
	server.AddResource(&mcp.Resource{URI: "protopeek://agent-guide", Name: "ProtoPeek agent guide", MIMEType: "text/plain", Description: "Workflow, limits, data handling and supported operations."}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "protopeek://agent-guide", MIMEType: "text/plain", Text: agentlink.Guide}}}, nil
	})
	return server
}
