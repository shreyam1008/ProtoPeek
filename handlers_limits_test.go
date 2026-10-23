package grpcui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang/protobuf/jsonpb"
	oldproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/interop/grpc_testing"
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

type delayedDeadlineContext struct {
	context.Context
	deadline time.Time
}

func (ctx delayedDeadlineContext) Deadline() (time.Time, bool) { return ctx.deadline, true }

func TestRPCStreamFinalStatusUsesDeadlineBeforeContextTimerPublishes(t *testing.T) {
	t.Parallel()
	deadline := time.Now().Add(time.Minute)
	for _, test := range []struct {
		name    string
		at      time.Time
		code    codes.Code
		observe bool
	}{
		{name: "expired synthetic status", at: deadline, code: codes.DeadlineExceeded},
		{name: "early server deadline", at: deadline.Add(-time.Second), code: codes.DeadlineExceeded, observe: true},
		{name: "early server permission denial", at: deadline.Add(-time.Second), code: codes.PermissionDenied, observe: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := delayedDeadlineContext{Context: context.Background(), deadline: deadline}
			now := test.at
			result := newRPCResultWithClock(nil, false, nil, func() time.Time { return now })
			result.onEvent = func(rpcStreamEvent) error { return nil }
			result.contextError = func() error { return invokeContextError(ctx, result.now()) }
			if ctx.Err() != nil {
				t.Fatal("fixture must leave the deadline timer unpublished")
			}
			result.OnReceiveTrailers(status.New(test.code, "fixture final status"), metadata.Pairs("final", "observed"))
			now = deadline.Add(time.Second)
			result.finish()
			if test.observe {
				if !result.finalStatusSeen || result.contextErr != nil || result.Error == nil || result.Error.Code != uint32(test.code) || len(result.Trailers) != 1 || result.Timings.TrailersMs == nil {
					t.Fatalf("lost status observed before the local deadline: %+v", result)
				}
			} else if result.finalStatusSeen || !errors.Is(result.contextErr, context.DeadlineExceeded) || result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
				t.Fatalf("expired deadline invented final server evidence: %+v", result)
			}
		})
	}
}

type terminalRaceClientConn struct {
	grpc.ClientConnInterface
	code       codes.Code
	onTrailers func()
}

func (conn terminalRaceClientConn) NewStream(ctx context.Context, description *grpc.StreamDesc, method string, options ...grpc.CallOption) (grpc.ClientStream, error) {
	stream, err := conn.ClientConnInterface.NewStream(ctx, description, method, options...)
	return terminalRaceClientStream{ClientStream: stream, code: conn.code, onTrailers: conn.onTrailers}, err
}

type terminalRaceClientStream struct {
	grpc.ClientStream
	code       codes.Code
	onTrailers func()
}

func (stream terminalRaceClientStream) RecvMsg(any) error {
	return status.Error(stream.code, "fixture terminal status")
}

func (stream terminalRaceClientStream) Trailer() metadata.MD {
	stream.onTrailers()
	return stream.ClientStream.Trailer()
}

type terminalRaceWriter struct{ *httptest.ResponseRecorder }

func (*terminalRaceWriter) SetWriteDeadline(time.Time) error { return nil }

func TestRPCStreamTerminalPreservesCallbackDecisionAfterParentCancellation(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name     string
		code     codes.Code
		observed bool
	}{
		{name: "early server permission denial", code: codes.PermissionDenied, observed: true},
		{name: "early server deadline", code: codes.DeadlineExceeded, observed: true},
		{name: "expired deadline keeps first cause", code: codes.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			deadline := time.Now().Add(time.Hour)
			ctx, cancel := context.WithDeadline(context.Background(), deadline)
			defer cancel()
			trailerRead, callbackSamples := false, 0
			clock := func() time.Time {
				if !trailerRead {
					return deadline.Add(-time.Second)
				}
				callbackSamples++
				if callbackSamples == 1 {
					if test.observed {
						return deadline.Add(-time.Second)
					}
					return deadline // Timer still unpublished at the decisive sample.
				}
				// Cancellation/deadline crossing happens after classification,
				// before invoke returns and the handler emits its terminal event.
				cancel()
				return deadline.Add(time.Second)
			}
			method := invokeRetentionMethod(t)
			connection := terminalRaceClientConn{ClientConnInterface: &invokeRetentionClientConn{}, code: test.code, onTrailers: func() { trailerRead = true }}
			handler := rpcInvokeHandlerWithLimits(connection, []*desc.MethodDescriptor{method}, InvokeOptions{}, invokeSafetyLimits{now: clock})
			request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`)).WithContext(ctx)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Accept", "application/x-ndjson")
			writer := &terminalRaceWriter{httptest.NewRecorder()}
			handler.ServeHTTP(writer, request)
			if !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatal("fixture did not cancel the HTTP parent after classification")
			}
			decoder := json.NewDecoder(writer.Body)
			for {
				var event rpcStreamEvent
				if err := decoder.Decode(&event); err != nil {
					t.Fatalf("missing terminal event: %v; body %s", err, writer.Body)
				}
				if event.Type != "complete" {
					continue
				}
				encoded, _ := json.Marshal(event)
				if event.Result == nil || event.Result.FinalStatusObserved == nil || *event.Result.FinalStatusObserved != test.observed {
					t.Fatalf("callback decision was relabeled: %s", encoded)
				}
				if test.observed {
					if event.Result.Error == nil || event.Result.Error.Code != uint32(test.code) || len(event.Result.Trailers) != 1 || event.RelayError != "" {
						t.Fatalf("early status was lost after parent cancellation: %s", encoded)
					}
				} else if event.Result.Error != nil || len(event.Result.Trailers) != 0 || !strings.Contains(event.RelayError, "deadline expired") {
					t.Fatalf("first deadline cause was overwritten by later cancellation: %s", encoded)
				}
				break
			}
		})
	}
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

// This is a real loopback gRPC peer. The client wrapper waits for server receipt
// before returning SendMsg, so a later local parse failure cannot race away the
// evidence that the earlier request actually crossed the transport.
type requestConversionPeer struct {
	grpc_testing.UnimplementedTestServiceServer
	received chan struct{}
	count    atomic.Int32
}

func (peer *requestConversionPeer) StreamingInputCall(stream grpc_testing.TestService_StreamingInputCallServer) error {
	for {
		if _, err := stream.Recv(); err != nil {
			return err
		}
		peer.count.Add(1)
		peer.received <- struct{}{}
	}
}

func (peer *requestConversionPeer) FullDuplexCall(stream grpc_testing.TestService_FullDuplexCallServer) error {
	for {
		if _, err := stream.Recv(); err != nil {
			return err
		}
		peer.count.Add(1)
		peer.received <- struct{}{}
	}
}

type acknowledgedRequestConn struct {
	grpc.ClientConnInterface
	received <-chan struct{}
}

func (conn acknowledgedRequestConn) NewStream(ctx context.Context, description *grpc.StreamDesc, method string, options ...grpc.CallOption) (grpc.ClientStream, error) {
	stream, err := conn.ClientConnInterface.NewStream(ctx, description, method, options...)
	if err != nil {
		return nil, err
	}
	return acknowledgedRequestStream{ClientStream: stream, received: conn.received}, nil
}

type acknowledgedRequestStream struct {
	grpc.ClientStream
	received <-chan struct{}
}

func (stream acknowledgedRequestStream) SendMsg(message any) error {
	if err := stream.ClientStream.SendMsg(message); err != nil {
		return err
	}
	select {
	case <-stream.received:
		return nil
	case <-stream.Context().Done():
		return stream.Context().Err()
	}
}

func TestRPCRequestConversionFailureWarnsAboutEarlierStreamingMessages(t *testing.T) {
	for _, methodName := range []string{"StreamingInputCall", "FullDuplexCall"} {
		for _, streaming := range []bool{false, true} {
			t.Run(methodName+"/ndjson="+strconv.FormatBool(streaming), func(t *testing.T) {
				peer := &requestConversionPeer{received: make(chan struct{}, 2)}
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				server := grpc.NewServer()
				grpc_testing.RegisterTestServiceServer(server, peer)
				go func() { _ = server.Serve(listener) }()
				t.Cleanup(server.Stop)
				connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = connection.Close() })
				file, err := desc.LoadFileDescriptor("grpc/testing/test.proto")
				if err != nil {
					t.Fatal(err)
				}
				method := file.FindService("grpc.testing.TestService").FindMethodByName(methodName)
				handler := RPCInvokeHandlerWithOptions(acknowledgedRequestConn{ClientConnInterface: connection, received: peer.received}, []*desc.MethodDescriptor{method}, InvokeOptions{MaxDuration: 2 * time.Second})
				relay := httptest.NewServer(handler)
				defer relay.Close()
				// A long unknown-field error also proves the processing warning survives
				// the bounded protobuf conversion detail, rather than being truncated away.
				body := `{"data":[{},{"` + strings.Repeat("unknown_field_", 160) + `":true}]}`
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				request, err := http.NewRequestWithContext(ctx, http.MethodPost, relay.URL+"/"+method.GetFullyQualifiedName(), strings.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				request.Header.Set("Content-Type", "application/json")
				if streaming {
					request.Header.Set("Accept", "application/x-ndjson")
				}
				response, err := http.DefaultClient.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				const warning = "1 earlier message may already have been processed"
				if !streaming {
					text, err := io.ReadAll(io.LimitReader(response.Body, 2048))
					if err != nil || response.StatusCode != http.StatusBadRequest || len(text) > 1024 || !strings.Contains(string(text), "Request message 2 could not be converted to protobuf") || !strings.Contains(string(text), warning) {
						t.Fatalf("legacy failure hid prior transport effects: status=%d body=%s err=%v", response.StatusCode, text, err)
					}
				} else {
					if response.StatusCode != http.StatusOK {
						t.Fatalf("NDJSON status %d", response.StatusCode)
					}
					decoder := json.NewDecoder(response.Body)
					for {
						var event rpcStreamEvent
						if err := decoder.Decode(&event); err != nil {
							t.Fatal(err)
						}
						if event.Type != "complete" {
							continue
						}
						if event.Result == nil || event.Result.Requests == nil || event.Result.Requests.Total != 2 || event.Result.Requests.Sent != 1 || event.Result.FinalStatusObserved == nil || *event.Result.FinalStatusObserved || event.Result.Error != nil || len(event.Result.Trailers) != 0 || event.Result.Timings.TrailersMs != nil || len(event.RelayError) > 1024 || !strings.Contains(event.RelayError, "Request message 2 could not be converted to protobuf") || !strings.Contains(event.RelayError, warning) {
							t.Fatalf("stream conversion fabricated completion or hid earlier send: %+v", event)
						}
						break
					}
				}
				if peer.count.Load() != 1 {
					t.Fatalf("real server received %d requests, want 1 before local conversion failure", peer.count.Load())
				}
			})
		}
	}
}
