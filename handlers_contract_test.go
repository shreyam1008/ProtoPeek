package grpcui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	oldproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
)

func TestNewRPCResultMarshalsCollectionsAsArrays(t *testing.T) {
	t.Parallel()

	stats := rpcRequestStats{Total: 1}
	encoded, err := json.Marshal(newRPCResult(nil, false, &stats))
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	for _, key := range []string{"headers", "responses", "trailers"} {
		value, ok := payload[key].([]any)
		if !ok {
			t.Fatalf("%s = %#v, want JSON array", key, payload[key])
		}
		if len(value) != 0 {
			t.Fatalf("%s length = %d, want 0", key, len(value))
		}
	}
}

func TestRPCInvokeHandlerAcceptsJSONParameters(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodPost, "/missing", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	res := httptest.NewRecorder()
	RPCInvokeHandler(nil, nil).ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want method lookup to reach 404", res.Code)
	}
}

func TestRPCInvokeHandlerBoundsRequestBody(t *testing.T) {
	t.Parallel()

	file, err := desc.CreateFileDescriptor(&descriptor.FileDescriptorProto{
		Name:    oldproto.String("invoke_limit.proto"),
		Package: oldproto.String("test"),
		MessageType: []*descriptor.DescriptorProto{{
			Name: oldproto.String("Empty"),
		}},
		Service: []*descriptor.ServiceDescriptorProto{{
			Name: oldproto.String("LimitService"),
			Method: []*descriptor.MethodDescriptorProto{{
				Name:       oldproto.String("Call"),
				InputType:  oldproto.String(".test.Empty"),
				OutputType: oldproto.String(".test.Empty"),
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create descriptor: %v", err)
	}
	method := file.FindService("test.LimitService").FindMethodByName("Call")
	req := httptest.NewRequest(
		http.MethodPost,
		"/test.LimitService.Call",
		strings.NewReader(strings.Repeat(" ", maxInvokeRequestBodyBytes+1)),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	RPCInvokeHandler(nil, []*desc.MethodDescriptor{method}).ServeHTTP(res, req)
	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %q", res.Code, res.Body.String())
	}
}
