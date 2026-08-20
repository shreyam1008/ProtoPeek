package grpcui

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/fullstorydev/grpcurl"
	"github.com/golang/protobuf/jsonpb"
	oldproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestRPCResultRecordsCallbackEntryTimings(t *testing.T) {
	t.Parallel()

	clock := &rpcTestClock{current: time.Unix(1_700_000_000, 0)}
	stats := rpcRequestStats{Total: 1}
	result := newRPCResultWithClock(nil, false, &stats, clock.Now)

	clock.Advance(1250 * time.Microsecond)
	result.OnReceiveHeaders(metadata.Pairs("x-test-header", "first"))
	clock.Advance(2 * time.Millisecond)
	result.OnReceiveHeaders(metadata.Pairs("x-test-header", "latest"))

	clock.Advance(500 * time.Microsecond)
	result.OnReceiveResponse(&timingProtoMessage{
		onMarshal: func() { clock.Advance(10 * time.Millisecond) },
	})
	clock.Advance(2250 * time.Microsecond)
	result.OnReceiveResponse(&timingProtoMessage{})

	clock.Advance(1750 * time.Microsecond)
	result.OnReceiveTrailers(status.New(codes.OK, ""), metadata.Pairs("x-test-trailer", "done"))
	clock.Advance(750 * time.Microsecond)
	result.finish()

	assertTimingValue(t, "headers", result.Timings.HeadersMs, 1.25)
	assertTimingValue(t, "first message", result.Timings.FirstMessageMs, 3.75)
	assertTimingValue(t, "trailers", result.Timings.TrailersMs, 17.75)
	if result.Timings.TotalMs != 18.5 {
		t.Fatalf("total timing = %v ms, want 18.5 ms", result.Timings.TotalMs)
	}
	if len(result.Responses) != 2 {
		t.Fatalf("response count = %d, want 2", len(result.Responses))
	}
	assertElapsedValue(t, "first response", result.Responses[0].ElapsedMs, 3)
	assertElapsedValue(t, "second response", result.Responses[1].ElapsedMs, 16)
	if got := result.Headers; len(got) != 1 || got[0].Value != "latest" {
		t.Fatalf("headers = %#v, want latest metadata with first observation time", got)
	}
}

func TestRPCResultKeepsMissingFirstMessageTimingNull(t *testing.T) {
	t.Parallel()

	clock := &rpcTestClock{current: time.Unix(1_700_000_000, 0)}
	result := newRPCResultWithClock(nil, false, nil, clock.Now)
	clock.Advance(2 * time.Millisecond)
	result.OnReceiveHeaders(nil)
	clock.Advance(3 * time.Millisecond)
	result.OnReceiveTrailers(status.New(codes.Unavailable, "not ready"), nil)
	clock.Advance(time.Millisecond)
	result.finish()

	assertTimingValue(t, "headers", result.Timings.HeadersMs, 2)
	if result.Timings.FirstMessageMs != nil {
		t.Fatalf("first-message timing = %v, want nil without a response message", *result.Timings.FirstMessageMs)
	}
	assertTimingValue(t, "trailers", result.Timings.TrailersMs, 5)
	if result.Timings.TotalMs != 6 {
		t.Fatalf("total timing = %v ms, want 6 ms", result.Timings.TotalMs)
	}
	if result.Error == nil || result.Error.Code != uint32(codes.Unavailable) {
		t.Fatalf("RPC error = %#v, want Unavailable", result.Error)
	}
}

func TestInvokeRPCFinalizesTimingEvidenceAndPreservesErrors(t *testing.T) {
	t.Parallel()

	method, source := timingUnaryMethod(t)
	result, err := invokeRPC(
		context.Background(),
		method.GetFullyQualifiedName(),
		timingUnaryClientConn{},
		source,
		http.Header{},
		strings.NewReader(`{"data":[{}]}`),
		&InvokeOptions{},
	)
	if err != nil {
		t.Fatalf("invoke RPC: %v", err)
	}
	if result.Timings.HeadersMs == nil || result.Timings.FirstMessageMs == nil || result.Timings.TrailersMs == nil {
		t.Fatalf("missing timing boundary: %#v", result.Timings)
	}
	if *result.Timings.HeadersMs > *result.Timings.FirstMessageMs ||
		*result.Timings.FirstMessageMs > *result.Timings.TrailersMs ||
		*result.Timings.TrailersMs > result.Timings.TotalMs {
		t.Fatalf("timing boundaries are not ordered: %#v", result.Timings)
	}
	if result.Error != nil {
		t.Fatalf("RPC error = %#v, want nil", result.Error)
	}
	if len(result.Responses) != 1 || result.Requests == nil || result.Requests.Sent != 1 {
		t.Fatalf("unexpected RPC result: %#v", result)
	}

	transportErr := errors.New("transport broke")
	failed, err := invokeRPC(
		context.Background(),
		method.GetFullyQualifiedName(),
		timingUnaryClientConn{err: transportErr},
		source,
		http.Header{},
		strings.NewReader(`{"data":[{}]}`),
		&InvokeOptions{},
	)
	if failed != nil {
		t.Fatalf("failed invocation result = %#v, want nil", failed)
	}
	if err == nil || !strings.Contains(err.Error(), transportErr.Error()) {
		t.Fatalf("failed invocation error = %v, want wrapped transport error", err)
	}
}

type rpcTestClock struct {
	current time.Time
}

func (c *rpcTestClock) Now() time.Time {
	return c.current
}

func (c *rpcTestClock) Advance(duration time.Duration) {
	c.current = c.current.Add(duration)
}

type timingProtoMessage struct {
	onMarshal func()
}

func (m *timingProtoMessage) Reset() {}

func (m *timingProtoMessage) String() string { return "timing message" }

func (m *timingProtoMessage) ProtoMessage() {}

func (m *timingProtoMessage) MarshalJSONPB(*jsonpb.Marshaler) ([]byte, error) {
	if m.onMarshal != nil {
		m.onMarshal()
	}
	return []byte(`{}`), nil
}

func assertTimingValue(t *testing.T, name string, actual *float64, expected float64) {
	t.Helper()
	if actual == nil {
		t.Fatalf("%s timing = nil, want %v ms", name, expected)
	}
	if *actual != expected {
		t.Fatalf("%s timing = %v ms, want %v ms", name, *actual, expected)
	}
}

func assertElapsedValue(t *testing.T, name string, actual *int64, expected int64) {
	t.Helper()
	if actual == nil {
		t.Fatalf("%s elapsed = nil, want %d ms", name, expected)
	}
	if *actual != expected {
		t.Fatalf("%s elapsed = %d ms, want %d ms", name, *actual, expected)
	}
}

type timingUnaryClientConn struct {
	err error
}

func (c timingUnaryClientConn) Invoke(_ context.Context, _ string, _ any, _ any, opts ...grpc.CallOption) error {
	if c.err != nil {
		return c.err
	}
	for _, option := range opts {
		switch option := option.(type) {
		case grpc.HeaderCallOption:
			*option.HeaderAddr = metadata.Pairs("x-test-header", "ready")
		case grpc.TrailerCallOption:
			*option.TrailerAddr = metadata.Pairs("x-test-trailer", "done")
		}
	}
	return nil
}

func (timingUnaryClientConn) NewStream(context.Context, *grpc.StreamDesc, string, ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, errors.New("unexpected streaming RPC")
}

func timingUnaryMethod(t *testing.T) (*desc.MethodDescriptor, grpcurl.DescriptorSource) {
	t.Helper()
	file, err := desc.CreateFileDescriptor(&descriptor.FileDescriptorProto{
		Name:    oldproto.String("timing.proto"),
		Package: oldproto.String("test"),
		MessageType: []*descriptor.DescriptorProto{{
			Name: oldproto.String("Empty"),
		}},
		Service: []*descriptor.ServiceDescriptorProto{{
			Name: oldproto.String("TimingService"),
			Method: []*descriptor.MethodDescriptorProto{{
				Name:       oldproto.String("Call"),
				InputType:  oldproto.String(".test.Empty"),
				OutputType: oldproto.String(".test.Empty"),
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create timing descriptor: %v", err)
	}
	source, err := grpcurl.DescriptorSourceFromFileDescriptors(file)
	if err != nil {
		t.Fatalf("create timing descriptor source: %v", err)
	}
	return file.FindService("test.TimingService").FindMethodByName("Call"), source
}
