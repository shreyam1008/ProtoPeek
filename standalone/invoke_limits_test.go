package standalone

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func TestWorkspaceInvokeReturnsPartialEvidenceAtLocalRetentionLimit(t *testing.T) {
	t.Parallel()

	service := &workspaceRetentionHealthService{canceled: make(chan struct{})}
	connection := startHealthGRPCTarget(t, service)
	file, err := desc.LoadFileDescriptor("grpc/health/v1/health.proto")
	if err != nil {
		t.Fatalf("load health descriptor: %v", err)
	}
	method := file.FindService("grpc.health.v1.Health").FindMethodByName("Watch")
	if method == nil {
		t.Fatal("health Watch descriptor is missing")
	}
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["retention-session"] = &workspaceSession{
		id:      "retention-session",
		cc:      connection,
		methods: []*desc.MethodDescriptor{method},
		files:   []*desc.FileDescriptor{file},
	}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/workspace/invoke/grpc.health.v1.Health.Watch?session_id=retention-session",
		strings.NewReader(`{"data":[{"service":""}]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result struct {
		Responses []json.RawMessage `json:"responses"`
		Error     any               `json:"error"`
		Trailers  []json.RawMessage `json:"trailers"`
		Timings   struct {
			TrailersMs *float64 `json:"trailersMs"`
		} `json:"timings"`
		LocalLimit *struct {
			Reason             string  `json:"reason"`
			RetainedResponses  int     `json:"retainedResponses"`
			MaxResponses       int     `json:"maxResponses"`
			MaxResponseBytes   int     `json:"maxResponseBytes"`
			MaxDurationSeconds float64 `json:"maxDurationSeconds"`
		} `json:"localLimit"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Responses) != 512 || result.LocalLimit == nil || result.LocalLimit.Reason != "response-count" {
		t.Fatalf("workspace partial result = responses %d, limit %#v", len(result.Responses), result.LocalLimit)
	}
	if result.LocalLimit.RetainedResponses != 512 || result.LocalLimit.MaxResponses != 512 || result.LocalLimit.MaxResponseBytes != 8<<20 || result.LocalLimit.MaxDurationSeconds != 60 {
		t.Fatalf("workspace limit policy = %#v", result.LocalLimit)
	}
	if result.Error != nil || len(result.Trailers) != 0 || result.Timings.TrailersMs != nil {
		t.Fatalf("fabricated final status = error %#v, trailers %#v, timing %v", result.Error, result.Trailers, result.Timings.TrailersMs)
	}
	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("workspace target did not observe local retention cancellation")
	}
}

func TestHandlerConfiguredInvokeWallReturnsLocalLimitEvidence(t *testing.T) {
	t.Parallel()

	service := &workspaceWallHealthService{canceled: make(chan struct{})}
	connection := startHealthGRPCTarget(t, service)
	file, err := desc.LoadFileDescriptor("grpc/health/v1/health.proto")
	if err != nil {
		t.Fatalf("load health descriptor: %v", err)
	}
	method := file.FindService("grpc.health.v1.Health").FindMethodByName("Watch")
	handler := Handler(
		connection,
		"",
		[]*desc.MethodDescriptor{method},
		[]*desc.FileDescriptor{file},
		WithInvokeMaxDuration(20*time.Millisecond),
	)
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(
		http.MethodPost,
		"/invoke/grpc.health.v1.Health.Watch",
		strings.NewReader(`{"data":[{"service":""}]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result struct {
		Error      any               `json:"error"`
		Trailers   []json.RawMessage `json:"trailers"`
		LocalLimit *struct {
			Reason             string  `json:"reason"`
			MaxDurationSeconds float64 `json:"maxDurationSeconds"`
		} `json:"localLimit"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != "duration" || result.LocalLimit.MaxDurationSeconds != 0.02 {
		t.Fatalf("configured local wall evidence = %#v", result.LocalLimit)
	}
	if result.Error != nil || len(result.Trailers) != 0 {
		t.Fatalf("configured local wall fabricated final status = error %#v, trailers %#v", result.Error, result.Trailers)
	}
	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("target did not observe configured local-wall cancellation")
	}
}

func TestWorkspaceHandlerConfiguredInvokeWallReturnsLocalLimitEvidence(t *testing.T) {
	t.Parallel()

	const configuredWall = 500 * time.Millisecond
	service := &workspaceWallHealthService{
		started:  make(chan struct{}),
		canceled: make(chan struct{}),
	}
	connection := startHealthGRPCTarget(t, service)
	waitForGRPCConnectionReady(t, connection)
	file, err := desc.LoadFileDescriptor("grpc/health/v1/health.proto")
	if err != nil {
		t.Fatalf("load health descriptor: %v", err)
	}
	method := file.FindService("grpc.health.v1.Health").FindMethodByName("Watch")
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["wall-session"] = &workspaceSession{
		id:      "wall-session",
		cc:      connection,
		methods: []*desc.MethodDescriptor{method},
		files:   []*desc.FileDescriptor{file},
	}
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(
		nil,
		"",
		nil,
		nil,
		WithWorkspaceManager(manager),
		WithInvokeMaxDuration(configuredWall),
	)
	cookie := workspaceUploadCSRFCookie(t, handler)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/workspace/invoke/grpc.health.v1.Health.Watch?session_id=wall-session",
		strings.NewReader(`{"data":[{"service":""}]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var result struct {
		Error      any               `json:"error"`
		Trailers   []json.RawMessage `json:"trailers"`
		LocalLimit *struct {
			Reason             string  `json:"reason"`
			MaxDurationSeconds float64 `json:"maxDurationSeconds"`
		} `json:"localLimit"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != "duration" || result.LocalLimit.MaxDurationSeconds != configuredWall.Seconds() {
		t.Fatalf("workspace configured local wall evidence = %#v", result.LocalLimit)
	}
	if result.Error != nil || len(result.Trailers) != 0 {
		t.Fatalf("workspace configured local wall fabricated final status = error %#v, trailers %#v", result.Error, result.Trailers)
	}
	select {
	case <-service.started:
	default:
		t.Fatal("workspace target did not start before the configured local wall")
	}
	select {
	case <-service.canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("workspace target did not observe configured local-wall cancellation")
	}
}

type workspaceRetentionHealthService struct {
	healthpb.UnimplementedHealthServer
	canceled chan struct{}
	once     sync.Once
}

type workspaceWallHealthService struct {
	healthpb.UnimplementedHealthServer
	started      chan struct{}
	canceled     chan struct{}
	startedOnce  sync.Once
	canceledOnce sync.Once
}

func (s *workspaceWallHealthService) Watch(_ *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	if s.started != nil {
		s.startedOnce.Do(func() { close(s.started) })
	}
	<-stream.Context().Done()
	s.canceledOnce.Do(func() { close(s.canceled) })
	return context.Cause(stream.Context())
}

func waitForGRPCConnectionReady(t *testing.T, connection *grpc.ClientConn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection.Connect()
	for {
		state := connection.GetState()
		if state == connectivity.Ready {
			return
		}
		if !connection.WaitForStateChange(ctx, state) {
			t.Fatalf("gRPC connection did not become ready: %v", context.Cause(ctx))
		}
	}
}

func (s *workspaceRetentionHealthService) Watch(_ *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	for range 513 {
		if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
			s.signalCanceled()
			return err
		}
	}
	<-stream.Context().Done()
	s.signalCanceled()
	return context.Cause(stream.Context())
}

func (s *workspaceRetentionHealthService) signalCanceled() {
	s.once.Do(func() { close(s.canceled) })
}
