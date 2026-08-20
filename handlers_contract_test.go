package grpcui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	timings, ok := payload["timings"].(map[string]any)
	if !ok {
		t.Fatalf("timings = %#v, want JSON object", payload["timings"])
	}
	for _, key := range []string{"headersMs", "firstMessageMs", "trailersMs"} {
		if value, present := timings[key]; !present || value != nil {
			t.Fatalf("timings.%s = %#v (present %t), want explicit null", key, value, present)
		}
	}
	if total, ok := timings["totalMs"].(float64); !ok || total != 0 {
		t.Fatalf("timings.totalMs = %#v, want numeric zero before completion", timings["totalMs"])
	}
}

func TestRPCResultMarshalsMeasuredZeroAndOmitsUnavailableElapsedTime(t *testing.T) {
	t.Parallel()

	clock := &rpcTestClock{current: time.Unix(1_700_000_000, 0)}
	result := newRPCResultWithClock(nil, false, nil, clock.Now)
	clock.Advance(500 * time.Microsecond)
	result.OnReceiveResponse(&timingProtoMessage{})
	result.Error = &rpcError{
		Details: []rpcResponseElement{{Data: json.RawMessage(`{}`)}},
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	var payload struct {
		Responses []map[string]json.RawMessage `json:"responses"`
		Error     struct {
			Details []map[string]json.RawMessage `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if len(payload.Responses) != 1 || len(payload.Error.Details) != 1 {
		t.Fatalf("response/detail lengths = %d/%d, want 1/1", len(payload.Responses), len(payload.Error.Details))
	}

	responseElapsed, present := payload.Responses[0]["elapsedMs"]
	if !present || string(responseElapsed) != "0" {
		t.Fatalf("response elapsedMs = %s (present %t), want integer zero", responseElapsed, present)
	}
	if detailElapsed, present := payload.Error.Details[0]["elapsedMs"]; present {
		t.Fatalf("unmeasured error detail elapsedMs = %s, want field omitted", detailElapsed)
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
