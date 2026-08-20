package standalone

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

const (
	admissionDirectInvokePath    = "/invoke/grpc.health.v1.Health.Check"
	admissionWorkspaceInvokePath = "/api/workspace/invoke/grpc.health.v1.Health.Check?session_id=admission-session"
	admissionGRPCBody            = `{"data":[{"service":""}]}`
)

func TestHandlerSharesGRPCAdmissionAcrossDirectAndWorkspaceInvokes(t *testing.T) {
	for _, test := range []struct {
		name         string
		holderPath   string
		rejectedPath string
	}{
		{name: "direct saturates workspace", holderPath: admissionDirectInvokePath, rejectedPath: admissionWorkspaceInvokePath},
		{name: "workspace saturates direct", holderPath: admissionWorkspaceInvokePath, rejectedPath: admissionDirectInvokePath},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newAdmissionGRPCFixture(t)
			holders := startAdmissionRequests(fixture.handler, fixture.cookie, test.holderPath, admissionGRPCBody, maxConcurrentGRPCInvokes)
			for range maxConcurrentGRPCInvokes {
				waitAdmissionSignal(t, fixture.service.started, "held gRPC invocation")
			}

			assertAdmissionPolicyPrecedesCapacity(t, fixture.handler, fixture.cookie, test.rejectedPath)
			body := &admissionUnreadBody{}
			response := performAdmissionRequest(fixture.handler, admissionRequest(fixture.cookie, http.MethodPost, test.rejectedPath, "application/json", body))
			assertAdmissionBusy(t, response, body, "gRPC invocation")

			fixture.service.releaseAll()
			assertAdmissionResponses(t, holders, maxConcurrentGRPCInvokes, http.StatusOK)
			afterRelease := performAdmissionRequest(fixture.handler, admissionRequest(fixture.cookie, http.MethodPost, test.rejectedPath, "application/json", strings.NewReader(admissionGRPCBody)))
			if afterRelease.Code != http.StatusOK {
				t.Fatalf("post-release status = %d, body = %q", afterRelease.Code, afterRelease.Body.String())
			}
		})
	}
}

func TestHandlerWorkspaceSessionDeletionReleasesGRPCAdmission(t *testing.T) {
	fixture := newAdmissionGRPCFixture(t)
	holders := startAdmissionRequests(fixture.handler, fixture.cookie, admissionWorkspaceInvokePath, admissionGRPCBody, maxConcurrentGRPCInvokes)
	for range maxConcurrentGRPCInvokes {
		waitAdmissionSignal(t, fixture.service.started, "held workspace gRPC invocation")
	}

	deleteResponse := performAdmissionRequest(fixture.handler, admissionRequest(
		fixture.cookie,
		http.MethodDelete,
		"/api/workspace/session?session_id=admission-session",
		"",
		nil,
	))
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %q", deleteResponse.Code, deleteResponse.Body.String())
	}
	assertAdmissionResponses(t, holders, maxConcurrentGRPCInvokes, 0)

	directDone := startAdmissionRequests(fixture.handler, fixture.cookie, admissionDirectInvokePath, admissionGRPCBody, 1)
	waitAdmissionSignal(t, fixture.service.started, "direct gRPC invocation after workspace deletion")
	fixture.service.releaseAll()
	assertAdmissionResponses(t, directDone, 1, http.StatusOK)
}

func TestHandlerRejectsSaturatedHTTPRelayBeforeReadingBody(t *testing.T) {
	started := make(chan struct{}, maxConcurrentHTTPRelays+2)
	release := make(chan struct{})
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-release:
			_, _ = w.Write([]byte("ok"))
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(target.Close)

	handler := Handler(nil, "", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	body := `{"url":"` + target.URL + `"}`
	holders := startAdmissionRequests(handler, cookie, "/api/http/request", body, maxConcurrentHTTPRelays)
	for range maxConcurrentHTTPRelays {
		waitAdmissionSignal(t, started, "held HTTP relay")
	}

	assertAdmissionPolicyPrecedesCapacity(t, handler, cookie, "/api/http/request")
	unread := &admissionUnreadBody{}
	response := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/http/request", "application/json", unread))
	assertAdmissionBusy(t, response, unread, "HTTP relay")

	close(release)
	assertAdmissionResponses(t, holders, maxConcurrentHTTPRelays, http.StatusOK)
	afterRelease := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/http/request", "application/json", strings.NewReader(body)))
	if afterRelease.Code != http.StatusOK {
		t.Fatalf("post-release status = %d, body = %q", afterRelease.Code, afterRelease.Body.String())
	}
}

func TestHandlerRejectsSaturatedRouteLookupBeforeReadingBody(t *testing.T) {
	started := make(chan struct{}, maxConcurrentRouteLookups+2)
	release := make(chan struct{})
	routeHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-release:
			w.WriteHeader(http.StatusNoContent)
		case <-r.Context().Done():
		}
	})
	handler := Handler(nil, "", nil, nil, optFunc(func(opts *handlerOptions) {
		opts.routeLookupHandler = routeHandler
	}))
	cookie := workspaceUploadCSRFCookie(t, handler)
	holders := startAdmissionRequests(handler, cookie, "/api/route/lookup", `{"destination":"127.0.0.1"}`, maxConcurrentRouteLookups)
	for range maxConcurrentRouteLookups {
		waitAdmissionSignal(t, started, "held route lookup")
	}

	assertAdmissionPolicyPrecedesCapacity(t, handler, cookie, "/api/route/lookup")
	unread := &admissionUnreadBody{}
	response := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/route/lookup", "application/json", unread))
	assertAdmissionBusy(t, response, unread, "route lookup")

	close(release)
	assertAdmissionResponses(t, holders, maxConcurrentRouteLookups, http.StatusNoContent)
	afterRelease := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/route/lookup", "application/json", strings.NewReader(`{"destination":"127.0.0.1"}`)))
	if afterRelease.Code != http.StatusNoContent {
		t.Fatalf("post-release status = %d, body = %q", afterRelease.Code, afterRelease.Body.String())
	}
}

func TestHandlerAdmissionReleasesAfterValidationErrors(t *testing.T) {
	file, method := admissionHealthDescriptor(t)
	tests := []struct {
		name        string
		handler     http.Handler
		path        string
		contentType string
		body        string
		limit       int
		wantStatus  int
	}{
		{
			name:        "gRPC invoke",
			handler:     Handler(nil, "", []*desc.MethodDescriptor{method}, []*desc.FileDescriptor{file}),
			path:        admissionDirectInvokePath,
			contentType: "text/plain",
			body:        admissionGRPCBody,
			limit:       maxConcurrentGRPCInvokes,
			wantStatus:  http.StatusUnsupportedMediaType,
		},
		{
			name:        "HTTP relay",
			handler:     Handler(nil, "", nil, nil),
			path:        "/api/http/request",
			contentType: "application/json",
			body:        "{",
			limit:       maxConcurrentHTTPRelays,
			wantStatus:  http.StatusBadRequest,
		},
		{
			name:        "route lookup",
			handler:     Handler(nil, "", nil, nil),
			path:        "/api/route/lookup",
			contentType: "application/json",
			body:        "{",
			limit:       maxConcurrentRouteLookups,
			wantStatus:  http.StatusBadRequest,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cookie := workspaceUploadCSRFCookie(t, test.handler)
			for index := 0; index < test.limit+1; index++ {
				response := performAdmissionRequest(test.handler, admissionRequest(cookie, http.MethodPost, test.path, test.contentType, strings.NewReader(test.body)))
				if response.Code != test.wantStatus {
					t.Fatalf("attempt %d status = %d, body = %q", index+1, response.Code, response.Body.String())
				}
			}
		})
	}
}

func TestHandlerHTTPAdmissionReleasesAfterCancellation(t *testing.T) {
	started := make(chan struct{}, maxConcurrentHTTPRelays+2)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/success" {
			_, _ = w.Write([]byte("ok"))
			return
		}
		started <- struct{}{}
		<-r.Context().Done()
	}))
	t.Cleanup(target.Close)

	handler := Handler(nil, "", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	for index := 0; index < maxConcurrentHTTPRelays+1; index++ {
		ctx, cancel := context.WithCancel(context.Background())
		request := admissionRequest(cookie, http.MethodPost, "/api/http/request", "application/json", strings.NewReader(`{"url":"`+target.URL+`/hold"}`)).WithContext(ctx)
		done := make(chan *httptest.ResponseRecorder, 1)
		go func() { done <- performAdmissionRequest(handler, request) }()
		waitAdmissionSignal(t, started, "cancellable HTTP relay")
		cancel()
		response := waitAdmissionResponse(t, done, "cancelled HTTP relay")
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("attempt %d leaked admission slot: body = %q", index+1, response.Body.String())
		}
	}

	success := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/http/request", "application/json", strings.NewReader(`{"url":"`+target.URL+`/success"}`)))
	if success.Code != http.StatusOK {
		t.Fatalf("post-cancellation status = %d, body = %q", success.Code, success.Body.String())
	}
}

func TestHandlerGRPCAdmissionReleaseIsPanicSafe(t *testing.T) {
	file, method := admissionHealthDescriptor(t)
	connection := &admissionPanicClientConn{}
	connection.panics.Store(true)
	handler := Handler(connection, "", []*desc.MethodDescriptor{method}, []*desc.FileDescriptor{file})
	cookie := workspaceUploadCSRFCookie(t, handler)

	for index := 0; index < maxConcurrentGRPCInvokes+1; index++ {
		panicked := false
		func() {
			defer func() {
				panicked = recover() != nil
			}()
			handler.ServeHTTP(
				httptest.NewRecorder(),
				admissionRequest(cookie, http.MethodPost, admissionDirectInvokePath, "application/json", strings.NewReader(admissionGRPCBody)),
			)
		}()
		if !panicked {
			t.Fatalf("attempt %d did not reach the panicking invocation", index+1)
		}
	}

	connection.panics.Store(false)
	afterPanic := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, admissionDirectInvokePath, "application/json", strings.NewReader(admissionGRPCBody)))
	if afterPanic.Code != http.StatusOK {
		t.Fatalf("post-panic status = %d, body = %q", afterPanic.Code, afterPanic.Body.String())
	}
}

type admissionGRPCFixture struct {
	handler http.Handler
	cookie  *http.Cookie
	service *admissionHeldHealthServer
}

func newAdmissionGRPCFixture(t *testing.T) *admissionGRPCFixture {
	t.Helper()
	file, method := admissionHealthDescriptor(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for admission gRPC target: %v", err)
	}
	service := &admissionHeldHealthServer{
		started: make(chan struct{}, maxConcurrentGRPCInvokes*2+4),
		release: make(chan struct{}),
	}
	server := grpc.NewServer()
	healthpb.RegisterHealthServer(server, service)
	serverDone := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(serverDone)
	}()

	newConnection := func() *grpc.ClientConn {
		connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			t.Fatalf("create admission gRPC connection: %v", err)
		}
		return connection
	}
	directConnection := newConnection()
	workspaceConnection := newConnection()
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["admission-session"] = &workspaceSession{
		id:      "admission-session",
		cc:      workspaceConnection,
		methods: []*desc.MethodDescriptor{method},
		files:   []*desc.FileDescriptor{file},
	}
	handler := Handler(
		directConnection,
		listener.Addr().String(),
		[]*desc.MethodDescriptor{method},
		[]*desc.FileDescriptor{file},
		WithWorkspaceManager(manager),
	)
	cookie := workspaceUploadCSRFCookie(t, handler)
	t.Cleanup(func() {
		service.releaseAll()
		_ = manager.Close()
		_ = directConnection.Close()
		server.Stop()
		_ = listener.Close()
		<-serverDone
	})
	return &admissionGRPCFixture{handler: handler, cookie: cookie, service: service}
}

type admissionHeldHealthServer struct {
	healthpb.UnimplementedHealthServer
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (s *admissionHeldHealthServer) Check(ctx context.Context, _ *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	s.started <- struct{}{}
	select {
	case <-s.release:
		return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *admissionHeldHealthServer) releaseAll() {
	s.once.Do(func() { close(s.release) })
}

type admissionPanicClientConn struct {
	panics atomic.Bool
}

func (c *admissionPanicClientConn) Invoke(context.Context, string, any, any, ...grpc.CallOption) error {
	if c.panics.Load() {
		panic("injected admission panic")
	}
	return nil
}

func (*admissionPanicClientConn) NewStream(context.Context, *grpc.StreamDesc, string, ...grpc.CallOption) (grpc.ClientStream, error) {
	panic("unexpected streaming invocation")
}

type admissionUnreadBody struct {
	reads atomic.Int32
}

func (b *admissionUnreadBody) Read([]byte) (int, error) {
	b.reads.Add(1)
	return 0, io.EOF
}

func (*admissionUnreadBody) Close() error { return nil }

func admissionHealthDescriptor(t *testing.T) (*desc.FileDescriptor, *desc.MethodDescriptor) {
	t.Helper()
	file, err := desc.LoadFileDescriptor("grpc/health/v1/health.proto")
	if err != nil {
		t.Fatalf("load health descriptor: %v", err)
	}
	method := file.FindService("grpc.health.v1.Health").FindMethodByName("Check")
	if method == nil {
		t.Fatal("health Check descriptor is missing")
	}
	return file, method
}

func startAdmissionRequests(handler http.Handler, cookie *http.Cookie, path, body string, count int) <-chan *httptest.ResponseRecorder {
	done := make(chan *httptest.ResponseRecorder, count)
	for range count {
		go func() {
			done <- performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, path, "application/json", strings.NewReader(body)))
		}()
	}
	return done
}

func admissionRequest(cookie *http.Cookie, method, path, contentType string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, path, body)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if cookie != nil {
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
	}
	return request
}

func performAdmissionRequest(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertAdmissionPolicyPrecedesCapacity(t *testing.T, handler http.Handler, cookie *http.Cookie, path string) {
	t.Helper()
	wrongMethodBody := &admissionUnreadBody{}
	wrongMethod := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodGet, path, "application/json", wrongMethodBody))
	if wrongMethod.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong-method status = %d, body = %q", wrongMethod.Code, wrongMethod.Body.String())
	}
	if wrongMethodBody.reads.Load() != 0 {
		t.Fatalf("wrong-method body reads = %d, want 0", wrongMethodBody.reads.Load())
	}

	missingCSRFBody := &admissionUnreadBody{}
	missingCSRF := performAdmissionRequest(handler, admissionRequest(nil, http.MethodPost, path, "application/json", missingCSRFBody))
	if missingCSRF.Code != http.StatusUnauthorized {
		t.Fatalf("missing-CSRF status = %d, body = %q", missingCSRF.Code, missingCSRF.Body.String())
	}
	if missingCSRFBody.reads.Load() != 0 {
		t.Fatalf("missing-CSRF body reads = %d, want 0", missingCSRFBody.reads.Load())
	}
}

func assertAdmissionBusy(t *testing.T, response *httptest.ResponseRecorder, body *admissionUnreadBody, operation string) {
	t.Helper()
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("saturated status = %d, body = %q", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if !strings.Contains(response.Body.String(), operation) {
		t.Fatalf("busy body = %q, want operation %q", response.Body.String(), operation)
	}
	if body.reads.Load() != 0 {
		t.Fatalf("saturated body reads = %d, want 0", body.reads.Load())
	}
}

func assertAdmissionResponses(t *testing.T, responses <-chan *httptest.ResponseRecorder, count, wantStatus int) {
	t.Helper()
	for range count {
		response := waitAdmissionResponse(t, responses, "held request completion")
		if wantStatus != 0 && response.Code != wantStatus {
			t.Fatalf("held status = %d, body = %q", response.Code, response.Body.String())
		}
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("admitted request was later reported saturated: body = %q", response.Body.String())
		}
	}
}

func waitAdmissionSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func waitAdmissionResponse(t *testing.T, responses <-chan *httptest.ResponseRecorder, description string) *httptest.ResponseRecorder {
	t.Helper()
	select {
	case response := <-responses:
		return response
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
		return nil
	}
}
