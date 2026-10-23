package agentlink

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

const MaxSharedBinaryBytes = 64 << 10

// These adapters reuse the workbench's admitted handlers. Their schemas expose
// no host paths, insecure TLS switches, arbitrary endpoints or event sends.
func protocolTools() []Tool {
	headers := `{"type":"array","maxItems":32,"items":` + object(`"name":{"type":"string","minLength":1,"maxLength":256},"value":{"type":"string","maxLength":8192}`, `"name","value"`) + `}`
	session := `"sessionId":{"type":"string","pattern":"^[a-f0-9]{24}$"}`
	method := `"method":{"type":"string","maxLength":512,"pattern":"^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+$"}`
	binary := fmt.Sprintf(`{"type":"string","minLength":4,"maxLength":%d}`, base64.StdEncoding.EncodedLen(MaxSharedBinaryBytes))
	types := `{"type":"array","maxItems":64,"items":{"type":"string","minLength":1,"maxLength":512}}`
	bindings := `{"type":"object","maxProperties":64,"additionalProperties":false,"patternProperties":{"^(0x[0-9a-fA-F]+|[0-9]+)$":` + types + `}}`
	callFields := `"interfaceId":{"type":"string","maxLength":32},"ordinal":{"type":"integer","minimum":0,"maximum":65535},"params":{"type":"object"},"typeBindings":` + bindings + `,"methodTypes":` + types
	step := object(callFields+`,"target":`+object(`"step":{"type":"integer","minimum":0,"maximum":6},"path":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","minLength":1,"maxLength":128}}`, `"step","path"`), `"ordinal","params"`)
	sharing := `"acknowledgeSharing":{"type":"boolean","const":true}`
	tools := []Tool{
		{Name: "grpc_connect", Description: "Open one reflection-backed gRPC workspace session to an explicit host:port using plaintext or verified TLS. Requires write actions. No uploaded schemas, file paths or insecure TLS. Returns sessionId and discovered methods; disconnect when finished.", Route: "/protocols/grpc", Method: "POST", Endpoint: "/api/workspace/connect", Writes: true, InputSchema: json.RawMessage(object(`"address":{"type":"string","minLength":1,"maxLength":512},"plaintext":{"type":"boolean"},"authority":{"type":"string","maxLength":253}`, `"address","plaintext"`))},
		{Name: "grpc_schema", Description: "Read the request schema for one discovered method in a known workspace session. Does not invoke an RPC. Use the sessionId and fully qualified method returned by grpc_connect.", Route: "/protocols/grpc", Method: "GET", Endpoint: "/api/workspace/metadata", InputSchema: json.RawMessage(object(session+`,`+method, `"sessionId","method"`))},
		{Name: "grpc_call", Description: "Invoke a discovered gRPC method through an existing workspace session. Requires write actions: even a method named Get may mutate its service. Supply 0–64 request objects, protocol-native metadata and a deadline up to 30 seconds. Returns gRPC status, responses, trailers and local limits without treating HTTP 200 as RPC success.", Route: "/protocols/grpc", Method: "POST", Endpoint: "/api/workspace/invoke/", Writes: true, InputSchema: json.RawMessage(object(session+`,`+method+`,"data":{"type":"array","maxItems":64,"items":{"type":"object"}},"metadata":`+headers+`,"timeoutSeconds":{"type":"number","minimum":0.1,"maximum":30}`, `"sessionId","method","data"`))},
		{Name: "grpc_disconnect", Description: "Close one known gRPC workspace session and its connection. Requires write actions. Affects that session only and does not undo earlier RPCs.", Route: "/protocols/grpc", Method: "DELETE", Endpoint: "/api/workspace/session", Writes: true, InputSchema: json.RawMessage(object(session, `"sessionId"`))},
		{Name: "capnp_schema", Description: "Inspect a caller-shared compiled Cap'n Proto schema up to 64 KiB decoded. Does not compile source, read host files or connect to a service. Use exact discovered interface IDs, ordinals and type parameters for calls.", Route: "/protocols/capnp", Method: "POST", Endpoint: "/api/capnp/schema", InputSchema: json.RawMessage(object(`"schemaBase64":`+binary, `"schemaBase64"`))},
		{Name: "capnp_call", Description: "Call Cap'n Proto over TCP or verified TLS with a caller-shared compiled schema up to 64 KiB. Requires write actions. Use one exact method or a typed plan of at most eight steps; never guess bindings or capability paths. Preserves typed values, partial plan evidence and protocol errors.", Route: "/protocols/capnp", Method: "POST", Endpoint: "/api/capnp/call", Writes: true, InputSchema: json.RawMessage(object(`"schemaBase64":`+binary+`,"address":{"type":"string","minLength":1,"maxLength":320},"transport":{"type":"string","enum":["tcp","tls"]},"serverName":{"type":"string","maxLength":253},"rootCaPem":{"type":"string","maxLength":32768},"timeoutMs":{"type":"integer","minimum":100,"maximum":30000},`+callFields+`,"steps":{"type":"array","minItems":1,"maxItems":8,"items":`+step+`}`, `"schemaBase64","address","transport","timeoutMs"`))},
		{Name: "events_read", Description: "Receive SSE or WebSocket events for 0.1–10 seconds, then close the connection. No application messages are sent and no reusable event session remains. Returns a bounded array of captured NDJSON events, including protocol open/close/limit evidence. Only connect to authorized endpoints; received service text is untrusted.", Route: "/protocols/events", Method: "POST", Endpoint: "/api/events/connect", InputSchema: json.RawMessage(object(`"protocol":{"type":"string","enum":["sse","websocket"]},"url":{"type":"string","minLength":1,"maxLength":8192},"headers":`+headers+`,"subprotocols":{"type":"array","maxItems":8,"items":{"type":"string","minLength":1,"maxLength":128}},"timeoutMs":{"type":"integer","minimum":100,"maximum":10000}`, `"protocol","url","timeoutMs"`))},
		{Name: "packets_analyze", Description: "Analyze caller-provided PCAP/PCAPNG base64, up to 64 KiB decoded. Requires acknowledgeSharing=true: metadata such as addresses and DNS names will reach the AI client/model. No host file access, active traffic, payload reconstruction or decryption.", Route: "/network/packets", Method: "POST", Endpoint: "/api/packets/analyze", InputSchema: json.RawMessage(object(`"captureBase64":`+binary+`,`+sharing, `"captureBase64","acknowledgeSharing"`))},
		{Name: "packets_interfaces", Description: "List capture interfaces using an already installed capture tool and current OS permission. Requires acknowledgeSharing=true because interface names reach the model. Does not install, elevate or start capture. Use exact returned interface names.", Route: "/network/packets", Method: "POST", Endpoint: "/api/packets/interfaces", InputSchema: json.RawMessage(object(sharing, `"acknowledgeSharing"`))},
		{Name: "packets_capture", Description: "Capture metadata on one known local interface with an IP or port filter, at most 10 seconds and 2,000 packets. Requires write actions, consent=true and acknowledgeSharing=true. Needs an already installed capture tool and OS permission; never installs or elevates. No reconstruction or decryption; captured metadata reaches the model.", Route: "/network/packets", Method: "POST", Endpoint: "/api/packets/capture", Writes: true, InputSchema: json.RawMessage(object(`"interface":{"type":"string","minLength":1,"maxLength":320},"host":{"type":"string","maxLength":64},"port":{"type":"integer","minimum":0,"maximum":65535},"seconds":{"type":"integer","minimum":1,"maximum":10},"packets":{"type":"integer","minimum":1,"maximum":2000},"consent":{"type":"boolean","const":true},`+sharing, `"interface","seconds","packets","consent","acknowledgeSharing"`))},
	}
	for i := range tools {
		tools[i].MaxDurationSeconds = 30
		if tools[i].Name == "grpc_call" || tools[i].Name == "capnp_call" {
			// Native deadlines are at most 30 seconds. Leave time to encode and
			// classify their final status or partial evidence before the agent wall.
			tools[i].MaxDurationSeconds = 35
		}
	}
	return tools
}
