package standalone

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type testHealthService struct {
	healthpb.UnimplementedHealthServer
	requests chan *healthpb.HealthCheckRequest
	metadata chan metadata.MD
}

type sequenceHealthService struct {
	healthpb.UnimplementedHealthServer
}

type blockingHealthService struct {
	healthpb.UnimplementedHealthServer
	started chan string
}

type floodHealthService struct {
	healthpb.UnimplementedHealthServer
}

type unimplementedWatchHealthService struct {
	healthpb.UnimplementedHealthServer
	calls atomic.Int32
}

type largeHealthEvidenceService struct {
	healthpb.UnimplementedHealthServer
}

type canceledHealthService struct {
	healthpb.UnimplementedHealthServer
}

type deadlineCheckHealthService struct {
	healthpb.UnimplementedHealthServer
}

type healthFlushErrorWriter struct {
	*httptest.ResponseRecorder
	err        error
	flushCalls int
}

func (writer *healthFlushErrorWriter) Flush() {
	writer.ResponseRecorder.Flush()
}

func (writer *healthFlushErrorWriter) FlushError() error {
	writer.flushCalls++
	return writer.err
}

func (*floodHealthService) Watch(_ *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	for index := 0; index < maxHealthWatchObservations+1; index++ {
		if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
			return err
		}
	}
	return nil
}

func (service *unimplementedWatchHealthService) Watch(request *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	service.calls.Add(1)
	return service.UnimplementedHealthServer.Watch(request, stream)
}

func (*largeHealthEvidenceService) Check(ctx context.Context, _ *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	if err := grpc.SendHeader(ctx, largeHealthHeaders()); err != nil {
		return nil, err
	}
	grpc.SetTrailer(ctx, largeHealthTrailers())
	return nil, status.Error(codes.Internal, strings.Repeat("π", maxHealthStatusMessageBytes))
}

func (*largeHealthEvidenceService) Watch(_ *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	if err := stream.SendHeader(largeHealthHeaders()); err != nil {
		return err
	}
	if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
		return err
	}
	stream.SetTrailer(largeHealthTrailers())
	return status.Error(codes.Internal, strings.Repeat("π", maxHealthStatusMessageBytes))
}

func (*canceledHealthService) Watch(*healthpb.HealthCheckRequest, grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	return status.Error(codes.Canceled, "server canceled this watch")
}

func (*deadlineCheckHealthService) Check(ctx context.Context, _ *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	<-ctx.Done()
	return nil, status.FromContextError(ctx.Err()).Err()
}

func largeHealthHeaders() metadata.MD {
	return metadata.Pairs(
		"x-header-a", strings.Repeat("h", 20<<10),
		"x-header-b", strings.Repeat("h", 20<<10),
	)
}

func largeHealthTrailers() metadata.MD {
	return metadata.Pairs(
		"x-trailer-a", strings.Repeat("t", 20<<10),
		"x-trailer-b", strings.Repeat("t", 20<<10),
	)
}

type fakeHealthClient struct {
	check func(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (*healthpb.HealthCheckResponse, error)
	watch func(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[healthpb.HealthCheckResponse], error)
}

func (client *fakeHealthClient) Check(ctx context.Context, request *healthpb.HealthCheckRequest, options ...grpc.CallOption) (*healthpb.HealthCheckResponse, error) {
	return client.check(ctx, request, options...)
}

func (client *fakeHealthClient) Watch(ctx context.Context, request *healthpb.HealthCheckRequest, options ...grpc.CallOption) (grpc.ServerStreamingClient[healthpb.HealthCheckResponse], error) {
	return client.watch(ctx, request, options...)
}

func (s *blockingHealthService) Watch(request *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	if err := stream.SendHeader(metadata.Pairs("x-watch-header", "ready")); err != nil {
		return err
	}
	if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
		return err
	}
	select {
	case s.started <- request.GetService():
	case <-stream.Context().Done():
		return status.FromContextError(stream.Context().Err()).Err()
	}
	<-stream.Context().Done()
	return status.FromContextError(stream.Context().Err()).Err()
}

func (*sequenceHealthService) Watch(request *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	if err := stream.SendHeader(metadata.Pairs("x-watch-header", "ready")); err != nil {
		return err
	}
	if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVICE_UNKNOWN}); err != nil {
		return err
	}
	if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
		return err
	}
	stream.SetTrailer(metadata.Pairs("x-watch-trailer", request.GetService()))
	return nil
}

type testHealthMetadata struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func (s *testHealthService) Check(ctx context.Context, request *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	_ = grpc.SendHeader(ctx, metadata.Pairs("x-health-header", "ready"))
	grpc.SetTrailer(ctx, metadata.Pairs("x-health-trailer", "done"))
	select {
	case s.requests <- request:
	default:
	}
	if incoming, ok := metadata.FromIncomingContext(ctx); ok && s.metadata != nil {
		select {
		case s.metadata <- incoming.Copy():
		default:
		}
	}
	if request.GetService() == "missing.v1.Service" {
		return nil, status.Error(codes.NotFound, "unknown service")
	}
	return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}, nil
}

func TestHealthCheckReturnsCanonicalGRPCEvidence(t *testing.T) {
	t.Parallel()

	service := &testHealthService{requests: make(chan *healthpb.HealthCheckRequest, 1)}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/health/check", strings.NewReader(`{
  "service": "demo.v1.Greeter",
  "timeout_seconds": 2,
  "metadata": [{"name":"x-client","value":"test"}]
}`))
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", response.Header().Get("X-Content-Type-Options"))
	}

	var payload struct {
		Service         string  `json:"service"`
		StartedAt       string  `json:"startedAt"`
		HandlerInvokeMs float64 `json:"handlerInvokeMs"`
		ServingStatus   *struct {
			Code int32  `json:"code"`
			Name string `json:"name"`
		} `json:"servingStatus"`
		GRPCStatus struct {
			Code             int32  `json:"code"`
			Name             string `json:"name"`
			Message          string `json:"message"`
			MessageTruncated bool   `json:"messageTruncated"`
		} `json:"grpcStatus"`
		Headers           []testHealthMetadata `json:"headers"`
		Trailers          []testHealthMetadata `json:"trailers"`
		HeadersTruncated  bool                 `json:"headersTruncated"`
		TrailersTruncated bool                 `json:"trailersTruncated"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Service != "demo.v1.Greeter" || payload.StartedAt == "" || payload.HandlerInvokeMs < 0 {
		t.Fatalf("request evidence = service %q, startedAt %q, invoke %.3f", payload.Service, payload.StartedAt, payload.HandlerInvokeMs)
	}
	if payload.ServingStatus == nil || payload.ServingStatus.Code != int32(healthpb.HealthCheckResponse_SERVING) || payload.ServingStatus.Name != "SERVING" {
		t.Fatalf("servingStatus = %#v", payload.ServingStatus)
	}
	if payload.GRPCStatus.Code != 0 || payload.GRPCStatus.Name != "OK" || payload.GRPCStatus.Message != "" || payload.GRPCStatus.MessageTruncated {
		t.Fatalf("grpcStatus = %#v", payload.GRPCStatus)
	}
	if !containsTestHealthMetadata(payload.Headers, testHealthMetadata{Name: "x-health-header", Value: "ready"}) {
		t.Fatalf("headers = %#v", payload.Headers)
	}
	if !containsTestHealthMetadata(payload.Trailers, testHealthMetadata{Name: "x-health-trailer", Value: "done"}) {
		t.Fatalf("trailers = %#v", payload.Trailers)
	}
	if payload.HeadersTruncated || payload.TrailersTruncated {
		t.Fatalf("unexpected metadata truncation: headers=%v trailers=%v", payload.HeadersTruncated, payload.TrailersTruncated)
	}
	select {
	case got := <-service.requests:
		if got.GetService() != "demo.v1.Greeter" {
			t.Fatalf("server service = %q", got.GetService())
		}
	default:
		t.Fatal("health server did not receive Check")
	}
}

func TestHealthCheckUnknownServiceIsNOTFOUNDEvidence(t *testing.T) {
	t.Parallel()

	service := &testHealthService{requests: make(chan *healthpb.HealthCheckRequest, 1)}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/check", `{"service":"missing.v1.Service"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload struct {
		ServingStatus *healthServingStatus `json:"servingStatus"`
		GRPCStatus    healthGRPCStatus     `json:"grpcStatus"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ServingStatus != nil {
		t.Fatalf("servingStatus = %#v, want null", payload.ServingStatus)
	}
	if payload.GRPCStatus.Code != int32(codes.NotFound) || payload.GRPCStatus.Name != "NotFound" || payload.GRPCStatus.Message != "unknown service" {
		t.Fatalf("grpcStatus = %#v", payload.GRPCStatus)
	}
}

func TestHealthCheckDeadlineIsCanonicalEvidence(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &deadlineCheckHealthService{})
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/check", `{"service":"slow","timeout_seconds":0.1}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var evidence healthCheckResponse
	if err := json.Unmarshal(response.Body.Bytes(), &evidence); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if evidence.ServingStatus != nil || evidence.GRPCStatus.Code != int32(codes.DeadlineExceeded) || evidence.GRPCStatus.Name != "DeadlineExceeded" {
		t.Fatalf("deadline evidence = %#v", evidence)
	}
	if evidence.HandlerInvokeMs < 50 || math.IsNaN(evidence.HandlerInvokeMs) || math.IsInf(evidence.HandlerInvokeMs, 0) {
		t.Fatalf("handlerInvokeMs = %.3f", evidence.HandlerInvokeMs)
	}
}

func TestHealthCheckWorkspaceRoutingAndCSRFParity(t *testing.T) {
	t.Parallel()

	service := &testHealthService{requests: make(chan *healthpb.HealthCheckRequest, 2)}
	connection := startHealthGRPCTarget(t, service)
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["health-session"] = &workspaceSession{id: "health-session", cc: connection}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))

	response := performHealthJSONRequest(t, handler, "/api/workspace/health/check?session_id=health-session", `{"service":"demo.v1.Greeter"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("workspace status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload healthCheckResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode workspace response: %v", err)
	}
	if payload.ServingStatus == nil || payload.ServingStatus.Name != "SERVING" {
		t.Fatalf("workspace servingStatus = %#v", payload.ServingStatus)
	}

	for _, path := range []string{"/api/health/check", "/api/workspace/health/check?session_id=health-session"} {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"service":""}`))
		request.Header.Set("Content-Type", "application/json")
		missingCSRF := httptest.NewRecorder()
		handler.ServeHTTP(missingCSRF, request)
		if missingCSRF.Code != http.StatusUnauthorized {
			t.Errorf("missing CSRF for %s status = %d", path, missingCSRF.Code)
		}
	}
}

func TestHealthCheckMetadataPrecedenceBinaryAndSecretNonEcho(t *testing.T) {
	t.Parallel()

	service := &testHealthService{
		requests: make(chan *healthpb.HealthCheckRequest, 1),
		metadata: make(chan metadata.MD, 1),
	}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(
		connection,
		"health-target",
		nil,
		nil,
		WithMetadata([]string{"x-order: cli", "x-cli: fixed", "x-extra-bin: WVdKag=="}),
		PreserveHeaders([]string{"x-order"}),
	)
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/health/check", strings.NewReader(`{
  "service":"",
  "metadata":[
    {"name":"x-order","value":"body-one"},
    {"name":"x-order","value":"body-two"},
    {"name":"x-duplicate","value":"first"},
    {"name":"x-duplicate","value":"second"},
    {"name":"payload-bin","value":"c2VjcmV0"},
    {"name":"authorization","value":"top-secret"}
  ]
}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Add("x-order", "preserved-one")
	request.Header.Add("x-order", "preserved-two")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "top-secret") || strings.Contains(response.Body.String(), "c2VjcmV0") {
		t.Fatalf("response echoed request secret metadata: %q", response.Body.String())
	}
	select {
	case incoming := <-service.metadata:
		if got := incoming.Get("x-order"); len(got) != 2 || got[0] != "preserved-one" || got[1] != "preserved-two" {
			t.Fatalf("preserved precedence = %#v", got)
		}
		if got := incoming.Get("x-cli"); len(got) != 1 || got[0] != "fixed" {
			t.Fatalf("extra metadata = %#v", got)
		}
		if got := incoming.Get("x-duplicate"); len(got) != 2 || got[0] != "first" || got[1] != "second" {
			t.Fatalf("typed duplicates = %#v", got)
		}
		if got := incoming.Get("payload-bin"); len(got) != 1 || got[0] != "secret" {
			t.Fatalf("binary metadata = %#v", got)
		}
		if got := incoming.Get("x-extra-bin"); len(got) != 1 || got[0] != "YWJj" {
			t.Fatalf("extra binary metadata was not decoded exactly once: %#v", got)
		}
	default:
		t.Fatal("health server did not capture metadata")
	}
}

func TestHealthCheckRejectsNonObjectTrailingAndChunkedOversizeJSON(t *testing.T) {
	t.Parallel()

	service := &testHealthService{requests: make(chan *healthpb.HealthCheckRequest, 1)}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)
	for _, body := range []string{"null", "[]", `{} {}`, `{"unknown":true}`} {
		response := performHealthJSONRequest(t, handler, "/api/health/check", body)
		if response.Code != http.StatusBadRequest {
			t.Errorf("body %q status = %d, body = %q", body, response.Code, response.Body.String())
		}
	}

	cookie := workspaceUploadCSRFCookie(t, handler)
	body := &countingReadCloser{reader: strings.NewReader(`{"service":"` + strings.Repeat("x", int(maxHealthRequestBodyBytes)) + `"}`)}
	request := httptest.NewRequest(http.MethodPost, "/api/health/check", body)
	request.ContentLength = -1
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("chunked oversized status = %d, body = %q", response.Code, response.Body.String())
	}
	select {
	case request := <-service.requests:
		t.Fatalf("invalid request reached health server: %#v", request)
	default:
	}
}

func TestHealthWatchFlushesOrderedCanonicalNDJSON(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &sequenceHealthService{})
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"missing.v1.Service","duration_seconds":2,"metadata":[{"name":"authorization","value":"watch-secret"}]}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
	if !response.Flushed {
		t.Fatal("watch response was not flushed")
	}
	if strings.Contains(response.Body.String(), "watch-secret") || strings.Contains(response.Body.String(), "authorization") {
		t.Fatalf("Watch echoed request metadata: %q", response.Body.String())
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	if len(lines) != 5 {
		t.Fatalf("event lines = %d, want 5; body = %q", len(lines), response.Body.String())
	}
	events := make([]map[string]any, len(lines))
	lastOffset := float64(0)
	for index, line := range lines {
		if err := json.Unmarshal([]byte(line), &events[index]); err != nil {
			t.Fatalf("decode event %d: %v; line = %q", index, err, line)
		}
		if events[index]["service"] != "missing.v1.Service" || events[index]["startedAt"] == "" {
			t.Fatalf("event %d frozen attribution = %#v", index, events[index])
		}
		if offset, ok := events[index]["observedOffsetMs"].(float64); !ok || offset < 0 || math.IsNaN(offset) || math.IsInf(offset, 0) || offset < lastOffset {
			t.Fatalf("event %d offset = %#v", index, events[index]["observedOffsetMs"])
		} else {
			lastOffset = offset
		}
	}
	wantTypes := []string{"started", "headers-observed", "status-observed", "status-observed", "ended"}
	for index, want := range wantTypes {
		if events[index]["type"] != want {
			t.Fatalf("event %d type = %#v, want %q", index, events[index]["type"], want)
		}
	}
	if events[0]["durationSeconds"] != float64(2) || events[0]["metadataCount"] != float64(1) {
		t.Fatalf("started event = %#v", events[0])
	}
	firstStatus := events[2]["servingStatus"].(map[string]any)
	secondStatus := events[3]["servingStatus"].(map[string]any)
	if events[2]["sequence"] != float64(1) || events[3]["sequence"] != float64(2) {
		t.Fatalf("status sequences = %#v and %#v", events[2]["sequence"], events[3]["sequence"])
	}
	if firstStatus["name"] != "SERVICE_UNKNOWN" || secondStatus["name"] != "SERVING" {
		t.Fatalf("status sequence = %#v then %#v", firstStatus, secondStatus)
	}
	ended := events[4]
	if ended["reason"] != "completed" || ended["observationCount"] != float64(2) {
		t.Fatalf("ended event = %#v", ended)
	}
	grpcStatus := ended["grpcStatus"].(map[string]any)
	if grpcStatus["code"] != float64(codes.OK) || grpcStatus["name"] != "OK" {
		t.Fatalf("ended grpcStatus = %#v", grpcStatus)
	}
}

func TestHealthWatchStartedFlushFailureStopsBeforeRPCAndReleasesSlot(t *testing.T) {
	t.Parallel()

	service := &unimplementedWatchHealthService{}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	flushErr := errors.New("client stream flush failed")

	for index := 0; index < maxConcurrentHealthWatches+1; index++ {
		request := newHealthJSONRequest(
			context.Background(),
			cookie,
			"/api/health/watch",
			strings.NewReader(`{"service":"","duration_seconds":2}`),
		)
		response := &healthFlushErrorWriter{
			ResponseRecorder: httptest.NewRecorder(),
			err:              flushErr,
		}
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, body = %q", index, response.Code, response.Body.String())
		}
		if response.flushCalls != 1 {
			t.Fatalf("request %d FlushError calls = %d, want 1", index, response.flushCalls)
		}
	}
	if calls := service.calls.Load(); calls != 0 {
		t.Fatalf("Watch RPC calls after started-frame flush failures = %d, want 0", calls)
	}
}

func TestHealthWatchCanonicalUnknownServiceStaysOpen(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, grpcHealth.NewServer())
	server := httptest.NewServer(Handler(connection, "health-target", nil, nil))
	t.Cleanup(server.Close)
	bootstrap, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	cookies := bootstrap.Cookies()
	_ = bootstrap.Body.Close()
	if len(cookies) == 0 {
		t.Fatal("bootstrap response omitted CSRF cookie")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/api/health/watch", strings.NewReader(`{"service":"unknown.v1.Service","duration_seconds":600}`))
	if err != nil {
		t.Fatalf("create Watch request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookies[0].Value)
	request.AddCookie(cookies[0])
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("Watch request: %v", err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	foundUnknown := false
	for index := 0; index < 3; index++ {
		line, readErr := reader.ReadString('\n')
		if readErr != nil {
			t.Fatalf("read Watch event: %v", readErr)
		}
		var event struct {
			Type          string               `json:"type"`
			ServingStatus *healthServingStatus `json:"servingStatus"`
		}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode Watch event: %v", err)
		}
		if event.Type == "status-observed" {
			if event.ServingStatus == nil || event.ServingStatus.Name != "SERVICE_UNKNOWN" {
				t.Fatalf("unknown status = %#v", event.ServingStatus)
			}
			foundUnknown = true
			break
		}
	}
	if !foundUnknown {
		t.Fatal("Watch did not emit SERVICE_UNKNOWN")
	}
	nextLine := make(chan string, 1)
	go func() {
		line, _ := reader.ReadString('\n')
		nextLine <- line
	}()
	select {
	case line := <-nextLine:
		t.Fatalf("unknown Watch terminated without a local limit: %q", line)
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	waitHealthSignal(t, nextLine, "canceled unknown Watch reader")
}

func TestHealthWatchLimiterIsSharedAndRejectsBeforeBodyRead(t *testing.T) {
	t.Parallel()

	service := &blockingHealthService{started: make(chan string, maxConcurrentHealthWatches)}
	connection := startHealthGRPCTarget(t, service)
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["health-session"] = &workspaceSession{id: "health-session", cc: connection}
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(connection, "health-target", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)

	cancels := make([]context.CancelFunc, 0, maxConcurrentHealthWatches)
	done := make(chan struct{}, maxConcurrentHealthWatches)
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		path := "/api/health/watch"
		if index%2 == 1 {
			path = "/api/workspace/health/watch?session_id=health-session"
		}
		request := newHealthJSONRequest(ctx, cookie, path, strings.NewReader(`{"service":"watch-`+string(rune('a'+index))+`","duration_seconds":600}`))
		response := httptest.NewRecorder()
		go func() {
			handler.ServeHTTP(response, request)
			done <- struct{}{}
		}()
	}
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		waitHealthSignal(t, service.started, "active Health Watch")
	}

	blockedBody := &countingReadCloser{reader: strings.NewReader(`{"service":"fifth","duration_seconds":600}`)}
	blockedRequest := newHealthJSONRequest(context.Background(), cookie, "/api/health/watch", blockedBody)
	blockedResponse := httptest.NewRecorder()
	handler.ServeHTTP(blockedResponse, blockedRequest)
	if blockedResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("fifth Watch status = %d, body = %q", blockedResponse.Code, blockedResponse.Body.String())
	}
	if blockedBody.reads != 0 {
		t.Fatalf("saturated Watch read body %d times", blockedBody.reads)
	}
	if blockedResponse.Header().Get("Retry-After") == "" {
		t.Fatal("saturated Watch omitted Retry-After")
	}

	for _, cancel := range cancels {
		cancel()
	}
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		waitHealthSignal(t, done, "canceled Health Watch completion")
	}
	fresh := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"fresh","duration_seconds":0.5}`)
	if fresh.Code != http.StatusBadRequest {
		t.Fatalf("released Watch slot status = %d, body = %q", fresh.Code, fresh.Body.String())
	}
}

func TestHealthWatchWorkspaceDisconnectTerminatesAndReleasesAllSlots(t *testing.T) {
	t.Parallel()

	service := &blockingHealthService{started: make(chan string, maxConcurrentHealthWatches)}
	connection := startHealthGRPCTarget(t, service)
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["health-session"] = &workspaceSession{id: "health-session", cc: connection}
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	done := make(chan *httptest.ResponseRecorder, maxConcurrentHealthWatches)
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		request := newHealthJSONRequest(
			context.Background(),
			cookie,
			"/api/workspace/health/watch?session_id=health-session",
			strings.NewReader(`{"service":"disconnect-`+string(rune('a'+index))+`","duration_seconds":600}`),
		)
		response := httptest.NewRecorder()
		go func() {
			handler.ServeHTTP(response, request)
			done <- response
		}()
	}
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		waitHealthSignal(t, service.started, "workspace Health Watch")
	}
	if !manager.Disconnect("health-session") {
		t.Fatal("workspace session was not disconnected")
	}
	for index := 0; index < maxConcurrentHealthWatches; index++ {
		response := waitHealthSignal(t, done, "disconnected workspace Watch")
		ended := lastHealthWatchEvent(t, response.Body.String())
		if ended.Reason != "rpc-error" || ended.GRPCStatus.Code == int32(codes.OK) {
			t.Fatalf("disconnected ended = %#v", ended)
		}
	}

	unknownBody := &countingReadCloser{reader: strings.NewReader(`{"service":"after-disconnect"}`)}
	unknownRequest := newHealthJSONRequest(context.Background(), cookie, "/api/workspace/health/watch?session_id=health-session", unknownBody)
	unknownResponse := httptest.NewRecorder()
	handler.ServeHTTP(unknownResponse, unknownRequest)
	if unknownResponse.Code != http.StatusNotFound {
		t.Fatalf("post-disconnect status = %d, body = %q", unknownResponse.Code, unknownResponse.Body.String())
	}
	if unknownBody.reads != 0 {
		t.Fatalf("unknown session request read body %d times", unknownBody.reads)
	}
}

func TestHealthWatchUNIMPLEMENTEDIsTerminalWithoutRetry(t *testing.T) {
	t.Parallel()

	watchCalls := 0
	fake := &fakeHealthClient{
		check: func(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (*healthpb.HealthCheckResponse, error) {
			return nil, status.Error(codes.Unimplemented, "check unavailable")
		},
		watch: func(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[healthpb.HealthCheckResponse], error) {
			watchCalls++
			return nil, status.Error(codes.Unimplemented, "watch unavailable")
		},
	}
	handlers := newHealthHandlerSet(nil, nil)
	handlers.clientFactory = func(grpc.ClientConnInterface) healthClient { return fake }
	handler := handlers.watchHandler(func(*http.Request) (grpc.ClientConnInterface, *healthRequestError) {
		return nil, nil
	})
	cookie := &http.Cookie{Name: csrfCookieName, Value: "health-token"}
	request := newHealthJSONRequest(context.Background(), cookie, "/api/health/watch", strings.NewReader(`{"service":"","duration_seconds":2}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if watchCalls != 1 {
		t.Fatalf("Watch calls = %d, want exactly one", watchCalls)
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("events = %d, body = %q", len(lines), response.Body.String())
	}
	var ended healthWatchEndedEvent
	if err := json.Unmarshal([]byte(lines[1]), &ended); err != nil {
		t.Fatalf("decode ended event: %v", err)
	}
	if ended.Type != "ended" || ended.Reason != "unsupported" || ended.GRPCStatus.Code != int32(codes.Unimplemented) || ended.GRPCStatus.Name != "Unimplemented" {
		t.Fatalf("ended = %#v", ended)
	}
}

func TestHealthWatchRealUNIMPLEMENTEDIsOneTerminalEpoch(t *testing.T) {
	t.Parallel()

	service := &unimplementedWatchHealthService{}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"","duration_seconds":2}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	if len(lines) < 2 || len(lines) > 3 {
		t.Fatalf("events = %d, body = %q", len(lines), response.Body.String())
	}
	var first struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil || first.Type != "started" {
		t.Fatalf("first event = %#v, err = %v", first, err)
	}
	if len(lines) == 3 {
		var middle struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(lines[1]), &middle); err != nil || middle.Type != "headers-observed" {
			t.Fatalf("middle event = %#v, err = %v", middle, err)
		}
	}
	ended := lastHealthWatchEvent(t, response.Body.String())
	if ended.Reason != "unsupported" || ended.ObservationCount != 0 || ended.GRPCStatus.Code != int32(codes.Unimplemented) {
		t.Fatalf("ended = %#v", ended)
	}
	if calls := service.calls.Load(); calls != 1 {
		t.Fatalf("Watch calls = %d, want exactly one", calls)
	}
}

func TestHealthWatchServerCanceledIsRPCError(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &canceledHealthService{})
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"","duration_seconds":2}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	ended := lastHealthWatchEvent(t, response.Body.String())
	if ended.Reason != "rpc-error" || ended.GRPCStatus.Code != int32(codes.Canceled) {
		t.Fatalf("server-canceled ended = %#v", ended)
	}
}

func TestHealthWatchDirectWorkspaceSecurityAndEvidenceParity(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &sequenceHealthService{})
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["health-session"] = &workspaceSession{id: "health-session", cc: connection}
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(connection, "health-target", nil, nil, WithWorkspaceManager(manager))
	paths := []string{
		"/api/health/watch",
		"/api/workspace/health/watch?session_id=health-session",
	}
	for _, path := range paths {
		response := performHealthJSONRequest(t, handler, path, `{"service":"parity","duration_seconds":2}`)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body = %q", path, response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s safety headers = %#v", path, response.Header())
		}
		if response.Header().Get("Content-Type") != "application/x-ndjson" {
			t.Fatalf("%s Content-Type = %q", path, response.Header().Get("Content-Type"))
		}
		ended := lastHealthWatchEvent(t, response.Body.String())
		if ended.Reason != "completed" || ended.GRPCStatus.Code != int32(codes.OK) {
			t.Fatalf("%s ended = %#v", path, ended)
		}

		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"service":"parity"}`))
		request.Header.Set("Content-Type", "application/json")
		missingCSRF := httptest.NewRecorder()
		handler.ServeHTTP(missingCSRF, request)
		if missingCSRF.Code != http.StatusUnauthorized {
			t.Fatalf("%s missing CSRF status = %d", path, missingCSRF.Code)
		}
		if missingCSRF.Header().Get("Cache-Control") != "no-store" || missingCSRF.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s missing-CSRF safety headers = %#v", path, missingCSRF.Header())
		}
	}
}

func TestHealthResponseEvidenceIsBoundedAndWatchLinesFit(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &largeHealthEvidenceService{})
	handler := Handler(connection, "health-target", nil, nil)
	check := performHealthJSONRequest(t, handler, "/api/health/check", `{"service":"large","timeout_seconds":2}`)
	if check.Code != http.StatusOK {
		t.Fatalf("Check status = %d, body = %q", check.Code, check.Body.String())
	}
	var checkEvidence healthCheckResponse
	if err := json.Unmarshal(check.Body.Bytes(), &checkEvidence); err != nil {
		t.Fatalf("decode Check evidence: %v", err)
	}
	if !checkEvidence.HeadersTruncated || !checkEvidence.TrailersTruncated || len(checkEvidence.Headers) == 0 || len(checkEvidence.Trailers) != 0 {
		t.Fatalf("Check metadata budget = headers %d/%v trailers %d/%v", len(checkEvidence.Headers), checkEvidence.HeadersTruncated, len(checkEvidence.Trailers), checkEvidence.TrailersTruncated)
	}
	if !checkEvidence.GRPCStatus.MessageTruncated || len(checkEvidence.GRPCStatus.Message) > maxHealthStatusMessageBytes || !utf8.ValidString(checkEvidence.GRPCStatus.Message) {
		t.Fatalf("Check status message = %d bytes, truncated=%v", len(checkEvidence.GRPCStatus.Message), checkEvidence.GRPCStatus.MessageTruncated)
	}

	watch := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"large","duration_seconds":2}`)
	if watch.Code != http.StatusOK {
		t.Fatalf("Watch status = %d, body = %q", watch.Code, watch.Body.String())
	}
	lines := strings.Split(strings.TrimSpace(watch.Body.String()), "\n")
	for index, line := range lines {
		if len(line)+1 > maxHealthNDJSONLineBytes {
			t.Fatalf("Watch line %d = %d bytes", index, len(line)+1)
		}
	}
	var headers healthWatchHeadersEvent
	if err := json.Unmarshal([]byte(lines[1]), &headers); err != nil {
		t.Fatalf("decode Watch headers: %v", err)
	}
	ended := lastHealthWatchEvent(t, watch.Body.String())
	if headers.Type != "headers-observed" || !headers.HeadersTruncated || len(headers.Headers) == 0 {
		t.Fatalf("Watch headers = %#v", headers)
	}
	if !ended.TrailersTruncated || len(ended.Trailers) != 0 {
		t.Fatalf("Watch shared trailer budget = %#v", ended)
	}
	if !ended.GRPCStatus.MessageTruncated || len(ended.GRPCStatus.Message) > maxHealthStatusMessageBytes || !utf8.ValidString(ended.GRPCStatus.Message) {
		t.Fatalf("Watch status message = %d bytes, truncated=%v", len(ended.GRPCStatus.Message), ended.GRPCStatus.MessageTruncated)
	}
}

func TestBoundedHealthMetadataCapsInspectionAndRejectsHugeBinaryValue(t *testing.T) {
	t.Parallel()

	many := metadata.MD{"x-small": make([]string, maxHealthResponseMetadataEntries+1)}
	for index := range many["x-small"] {
		many["x-small"][index] = "v"
	}
	result, truncated, used := boundedHealthMetadata(many, maxHealthResponseMetadataBytes)
	if !truncated {
		t.Fatal("metadata was not marked truncated")
	}
	if len(result) != maxHealthResponseMetadataEntries {
		t.Fatalf("retained entries = %d, want %d", len(result), maxHealthResponseMetadataEntries)
	}
	if used > maxHealthResponseMetadataBytes {
		t.Fatalf("retained metadata uses %d bytes", used)
	}

	hugeResult, hugeTruncated, hugeUsed := boundedHealthMetadata(metadata.MD{
		"a-huge-bin": {strings.Repeat("x", 2<<20)},
	}, maxHealthResponseMetadataBytes)
	if !hugeTruncated || len(hugeResult) != 0 || hugeUsed != 0 {
		t.Fatalf("huge binary metadata = %d entries, %d bytes, truncated=%v", len(hugeResult), hugeUsed, hugeTruncated)
	}
}

func TestHealthWatchStartedFrameFlushesOverHTTP(t *testing.T) {
	t.Parallel()

	service := &blockingHealthService{started: make(chan string, 1)}
	connection := startHealthGRPCTarget(t, service)
	server := httptest.NewServer(Handler(connection, "health-target", nil, nil))
	t.Cleanup(server.Close)
	bootstrap, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	cookies := bootstrap.Cookies()
	_ = bootstrap.Body.Close()
	if len(cookies) == 0 {
		t.Fatal("bootstrap response omitted CSRF cookie")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/api/health/watch", strings.NewReader(`{"service":"network","duration_seconds":600}`))
	if err != nil {
		t.Fatalf("create Watch request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookies[0].Value)
	request.AddCookie(cookies[0])
	type responseResult struct {
		response *http.Response
		err      error
	}
	responseReady := make(chan responseResult, 1)
	go func() {
		response, requestErr := server.Client().Do(request)
		responseReady <- responseResult{response: response, err: requestErr}
	}()
	result := waitHealthSignal(t, responseReady, "flushed HTTP Watch response")
	if result.err != nil {
		t.Fatalf("Watch request: %v", result.err)
	}
	defer result.response.Body.Close()
	lineReady := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(result.response.Body).ReadString('\n')
		lineReady <- line
	}()
	line := waitHealthSignal(t, lineReady, "started NDJSON frame")
	var started healthWatchStartedEvent
	if err := json.Unmarshal([]byte(line), &started); err != nil {
		t.Fatalf("decode started frame: %v; line = %q", err, line)
	}
	if started.Type != "started" || started.Service != "network" {
		t.Fatalf("started frame = %#v", started)
	}
	cancel()
}

func TestHealthWatchCancellationAndDurationAreExplicit(t *testing.T) {
	t.Parallel()

	t.Run("request cancellation", func(t *testing.T) {
		service := &blockingHealthService{started: make(chan string, 1)}
		connection := startHealthGRPCTarget(t, service)
		handler := Handler(connection, "health-target", nil, nil)
		cookie := workspaceUploadCSRFCookie(t, handler)
		ctx, cancel := context.WithCancel(context.Background())
		request := newHealthJSONRequest(ctx, cookie, "/api/health/watch", strings.NewReader(`{"service":"cancel","duration_seconds":600}`))
		response := httptest.NewRecorder()
		done := make(chan struct{})
		go func() {
			handler.ServeHTTP(response, request)
			close(done)
		}()
		waitHealthSignal(t, service.started, "cancelable Health Watch")
		cancel()
		waitHealthSignal(t, done, "canceled Health Watch")
		ended := lastHealthWatchEvent(t, response.Body.String())
		if ended.Reason != "canceled" || ended.GRPCStatus.Code != int32(codes.Canceled) {
			t.Fatalf("canceled ended = %#v", ended)
		}
	})

	t.Run("duration limit", func(t *testing.T) {
		service := &blockingHealthService{started: make(chan string, 1)}
		connection := startHealthGRPCTarget(t, service)
		handler := Handler(connection, "health-target", nil, nil)
		response := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"duration","duration_seconds":1}`)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
		ended := lastHealthWatchEvent(t, response.Body.String())
		if ended.Reason != "duration-limit" || ended.GRPCStatus.Code != int32(codes.DeadlineExceeded) {
			t.Fatalf("duration ended = %#v", ended)
		}
	})
}

func TestHealthWatchStopsAtObservationLimit(t *testing.T) {
	t.Parallel()

	connection := startHealthGRPCTarget(t, &floodHealthService{})
	handler := Handler(connection, "health-target", nil, nil)
	response := performHealthJSONRequest(t, handler, "/api/health/watch", `{"service":"flood","duration_seconds":10}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	statusCount := 0
	for _, line := range lines {
		var event struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		if event.Type == "status-observed" {
			statusCount++
		}
	}
	if statusCount != maxHealthWatchObservations {
		t.Fatalf("status observations = %d, want %d", statusCount, maxHealthWatchObservations)
	}
	ended := lastHealthWatchEvent(t, response.Body.String())
	if ended.Reason != "observation-limit" || ended.ObservationCount != maxHealthWatchObservations || ended.GRPCStatus.Code != int32(codes.Canceled) || !ended.TrailersTruncated {
		t.Fatalf("observation-limit ended = %#v", ended)
	}
}

func TestHealthRequestCapsAtPublicEndpoints(t *testing.T) {
	t.Parallel()

	service := &testHealthService{requests: make(chan *healthpb.HealthCheckRequest, 32)}
	connection := startHealthGRPCTarget(t, service)
	handler := Handler(connection, "health-target", nil, nil)

	metadataJSON := func(entries []healthMetadata) string {
		encoded, err := json.Marshal(map[string]any{"service": "", "metadata": entries})
		if err != nil {
			t.Fatalf("encode metadata request: %v", err)
		}
		return string(encoded)
	}
	exactAggregate := []healthMetadata{
		{Name: "x0", Value: strings.Repeat("v", 8190)},
		{Name: "x1", Value: strings.Repeat("v", 8190)},
		{Name: "x2", Value: strings.Repeat("v", 8190)},
		{Name: "x3", Value: strings.Repeat("v", 8190)},
	}
	overAggregate := append([]healthMetadata(nil), exactAggregate...)
	overAggregate[3].Value += "v"
	exactEntries := make([]healthMetadata, maxHealthMetadataEntries)
	for index := range exactEntries {
		exactEntries[index] = healthMetadata{Name: "x", Value: "v"}
	}
	overEntries := append([]healthMetadata(nil), exactEntries...)
	overEntries = append(overEntries, healthMetadata{Name: "x", Value: "v"})

	accepted := []struct {
		path string
		body string
	}{
		{"/api/health/check", `{"service":"` + strings.Repeat("s", maxHealthServiceBytes) + `","timeout_seconds":30}`},
		{"/api/health/check", metadataJSON([]healthMetadata{{Name: strings.Repeat("n", maxHealthMetadataNameBytes), Value: strings.Repeat("v", maxHealthMetadataValueBytes)}})},
		{"/api/health/check", metadataJSON(exactEntries)},
		{"/api/health/check", metadataJSON(exactAggregate)},
		{"/api/health/watch", `{"service":"","duration_seconds":600}`},
	}
	for _, test := range accepted {
		response := performHealthJSONRequest(t, handler, test.path, test.body)
		if response.Code != http.StatusOK {
			t.Errorf("accepted %s status = %d, body = %q", test.path, response.Code, response.Body.String())
		}
	}

	rejected := []struct {
		path string
		body string
	}{
		{"/api/health/check", `{"service":"` + strings.Repeat("s", maxHealthServiceBytes+1) + `"}`},
		{"/api/health/check", metadataJSON([]healthMetadata{{Name: strings.Repeat("n", maxHealthMetadataNameBytes+1), Value: ""}})},
		{"/api/health/check", metadataJSON([]healthMetadata{{Name: "x", Value: strings.Repeat("v", maxHealthMetadataValueBytes+1)}})},
		{"/api/health/check", metadataJSON(overEntries)},
		{"/api/health/check", metadataJSON(overAggregate)},
		{"/api/health/check", `{"timeout_seconds":0.099}`},
		{"/api/health/check", `{"timeout_seconds":30.001}`},
		{"/api/health/watch", `{"duration_seconds":0.999}`},
		{"/api/health/watch", `{"duration_seconds":600.001}`},
	}
	for _, test := range rejected {
		response := performHealthJSONRequest(t, handler, test.path, test.body)
		if response.Code != http.StatusBadRequest {
			t.Errorf("rejected %s status = %d, body = %q", test.path, response.Code, response.Body.String())
		}
	}

	exactBody := `{}` + strings.Repeat(" ", int(maxHealthRequestBodyBytes)-2)
	if response := performHealthJSONRequest(t, handler, "/api/health/check", exactBody); response.Code != http.StatusOK {
		t.Fatalf("exact body cap status = %d, body = %q", response.Code, response.Body.String())
	}
	overBody := exactBody + " "
	if response := performHealthJSONRequest(t, handler, "/api/health/check", overBody); response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("body cap +1 status = %d, body = %q", response.Code, response.Body.String())
	}
}

func TestHealthWatchReasonKeepsLocalAndGRPCEvidenceConsistent(t *testing.T) {
	t.Parallel()

	canceledRequest, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()
	canceledCall, cancelCall := context.WithCancel(context.Background())
	cancelCall()
	deadlineCall, cancelDeadline := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelDeadline()
	tests := []struct {
		name       string
		request    context.Context
		call       context.Context
		terminal   error
		wantReason string
	}{
		{"matching request cancellation", canceledRequest, canceledCall, status.Error(codes.Canceled, "canceled"), "canceled"},
		{"cancellation race preserves unsupported", canceledRequest, canceledCall, status.Error(codes.Unimplemented, "unsupported"), "unsupported"},
		{"cancellation race preserves server failure", canceledRequest, canceledCall, status.Error(codes.Unavailable, "gone"), "rpc-error"},
		{"matching duration limit", context.Background(), deadlineCall, status.Error(codes.DeadlineExceeded, "deadline"), "duration-limit"},
		{"deadline race preserves server failure", context.Background(), deadlineCall, status.Error(codes.Unavailable, "gone"), "rpc-error"},
		{"server canceled", context.Background(), context.Background(), status.Error(codes.Canceled, "server"), "rpc-error"},
		{"clean completion", context.Background(), context.Background(), nil, "completed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := healthWatchReason(test.request, test.call, test.terminal, false); got != test.wantReason {
				t.Fatalf("reason = %q, want %q", got, test.wantReason)
			}
		})
	}
}

func lastHealthWatchEvent(t *testing.T, body string) healthWatchEndedEvent {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) == 0 || lines[0] == "" {
		t.Fatal("watch response contained no events")
	}
	var ended healthWatchEndedEvent
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &ended); err != nil {
		t.Fatalf("decode ended event: %v", err)
	}
	if ended.Type != "ended" {
		t.Fatalf("last event type = %q, want ended", ended.Type)
	}
	return ended
}

func containsTestHealthMetadata(values []testHealthMetadata, expected testHealthMetadata) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func startHealthGRPCTarget(t *testing.T, service healthpb.HealthServer) *grpc.ClientConn {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	healthpb.RegisterHealthServer(server, service)
	done := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(done)
	}()
	connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		server.Stop()
		_ = listener.Close()
		<-done
		t.Fatalf("create health client: %v", err)
	}
	t.Cleanup(func() {
		_ = connection.Close()
		server.Stop()
		_ = listener.Close()
		<-done
	})
	return connection
}

func performHealthJSONRequest(t *testing.T, handler http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func newHealthJSONRequest(ctx context.Context, cookie *http.Cookie, path string, body io.Reader) *http.Request {
	request := httptest.NewRequest(http.MethodPost, path, body).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	return request
}

func waitHealthSignal[T any](t *testing.T, signal <-chan T, description string) T {
	t.Helper()
	select {
	case value := <-signal:
		return value
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
		var zero T
		return zero
	}
}
