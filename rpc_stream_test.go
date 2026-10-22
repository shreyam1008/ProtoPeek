package grpcui

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type delayedRPCHealth struct {
	healthpb.UnimplementedHealthServer
	finish   chan struct{}
	canceled chan struct{}
	failure  error
}

func (service *delayedRPCHealth) Watch(_ *healthpb.HealthCheckRequest, stream healthpb.Health_WatchServer) error {
	defer close(service.canceled)
	if err := stream.SendHeader(metadata.Pairs("first-header", "observed")); err != nil {
		return err
	}
	if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
		return err
	}
	select {
	case <-service.finish:
		stream.SetTrailer(metadata.Pairs("last-trailer", "observed"))
		return service.failure
	case <-stream.Context().Done():
		return stream.Context().Err()
	}
}

func TestRPCStreamDistinguishesObservedFailureFromLocalDeadline(t *testing.T) {
	t.Parallel()
	for _, local := range []bool{false, true} {
		t.Run(map[bool]string{false: "server-status", true: "local-deadline"}[local], func(t *testing.T) {
			service, handler := delayedRPCFixture(t, invokeSafetyLimits{})
			if !local {
				service.failure = status.Error(codes.PermissionDenied, "denied by fixture")
				close(service.finish)
			}
			server := httptest.NewServer(handler)
			defer server.Close()
			body := `{"data":[{}]}`
			if local {
				body = `{"timeout_seconds":0.03,"data":[{}]}`
			}
			request, _ := http.NewRequest(http.MethodPost, server.URL+"/grpc.health.v1.Health.Watch", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Accept", "application/x-ndjson")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			decoder := json.NewDecoder(response.Body)
			for {
				var event rpcStreamEvent
				if err := decoder.Decode(&event); err != nil {
					t.Fatal(err)
				}
				if event.Type != "complete" {
					continue
				}
				if event.Result == nil || event.Result.FinalStatusObserved == nil {
					t.Fatal("missing explicit final status evidence")
				}
				if local {
					if *event.Result.FinalStatusObserved || event.Result.Error != nil || len(event.Result.Trailers) != 0 || !strings.Contains(event.RelayError, "deadline expired") {
						t.Fatalf("local deadline invented status: %+v", event)
					}
				} else {
					if !*event.Result.FinalStatusObserved || event.Result.Error == nil || event.Result.Error.Code != uint32(codes.PermissionDenied) {
						t.Fatalf("observed failure lost: %+v", event)
					}
				}
				break
			}
		})
	}
}

func delayedRPCFixture(t *testing.T, limits invokeSafetyLimits) (*delayedRPCHealth, http.Handler) {
	t.Helper()
	service := &delayedRPCHealth{finish: make(chan struct{}), canceled: make(chan struct{})}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	healthpb.RegisterHealthServer(server, service)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	file, err := desc.LoadFileDescriptor("grpc/health/v1/health.proto")
	if err != nil {
		t.Fatal(err)
	}
	method := file.FindService("grpc.health.v1.Health").FindMethodByName("Watch")
	return service, rpcInvokeHandlerWithLimits(connection, []*desc.MethodDescriptor{method}, InvokeOptions{}, limits)
}

func rpcStreamRequest(t *testing.T, ctx context.Context, address string) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address+"/grpc.health.v1.Health.Watch", strings.NewReader(`{"data":[{"service":""}]}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/x-ndjson")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d", response.StatusCode)
	}
	return response
}

func TestRPCStreamFlushesFirstMessageBeforeCompletionAndReportsFinalEvidence(t *testing.T) {
	t.Parallel()
	service, handler := delayedRPCFixture(t, invokeSafetyLimits{})
	server := httptest.NewServer(handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	response := rpcStreamRequest(t, ctx, server.URL)
	if got := response.Header.Get("Content-Type"); got != "application/x-ndjson" {
		t.Fatalf("content type %q", got)
	}
	decoder := json.NewDecoder(response.Body)
	for _, kind := range []string{"started", "headers", "message"} {
		var event rpcStreamEvent
		if err := decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type != kind {
			t.Fatalf("event %q, want %q", event.Type, kind)
		}
		if kind == "message" && (event.Response == nil || event.Response.Sequence != 1) {
			t.Fatalf("message %+v", event)
		}
	}
	select {
	case <-service.canceled:
		t.Fatal("RPC completed before test released it")
	default:
	}
	close(service.finish)
	var terminal rpcStreamEvent
	if err := decoder.Decode(&terminal); err != nil {
		t.Fatal(err)
	}
	if terminal.Type != "complete" || terminal.Result == nil || terminal.Result.FinalStatusObserved == nil || !*terminal.Result.FinalStatusObserved {
		t.Fatalf("terminal %+v", terminal)
	}
	if terminal.Result.Error != nil || len(terminal.Result.Headers) != 0 || len(terminal.Result.Responses) != 0 || len(terminal.Result.Trailers) != 1 {
		t.Fatalf("final evidence %+v", terminal.Result)
	}
	if err := decoder.Decode(&terminal); !errors.Is(err, io.EOF) {
		t.Fatalf("extra event: %v", err)
	}
}

func TestRPCStreamClientCancellationAbortsUpstream(t *testing.T) {
	t.Parallel()
	service, handler := delayedRPCFixture(t, invokeSafetyLimits{})
	server := httptest.NewServer(handler)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response := rpcStreamRequest(t, ctx, server.URL)
	decoder := json.NewDecoder(response.Body)
	for range 3 {
		var event rpcStreamEvent
		if err := decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
	}
	cancel()
	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("upstream did not observe cancellation")
	}
}

type blockedRPCWriter struct {
	*httptest.ResponseRecorder
	deadline time.Time
	writes   int
	mu       sync.Mutex
}

func (writer *blockedRPCWriter) SetWriteDeadline(deadline time.Time) error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.deadline = deadline
	return nil
}
func (writer *blockedRPCWriter) Write(value []byte) (int, error) {
	writer.writes++
	if writer.writes == 1 {
		return writer.ResponseRecorder.Write(value)
	}
	writer.mu.Lock()
	deadline := writer.deadline
	writer.mu.Unlock()
	if deadline.IsZero() {
		return 0, errors.New("write has no deadline")
	}
	<-time.After(time.Until(deadline))
	return 0, os.ErrDeadlineExceeded
}

func TestRPCStreamBlockedWriteDeadlineCancelsUpstream(t *testing.T) {
	t.Parallel()
	service, handler := delayedRPCFixture(t, invokeSafetyLimits{streamWriteTimeout: 20 * time.Millisecond})
	request := httptest.NewRequest(http.MethodPost, "/grpc.health.v1.Health.Watch", strings.NewReader(`{"data":[{}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/x-ndjson")
	writer := &blockedRPCWriter{ResponseRecorder: httptest.NewRecorder()}
	done := make(chan struct{})
	go func() { handler.ServeHTTP(writer, request); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("blocked writer did not stop at its deadline")
	}
	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("write failure did not cancel upstream")
	}
	if strings.Contains(writer.Body.String(), `"complete"`) {
		t.Fatal("failed writer emitted completion")
	}
}

func TestRPCStreamRetainsCountBytesAndWallLimits(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		count   int
		payload string
		wall    time.Duration
		reason  string
	}{
		{name: "count", count: 513, payload: "small", reason: invokeLimitResponseCount},
		{name: "bytes", count: 4, payload: strings.Repeat("x", maxInvokeRetainedResponseBytes/3), reason: invokeLimitResponseBytes},
		{name: "wall", count: 1, payload: "small", wall: 20 * time.Millisecond, reason: invokeLimitDuration},
	} {
		t.Run(test.name, func(t *testing.T) {
			method := invokeRetentionMethod(t)
			connection := &invokeRetentionClientConn{responseCount: test.count, payload: test.payload, blockUntilCanceled: test.wall > 0}
			server := httptest.NewServer(rpcInvokeHandlerWithLimits(connection, []*desc.MethodDescriptor{method}, InvokeOptions{}, invokeSafetyLimits{maxDuration: test.wall}))
			defer server.Close()
			request, _ := http.NewRequest(http.MethodPost, server.URL+"/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Accept", "application/x-ndjson")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			decoder := json.NewDecoder(response.Body)
			count := 0
			for {
				var event rpcStreamEvent
				if err := decoder.Decode(&event); err != nil {
					t.Fatal(err)
				}
				if event.Type == "message" {
					count++
				}
				if event.Type != "complete" {
					continue
				}
				if event.Result == nil || event.Result.LocalLimit == nil || event.Result.LocalLimit.Reason != test.reason || event.Result.FinalStatusObserved == nil || *event.Result.FinalStatusObserved {
					t.Fatalf("terminal %+v", event.Result)
				}
				if event.Result.LocalLimit.RetainedResponses != count || count > 512 || event.Result.LocalLimit.MaxResponseBytes != 8<<20 {
					t.Fatalf("limits %+v", event.Result.LocalLimit)
				}
				break
			}
		})
	}
}

func TestRPCStreamNegotiationPreservesLegacyJSON(t *testing.T) {
	t.Parallel()
	for _, accept := range []string{"", "*/*", "application/json", "application/x-ndjson;q=0"} {
		method := invokeRetentionMethod(t)
		connection := &invokeRetentionClientConn{responseCount: 1, payload: "legacy"}
		request := httptest.NewRequest(http.MethodPost, "/"+method.GetFullyQualifiedName(), strings.NewReader(`{"data":[{}]}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", accept)
		writer := httptest.NewRecorder()
		RPCInvokeHandler(connection, []*desc.MethodDescriptor{method}).ServeHTTP(writer, request)
		var result rpcResult
		if writer.Code != 200 || writer.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("legacy Accept %q: %d %s", accept, writer.Code, writer.Body.String())
		}
		if err := json.Unmarshal(writer.Body.Bytes(), &result); err != nil || len(result.Responses) != 1 || result.FinalStatusObserved != nil {
			t.Fatalf("legacy result: %+v %v", result, err)
		}
	}
}

func TestRPCStreamRequestConversionFailureIsExplicitLocalEvidence(t *testing.T) {
	for _, stream := range []bool{false, true} {
		service, handler := delayedRPCFixture(t, invokeSafetyLimits{})
		server := httptest.NewServer(handler)
		func() {
			defer server.Close()
			body := `{"data":[{"service":{"invalid":"value"}}]}`
			request, _ := http.NewRequest(http.MethodPost, server.URL+"/grpc.health.v1.Health.Watch", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			if stream {
				request.Header.Set("Accept", "application/x-ndjson")
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if !stream {
				text, _ := io.ReadAll(response.Body)
				if response.StatusCode != http.StatusBadRequest || !strings.Contains(string(text), "could not be converted to protobuf") {
					t.Fatalf("legacy request failure: %d %s", response.StatusCode, text)
				}
				return
			}
			decoder := json.NewDecoder(response.Body)
			var first, complete rpcStreamEvent
			if err := decoder.Decode(&first); err != nil {
				t.Fatal(err)
			}
			if err := decoder.Decode(&complete); err != nil {
				t.Fatal(err)
			}
			if first.Type != "started" || complete.Type != "complete" || complete.Result == nil || complete.Result.FinalStatusObserved == nil || *complete.Result.FinalStatusObserved || complete.Result.Error != nil || complete.Result.Requests.Sent != 0 || !strings.Contains(complete.RelayError, "could not be converted to protobuf") || len(complete.RelayError) > 1024 {
				t.Fatalf("request conversion fabricated server evidence: %+v", complete)
			}
			select {
			case <-service.canceled:
				t.Fatal("invalid request reached the RPC server")
			default:
			}
		}()
	}
}
