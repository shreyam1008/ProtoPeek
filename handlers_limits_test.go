package grpcui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang/protobuf/jsonpb"
	oldproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestRPCInvokeHandlerStopsAtRetainedResponseCountLimit(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{
		responseCount: maxInvokeRetainedResponses + 1,
		payload:       "bounded",
	}
	response := performInvokeRetentionRequest(t, method, connection, 0)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Responses) != maxInvokeRetainedResponses {
		t.Fatalf("retained responses = %d, want %d", len(result.Responses), maxInvokeRetainedResponses)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitResponseCount {
		t.Fatalf("local limit = %#v, want response-count evidence", result.LocalLimit)
	}
	if result.LocalLimit.RetainedResponses != maxInvokeRetainedResponses {
		t.Fatalf("reported retained responses = %d, want %d", result.LocalLimit.RetainedResponses, maxInvokeRetainedResponses)
	}
	if result.Error != nil {
		t.Fatalf("gRPC status = %#v, want unobserved after local cancellation", result.Error)
	}
	if len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
		t.Fatalf("trailers/status timing = %#v/%v, want unobserved", result.Trailers, result.Timings.TrailersMs)
	}
	if len(result.Headers) != 1 || result.Timings.HeadersMs == nil || result.Timings.FirstMessageMs == nil {
		t.Fatalf("preserved response evidence = headers %#v, timings %#v", result.Headers, result.Timings)
	}
	select {
	case <-connection.canceled:
	default:
		t.Fatal("underlying RPC context was not canceled at the retained response limit")
	}
}

func TestRPCInvokeHandlerStopsBeforeRetainedResponseBytesExceedLimit(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{
		responseCount: 4,
		payload:       strings.Repeat("x", maxInvokeRetainedResponseBytes/3),
	}
	response := performInvokeRetentionRequest(t, method, connection, 0)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Responses) != 2 {
		t.Fatalf("retained responses = %d, want 2 before the third crosses the byte limit", len(result.Responses))
	}
	retainedBytes := 0
	for _, response := range result.Responses {
		retainedBytes += len(response.Data)
	}
	if retainedBytes > maxInvokeRetainedResponseBytes {
		t.Fatalf("retained response bytes = %d, limit %d", retainedBytes, maxInvokeRetainedResponseBytes)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitResponseBytes {
		t.Fatalf("local limit = %#v, want response-bytes evidence", result.LocalLimit)
	}
	if result.LocalLimit.RetainedResponseBytes <= 2*len(connection.payload) || result.LocalLimit.RetainedResponseBytes > maxInvokeRetainedResponseBytes || result.LocalLimit.MaxResponseBytes != maxInvokeRetainedResponseBytes {
		t.Fatalf("reported byte evidence = %#v, decoded envelope bytes %d", result.LocalLimit, retainedBytes)
	}
	if result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
		t.Fatalf("fabricated final status evidence = error %#v, trailers %#v, timing %v", result.Error, result.Trailers, result.Timings.TrailersMs)
	}
	select {
	case <-connection.canceled:
	default:
		t.Fatal("underlying RPC context was not canceled at the retained byte limit")
	}
}

func TestRPCInvokeHandlerAppliesConfiguredWallWhenDeadlineIsAbsentOrExcessive(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	for _, timeoutSeconds := range []float64{0, 120} {
		timeoutSeconds := timeoutSeconds
		t.Run(strconv.FormatFloat(timeoutSeconds, 'f', -1, 64), func(t *testing.T) {
			t.Parallel()
			connection := &invokeRetentionClientConn{blockUntilCanceled: true}
			response := performInvokeRetentionRequestWithOptions(
				t,
				method,
				connection,
				timeoutSeconds,
				InvokeOptions{MaxDuration: 20 * time.Millisecond},
			)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
			}
			var result rpcResult
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitDuration || result.LocalLimit.MaxDurationSeconds != 0.02 {
				t.Fatalf("configured wall evidence = limit %#v, error %#v", result.LocalLimit, result.Error)
			}
		})
	}
}

func TestRPCInvokeHandlerReportsLocalWallWithoutFabricatingGRPCStatus(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{blockUntilCanceled: true}
	handler := rpcInvokeHandlerWithLimits(
		connection,
		[]*desc.MethodDescriptor{method},
		InvokeOptions{},
		invokeSafetyLimits{maxDuration: 20 * time.Millisecond},
	)
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitDuration {
		t.Fatalf("local limit = %#v, want duration evidence", result.LocalLimit)
	}
	if result.LocalLimit.MaxDurationSeconds != 0.02 {
		t.Fatalf("reported wall = %v seconds, want 0.02", result.LocalLimit.MaxDurationSeconds)
	}
	if result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
		t.Fatalf("fabricated final status evidence = error %#v, trailers %#v, timing %v", result.Error, result.Trailers, result.Timings.TrailersMs)
	}
	if len(result.Headers) != 1 || result.Timings.HeadersMs == nil || result.Timings.TotalMs < 15 {
		t.Fatalf("preserved partial evidence = headers %#v, timings %#v", result.Headers, result.Timings)
	}
	select {
	case <-connection.canceled:
	default:
		t.Fatal("wall timer did not cancel the underlying RPC")
	}
}

func TestRPCInvokeHandlerWithOptionsReportsConfiguredLocalWall(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{blockUntilCanceled: true}
	handler := RPCInvokeHandlerWithOptions(
		connection,
		[]*desc.MethodDescriptor{method},
		InvokeOptions{MaxDuration: 20 * time.Millisecond},
	)
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitDuration || result.LocalLimit.MaxDurationSeconds != 0.02 {
		t.Fatalf("configured local wall evidence = %#v", result.LocalLimit)
	}
	if result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
		t.Fatalf("configured local wall fabricated status = error %#v, trailers %#v, timing %v", result.Error, result.Trailers, result.Timings.TrailersMs)
	}
}

func TestRPCInvokeHandlerOwnedWallSetsCauseBeforeTransportCancellation(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{
		blockUntilCanceled:     true,
		preemptExposedDeadline: true,
	}
	handler := RPCInvokeHandlerWithOptions(
		connection,
		[]*desc.MethodDescriptor{method},
		InvokeOptions{MaxDuration: 20 * time.Millisecond},
	)
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitDuration {
		t.Fatalf("owned-wall evidence = limit %#v, error %#v", result.LocalLimit, result.Error)
	}
	if result.Error != nil || len(result.Trailers) != 0 {
		t.Fatalf("owned wall fabricated final status = error %#v, trailers %#v", result.Error, result.Trailers)
	}
}

func TestRPCInvokeHandlerPreservesTransportErrorReturnedBeforeOwnedWall(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{
		newStreamError: errors.New("transport failed before local wall"),
	}
	handler := RPCInvokeHandlerWithOptions(
		connection,
		[]*desc.MethodDescriptor{method},
		InvokeOptions{MaxDuration: 20 * time.Millisecond},
	)
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !strings.Contains(body, "transport failed before local wall") || strings.Contains(body, "localLimit") {
		t.Fatalf("transport error response = %q", body)
	}
}

func TestRPCInvokeHandlerReportsItsActualInjectedWallForResponseLimits(t *testing.T) {
	t.Parallel()

	method := invokeRetentionMethod(t)
	connection := &invokeRetentionClientConn{
		responseCount: maxInvokeRetainedResponses + 1,
		payload:       "bounded",
	}
	handler := rpcInvokeHandlerWithLimits(
		connection,
		[]*desc.MethodDescriptor{method},
		InvokeOptions{},
		invokeSafetyLimits{maxDuration: 500 * time.Millisecond},
	)
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	var result rpcResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.MaxDurationSeconds != 0.5 {
		t.Fatalf("reported safety policy = %#v, want 0.5-second wall", result.LocalLimit)
	}
}

func TestRPCResultPreservesNaturalCompletionAtExactRetentionBoundaries(t *testing.T) {
	t.Parallel()

	t.Run("response count", func(t *testing.T) {
		result := newRPCResult(nil, false, nil)
		for range maxInvokeRetainedResponses {
			result.OnReceiveResponse(&invokeSizedJSONMessage{size: 2})
		}
		result.OnReceiveTrailers(status.New(codes.OK, ""), metadata.Pairs("x-final", "observed"))

		if result.LocalLimit != nil || result.Error != nil || len(result.Responses) != maxInvokeRetainedResponses {
			t.Fatalf("exact count result = limit %#v, error %#v, responses %d", result.LocalLimit, result.Error, len(result.Responses))
		}
		if len(result.Trailers) != 1 || result.Timings.TrailersMs == nil {
			t.Fatalf("natural final evidence = trailers %#v, timing %v", result.Trailers, result.Timings.TrailersMs)
		}

		marshaled := 0
		result.OnReceiveResponse(&invokeSizedJSONMessage{size: 2, marshaled: &marshaled})
		if result.LocalLimit == nil || result.LocalLimit.Reason != invokeLimitResponseCount || marshaled != 0 {
			t.Fatalf("response after exact count = limit %#v, marshal count %d", result.LocalLimit, marshaled)
		}
	})

	t.Run("serialized bytes", func(t *testing.T) {
		result := newRPCResult(nil, false, nil)
		result.OnReceiveResponse(&invokeSizedJSONMessage{size: maxInvokeRetainedResponseBytes / 2})
		result.OnReceiveResponse(&invokeSizedJSONMessage{size: maxInvokeRetainedResponseBytes / 2})
		result.OnReceiveTrailers(status.New(codes.OK, ""), metadata.Pairs("x-final", "observed"))

		if result.LocalLimit != nil || result.Error != nil || len(result.Responses) != 2 {
			t.Fatalf("exact byte result = limit %#v, error %#v, responses %d", result.LocalLimit, result.Error, len(result.Responses))
		}
		if len(result.Trailers) != 1 || result.Timings.TrailersMs == nil {
			t.Fatalf("natural final evidence = trailers %#v, timing %v", result.Trailers, result.Timings.TrailersMs)
		}
	})
}

func TestRPCResultDurationRacePreservesOnlyStatusObservedBeforeLocalWall(t *testing.T) {
	t.Parallel()

	t.Run("local wall wins", func(t *testing.T) {
		result := newRPCResult(nil, false, nil)
		result.contextCause = func() error { return errInvokeDurationLimit }
		result.OnReceiveHeaders(metadata.Pairs("x-header", "observed"))
		result.OnReceiveTrailers(
			status.New(codes.DeadlineExceeded, "client wall"),
			metadata.Pairs("x-trailer", "not-server-evidence"),
		)
		result.applyDurationLimit(20 * time.Millisecond)

		if result.LocalLimit == nil || result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
			t.Fatalf("local-wall result = limit %#v, error %#v, trailers %#v, timing %v", result.LocalLimit, result.Error, result.Trailers, result.Timings.TrailersMs)
		}
	})

	t.Run("server status wins", func(t *testing.T) {
		cause := error(nil)
		result := newRPCResult(nil, false, nil)
		result.contextCause = func() error { return cause }
		result.OnReceiveTrailers(
			status.New(codes.Unavailable, "server unavailable"),
			metadata.Pairs("x-trailer", "server-evidence"),
		)
		cause = errInvokeDurationLimit
		result.applyDurationLimit(20 * time.Millisecond)

		if result.LocalLimit != nil || result.Error == nil || result.Error.Code != uint32(codes.Unavailable) || len(result.Trailers) != 1 || result.Timings.TrailersMs == nil {
			t.Fatalf("server-first result = limit %#v, error %#v, trailers %#v, timing %v", result.LocalLimit, result.Error, result.Trailers, result.Timings.TrailersMs)
		}
	})
}

func performInvokeRetentionRequest(t *testing.T, method *desc.MethodDescriptor, connection grpc.ClientConnInterface, timeoutSeconds float64) *httptest.ResponseRecorder {
	return performInvokeRetentionRequestWithOptions(t, method, connection, timeoutSeconds, InvokeOptions{})
}

func performInvokeRetentionRequestWithOptions(t *testing.T, method *desc.MethodDescriptor, connection grpc.ClientConnInterface, timeoutSeconds float64, options InvokeOptions) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"data":[{}]}`
	if timeoutSeconds != 0 {
		body = `{"timeout_seconds":` + strconv.FormatFloat(timeoutSeconds, 'f', -1, 64) + `,"data":[{}]}`
	}
	request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	RPCInvokeHandlerWithOptions(connection, []*desc.MethodDescriptor{method}, options).ServeHTTP(response, request)
	return response
}

func invokeRetentionMethod(t *testing.T) *desc.MethodDescriptor {
	t.Helper()
	file, err := desc.CreateFileDescriptor(&descriptor.FileDescriptorProto{
		Name:    oldproto.String("invoke_retention.proto"),
		Package: oldproto.String("test"),
		MessageType: []*descriptor.DescriptorProto{
			{Name: oldproto.String("Empty")},
			{
				Name: oldproto.String("Payload"),
				Field: []*descriptor.FieldDescriptorProto{{
					Name:   oldproto.String("payload"),
					Number: oldproto.Int32(1),
					Label:  descriptor.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
					Type:   descriptor.FieldDescriptorProto_TYPE_STRING.Enum(),
				}},
			},
		},
		Service: []*descriptor.ServiceDescriptorProto{{
			Name: oldproto.String("RetentionService"),
			Method: []*descriptor.MethodDescriptorProto{{
				Name:            oldproto.String("Watch"),
				InputType:       oldproto.String(".test.Empty"),
				OutputType:      oldproto.String(".test.Payload"),
				ServerStreaming: oldproto.Bool(true),
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create retention descriptor: %v", err)
	}
	return file.FindService("test.RetentionService").FindMethodByName("Watch")
}

type invokeRetentionClientConn struct {
	responseCount          int
	payload                string
	blockUntilCanceled     bool
	preemptExposedDeadline bool
	newStreamError         error
	canceled               chan struct{}
}

func (*invokeRetentionClientConn) Invoke(context.Context, string, any, any, ...grpc.CallOption) error {
	return errors.New("unexpected unary invocation")
}

func (c *invokeRetentionClientConn) NewStream(ctx context.Context, _ *grpc.StreamDesc, _ string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if c.newStreamError != nil {
		return nil, c.newStreamError
	}
	c.canceled = make(chan struct{})
	return &invokeRetentionClientStream{
		ctx:                    ctx,
		responseCount:          c.responseCount,
		payload:                c.payload,
		blockUntilCanceled:     c.blockUntilCanceled,
		preemptExposedDeadline: c.preemptExposedDeadline,
		canceled:               c.canceled,
	}, nil
}

type invokeRetentionClientStream struct {
	ctx                    context.Context
	responseCount          int
	payload                string
	blockUntilCanceled     bool
	preemptExposedDeadline bool
	next                   int
	canceled               chan struct{}
	cancelOnce             sync.Once
}

func (s *invokeRetentionClientStream) Header() (metadata.MD, error) {
	return metadata.Pairs("x-retention-header", "observed"), nil
}

func (*invokeRetentionClientStream) Trailer() metadata.MD {
	return metadata.Pairs("x-retention-trailer", "not-observed")
}

func (*invokeRetentionClientStream) CloseSend() error { return nil }

func (s *invokeRetentionClientStream) Context() context.Context { return s.ctx }

func (*invokeRetentionClientStream) SendMsg(any) error { return nil }

func (s *invokeRetentionClientStream) RecvMsg(message any) error {
	if s.preemptExposedDeadline {
		if _, ok := s.ctx.Deadline(); ok {
			return status.Error(codes.DeadlineExceeded, "transport observed the local wall before its cause")
		}
	}
	if s.blockUntilCanceled {
		<-s.ctx.Done()
		s.cancelOnce.Do(func() { close(s.canceled) })
		return status.Error(codes.DeadlineExceeded, "local wall")
	}
	select {
	case <-s.ctx.Done():
		s.cancelOnce.Do(func() { close(s.canceled) })
		return status.Error(codes.Canceled, "local cancellation")
	default:
	}
	if s.next >= s.responseCount {
		return io.EOF
	}
	dynamicMessage, ok := message.(*dynamic.Message)
	if !ok {
		return errors.New("unexpected response message type")
	}
	if err := dynamicMessage.TrySetFieldByName("payload", s.payload); err != nil {
		return err
	}
	s.next++
	return nil
}

type invokeSizedJSONMessage struct {
	size      int
	marshaled *int
}

func (*invokeSizedJSONMessage) Reset() {}

func (*invokeSizedJSONMessage) String() string { return "sized invoke response" }

func (*invokeSizedJSONMessage) ProtoMessage() {}

func (m *invokeSizedJSONMessage) MarshalJSONPB(*jsonpb.Marshaler) ([]byte, error) {
	if m.marshaled != nil {
		(*m.marshaled)++
	}
	payload := bytes.Repeat([]byte{' '}, m.size)
	payload[0] = '{'
	payload[len(payload)-1] = '}'
	return payload, nil
}
