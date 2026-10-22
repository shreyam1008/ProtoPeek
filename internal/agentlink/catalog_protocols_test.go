package agentlink

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProtocolCatalogBoundedCapabilities(t *testing.T) {
	for _, test := range []struct {
		name, args string
		writes     bool
	}{
		{"grpc_connect", `{"address":"localhost:50051","plaintext":true}`, true},
		{"grpc_schema", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"grpc.health.v1.Health.Check"}`, false},
		{"grpc_call", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"grpc.health.v1.Health.Check","data":[{}],"timeoutSeconds":0.1}`, true},
		{"grpc_disconnect", `{"sessionId":"` + strings.Repeat("a", 24) + `"}`, true},
		{"capnp_schema", `{"schemaBase64":"AAAA"}`, false},
		{"capnp_call", `{"schemaBase64":"AAAA","address":"localhost:3333","transport":"tls","timeoutMs":100,"interfaceId":"0xab","ordinal":0,"params":{},"typeBindings":{"0xab":["Text"]}}`, true},
		{"events_read", `{"protocol":"sse","url":"https://example.test/events","timeoutMs":100}`, false},
		{"packets_analyze", `{"captureBase64":"AAAA","acknowledgeSharing":true}`, false},
		{"packets_interfaces", `{"acknowledgeSharing":true}`, false},
		{"packets_capture", `{"interface":"lo","port":443,"seconds":1,"packets":1,"consent":true,"acknowledgeSharing":true}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			tool, err := Lookup(test.name, json.RawMessage(test.args))
			wantDuration := 30
			if test.name == "grpc_call" || test.name == "capnp_call" {
				wantDuration = 35
			}
			if err != nil || tool.Writes != test.writes || tool.MaxDurationSeconds != wantDuration {
				t.Fatalf("tool=%+v err=%v", tool, err)
			}
			var value map[string]any
			_ = json.Unmarshal([]byte(test.args), &value)
			value["arbitraryEndpoint"] = "/api/agent/control"
			unexpected, _ := json.Marshal(value)
			if _, err := Lookup(test.name, unexpected); err == nil {
				t.Fatal("additional capability accepted")
			}
		})
	}
}

func TestProtocolCatalogRejectsUnsafeOrUnboundedInputs(t *testing.T) {
	for _, test := range []struct{ name, args string }{
		{"grpc_connect", `{"address":"localhost:1","plaintext":false,"insecure":true}`},
		{"grpc_connect", `{"address":"localhost:1","plaintext":false,"cacertPath":"/private/ca.pem"}`},
		{"grpc_connect", `{"address":"localhost:1","plaintext":true,"protoFiles":["/private/service.proto"]}`},
		{"grpc_schema", `{"sessionId":"../escape","method":"service.Method"}`},
		{"grpc_call", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"/../../agent/control","data":[{}]}`},
		{"grpc_call", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"service.Method","data":[{}],"timeoutSeconds":30.1}`},
		{"grpc_call", `{"sessionId":"` + strings.Repeat("a", 24) + `","method":"service.Method","data":{}}`},
		{"capnp_schema", `{"schemaBase64":"AAAA","files":[{"name":"x.capnp","content":"x"}]}`},
		{"capnp_call", `{"schemaBase64":"AAAA","address":"localhost:1","transport":"insecure","timeoutMs":100}`},
		{"capnp_call", `{"schemaBase64":"AAAA","address":"localhost:1","transport":"tcp","timeoutMs":30001}`},
		{"events_read", `{"protocol":"websocket","url":"ws://localhost:1","timeoutMs":10001}`},
		{"events_read", `{"protocol":"websocket","url":"ws://localhost:1","timeoutMs":100,"data":"send me"}`},
		{"packets_analyze", `{"captureBase64":"AAAA","acknowledgeSharing":false}`},
		{"packets_analyze", `{"captureBase64":"AAAA","acknowledgeSharing":true,"reconstruct":true}`},
		{"packets_interfaces", `{}`},
		{"packets_capture", `{"interface":"lo","port":443,"seconds":11,"packets":1,"consent":true,"acknowledgeSharing":true}`},
		{"packets_capture", `{"interface":"lo","port":443,"seconds":1,"packets":2001,"consent":true,"acknowledgeSharing":true}`},
		{"packets_capture", `{"interface":"lo","port":443,"seconds":1,"packets":1,"consent":false,"acknowledgeSharing":true}`},
	} {
		t.Run(test.name+test.args, func(t *testing.T) {
			if _, err := Lookup(test.name, json.RawMessage(test.args)); err == nil {
				t.Fatal("unsafe arguments accepted")
			}
		})
	}
	for _, name := range []string{"events_send", "diagnostics", "shell", "file_read"} {
		if _, err := Lookup(name, json.RawMessage(`{}`)); err == nil {
			t.Fatal("unplanned adapter exposed", name)
		}
	}
}
