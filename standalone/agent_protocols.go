package standalone

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
)

// Only the allowlisted catalog reaches this translation. Calls still traverse
// each existing operation's admission, CSRF, parser, validation and cancellation.
func agentProtocolRequest(ctx context.Context, tool agentlink.Tool, endpoint string, input json.RawMessage) (*http.Request, error) {
	contentType := "application/json"
	switch tool.Name {
	case "grpc_connect":
		var args struct {
			Address   string `json:"address"`
			Plaintext bool   `json:"plaintext"`
			Authority string `json:"authority"`
		}
		if err := json.Unmarshal(input, &args); err != nil {
			return nil, err
		}
		host, port, err := net.SplitHostPort(args.Address)
		numericPort, portErr := strconv.ParseUint(port, 10, 16)
		if err != nil || portErr != nil || numericPort == 0 || host == "" ||
			strings.ContainsAny(host+args.Authority, "/\\@?#\r\n\t ") {
			return nil, errors.New("gRPC requires an explicit host:port and a valid authority, without paths or credentials")
		}
		input, _ = json.Marshal(map[string]any{"target": WorkspaceTargetConfig{
			Address: args.Address, Plaintext: args.Plaintext, Authority: args.Authority, SchemaSource: "reflection",
		}})
	case "grpc_schema", "grpc_disconnect", "grpc_call":
		var args struct {
			SessionID      string          `json:"sessionId"`
			Method         string          `json:"method"`
			Data           json.RawMessage `json:"data"`
			Metadata       json.RawMessage `json:"metadata"`
			TimeoutSeconds float64         `json:"timeoutSeconds"`
		}
		if err := json.Unmarshal(input, &args); err != nil {
			return nil, err
		}
		query := url.Values{"session_id": {args.SessionID}}
		input = nil
		if tool.Name == "grpc_schema" {
			query.Set("method", args.Method)
		} else if tool.Name == "grpc_call" {
			endpoint += url.PathEscape(args.Method)
			if args.TimeoutSeconds == 0 {
				args.TimeoutSeconds = 30
			}
			payload := map[string]any{"data": args.Data, "timeout_seconds": args.TimeoutSeconds}
			if len(args.Metadata) > 0 {
				payload["metadata"] = args.Metadata
			}
			input, _ = json.Marshal(payload)
		}
		endpoint += "?" + query.Encode()
	case "capnp_schema", "capnp_call":
		var args struct {
			SchemaBase64 string `json:"schemaBase64"`
		}
		if err := json.Unmarshal(input, &args); err != nil {
			return nil, err
		}
		if _, err := decodeAgentBinary(args.SchemaBase64); err != nil {
			return nil, err
		}
	case "packets_analyze":
		var args struct {
			CaptureBase64 string `json:"captureBase64"`
		}
		if err := json.Unmarshal(input, &args); err != nil {
			return nil, err
		}
		raw, err := decodeAgentBinary(args.CaptureBase64)
		if err != nil {
			return nil, err
		}
		input, contentType = raw, "application/octet-stream"
	case "packets_interfaces":
		input = json.RawMessage(`{}`)
	case "packets_capture":
		var capture packetwork.CaptureRequest
		if err := json.Unmarshal(input, &capture); err != nil {
			return nil, err
		}
		// Validate before locating or starting any installed capture executable.
		if _, err := packetwork.PlanCapture(capture); err != nil {
			return nil, err
		}
		input, _ = json.Marshal(capture)
	}
	request, err := http.NewRequestWithContext(ctx, tool.Method, endpoint, bytes.NewReader(input))
	if err == nil {
		request.Header.Set("Content-Type", contentType)
	}
	return request, err
}

func decodeAgentBinary(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(agentlink.MaxSharedBinaryBytes) {
		return nil, errors.New("shared binary input exceeds 64 KiB")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) == 0 || len(raw) > agentlink.MaxSharedBinaryBytes {
		return nil, errors.New("provide valid nonempty base64 decoding to at most 64 KiB")
	}
	return raw, nil
}

func agentEventResult(writer *agentResponseWriter) agentlink.Result {
	events := make([]json.RawMessage, 0)
	partial := writer.overflow
	for _, line := range bytes.Split(writer.body.Bytes(), []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if !json.Valid(line) {
			partial = true
			break // Do not fabricate the final portion of a truncated event.
		}
		events = append(events, json.RawMessage(line))
	}
	data, err := json.Marshal(struct {
		Format  string            `json:"format"`
		Events  []json.RawMessage `json:"events"`
		Partial bool              `json:"partial"`
	}{"ndjson", events, partial})
	if err != nil {
		return agentlink.Result{Status: http.StatusBadGateway, Preview: "Event evidence could not be encoded", Truncated: true}
	}
	return agentlink.Result{Status: writer.status, Data: data, Truncated: partial}
}

// Transport completion does not imply RPC success or complete retained evidence.
// The original status and data remain intact for protocol-native inspection.
func agentCompletionState(tool agentlink.Tool, result agentlink.Result) string {
	if result.Status >= 400 {
		return "failed"
	}
	if tool.MaxDurationSeconds > 0 && result.Truncated {
		return "partial"
	}
	switch tool.Name {
	case "grpc_call":
		var native struct {
			Error *struct {
				Code uint32 `json:"code"`
			} `json:"error"`
			LocalLimit json.RawMessage `json:"localLimit"`
		}
		if json.Unmarshal(result.Data, &native) != nil {
			return "partial"
		}
		if native.Error != nil && native.Error.Code != 0 {
			return "failed"
		}
		if len(native.LocalLimit) > 0 && !bytes.Equal(bytes.TrimSpace(native.LocalLimit), []byte("null")) {
			return "partial"
		}
	case "capnp_call":
		var native struct {
			Plan *struct {
				Completed bool `json:"completed"`
			} `json:"plan"`
		}
		if json.Unmarshal(result.Data, &native) != nil {
			return "partial"
		}
		if native.Plan != nil && !native.Plan.Completed {
			return "partial"
		}
	case "packets_analyze", "packets_capture":
		var native struct {
			Limited bool `json:"limited"`
		}
		if json.Unmarshal(result.Data, &native) == nil && native.Limited {
			return "partial"
		}
	case "events_read":
		var native struct {
			Events []streamEvent `json:"events"`
		}
		if json.Unmarshal(result.Data, &native) != nil {
			return "partial"
		}
		for _, event := range native.Events {
			if event.Kind == "limit" {
				return "partial"
			}
			if event.Kind != "closed" {
				continue
			}
			if event.Status >= 1000 && event.Status != 1000 && event.Status != 1001 {
				return "failed"
			}
			if event.Status == 0 && event.Detail != "Server ended the event stream" && event.Detail != "Session duration reached" && event.Detail != "Connection closed" {
				return "partial"
			}
		}
	}
	return "completed"
}
