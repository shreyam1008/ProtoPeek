package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	reflectionpb "google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
)

type scanResolverFunc func(context.Context, string, string) ([]netip.Addr, error)

type blockingScanRequestBody struct {
	context context.Context
	started chan<- struct{}
	once    sync.Once
	reads   atomic.Int32
}

func (body *blockingScanRequestBody) Read([]byte) (int, error) {
	body.reads.Add(1)
	body.once.Do(func() { body.started <- struct{}{} })
	<-body.context.Done()
	return 0, body.context.Err()
}

func (*blockingScanRequestBody) Close() error { return nil }

type boundedScanReflectionService struct {
	reflectionpb.UnimplementedServerReflectionServer
	services []string
	err      error
	header   metadata.MD
}

func (service *boundedScanReflectionService) ServerReflectionInfo(stream grpc.BidiStreamingServer[reflectionpb.ServerReflectionRequest, reflectionpb.ServerReflectionResponse]) error {
	request, err := stream.Recv()
	if err != nil {
		return err
	}
	if service.err != nil {
		return service.err
	}
	if service.header != nil {
		if err := stream.SendHeader(service.header); err != nil {
			return err
		}
	}
	services := make([]*reflectionpb.ServiceResponse, 0, len(service.services))
	for _, name := range service.services {
		services = append(services, &reflectionpb.ServiceResponse{Name: name})
	}
	return stream.Send(&reflectionpb.ServerReflectionResponse{
		OriginalRequest: request,
		MessageResponse: &reflectionpb.ServerReflectionResponse_ListServicesResponse{
			ListServicesResponse: &reflectionpb.ListServiceResponse{Service: services},
		},
	})
}

func (function scanResolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return function(ctx, network, host)
}

func TestPrepareScanCandidateAddressPolicy(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		address      string
		resolved     []netip.Addr
		allowPrivate bool
		explicit     bool
		wantErr      bool
		wantDial     string
	}{
		{name: "localhost", address: "localhost:50051", resolved: []netip.Addr{netip.MustParseAddr("::1")}, wantDial: "[::1]:50051"},
		{name: "localhost must stay loopback", address: "localhost:50051", resolved: []netip.Addr{netip.MustParseAddr("203.0.113.8")}, wantErr: true},
		{name: "localhost absolute hostname denied", address: "localhost.:50051", wantErr: true},
		{name: "ipv4 loopback", address: "127.0.0.1:9090", wantDial: "127.0.0.1:9090"},
		{name: "ipv6 loopback", address: "[::1]:50051", wantDial: "[::1]:50051"},
		{name: "private denied by default", address: "192.168.1.20:50051", wantErr: true},
		{name: "private opt in", address: "192.168.1.20:50051", allowPrivate: true, wantDial: "192.168.1.20:50051"},
		{name: "public ambient denied", address: "8.8.8.8:443", wantErr: true},
		{name: "public explicit", address: "8.8.8.8:443", explicit: true, wantDial: "8.8.8.8:443"},
		{name: "hostname ambient denied", address: "api.example.test:443", wantErr: true},
		{name: "hostname explicit", address: "api.example.test:443", resolved: []netip.Addr{netip.MustParseAddr("203.0.113.9")}, explicit: true, wantDial: "203.0.113.9:443"},
		{name: "hostname private denied", address: "internal.example.test:443", resolved: []netip.Addr{netip.MustParseAddr("10.0.0.8")}, explicit: true, wantErr: true},
		{name: "hostname private opt in", address: "internal.example.test:443", resolved: []netip.Addr{netip.MustParseAddr("10.0.0.8")}, explicit: true, allowPrivate: true, wantDial: "10.0.0.8:443"},
		{name: "mixed public private fails closed", address: "mixed.example.test:443", resolved: []netip.Addr{netip.MustParseAddr("203.0.113.9"), netip.MustParseAddr("10.0.0.8")}, explicit: true, wantErr: true},
		{name: "multicast denied", address: "224.0.0.1:443", explicit: true, wantErr: true},
		{name: "link local needs private opt in", address: "169.254.169.254:80", explicit: true, wantErr: true},
		{name: "missing port", address: "localhost", wantErr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			resolver := scanResolverFunc(func(_ context.Context, network, _ string) ([]netip.Addr, error) {
				if network != "ip" {
					t.Fatalf("network = %q", network)
				}
				return test.resolved, nil
			})
			candidate, err := prepareScanCandidate(
				context.Background(),
				resolver,
				scanCandidate{Address: test.address},
				test.allowPrivate,
				test.explicit,
			)
			if (err != nil) != test.wantErr {
				t.Fatalf("prepareScanCandidate(%q, %v, %v) error = %v, wantErr %v", test.address, test.allowPrivate, test.explicit, err, test.wantErr)
			}
			if !test.wantErr && candidate.DialAddress != test.wantDial {
				t.Fatalf("dial address = %q, want %q", candidate.DialAddress, test.wantDial)
			}
		})
	}
}

func TestHTTPProbeDialsValidatedAddressAndPreservesOriginalHost(t *testing.T) {
	t.Parallel()
	hostSeen := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostSeen <- r.Host
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split fixture address: %v", err)
	}
	candidate := scanCandidate{
		Address:     net.JoinHostPort("service.example.test", port),
		DialAddress: server.Listener.Addr().String(),
		ServerName:  "service.example.test",
		Transport:   "plaintext",
	}
	result := probeHTTPResolvedTransport(context.Background(), candidate, "plaintext")
	if !result.Detected || result.StatusCode != http.StatusNoContent {
		t.Fatalf("HTTP result = %#v", result)
	}
	host := <-hostSeen
	if !strings.HasPrefix(host, "service.example.test:") {
		t.Fatalf("Host = %q, want original hostname", host)
	}
}

func TestExpandScanInputUsesBoundedVisibleCandidates(t *testing.T) {
	t.Parallel()

	candidates, err := expandScanInput("example.test")
	if err != nil {
		t.Fatalf("expand host: %v", err)
	}
	if len(candidates) != 2 || candidates[0].Address != "example.test:50051" || candidates[1].Address != "example.test:443" {
		t.Fatalf("host candidates = %#v", candidates)
	}
	httpsCandidates, err := expandScanInput("HTTPS://example.test")
	if err != nil {
		t.Fatalf("expand URL: %v", err)
	}
	if len(httpsCandidates) != 1 || httpsCandidates[0].Address != "example.test:443" || httpsCandidates[0].Transport != "tls" {
		t.Fatalf("HTTPS candidates = %#v", httpsCandidates)
	}
}

func TestExplicitScanRejectsMultipleTargets(t *testing.T) {
	t.Parallel()
	_, err := scanCandidates(ScanRequest{
		Addresses: []string{"8.8.8.8:443", "1.1.1.1:443"},
		Explicit:  true,
	})
	if err == nil {
		t.Fatal("multiple explicit targets unexpectedly accepted")
	}
}

func TestScanCandidatePolicyRejectsHiddenExpansion(t *testing.T) {
	t.Parallel()

	tooMany := make([]string, maxScanInputs+1)
	for index := range tooMany {
		tooMany[index] = "localhost:50051"
	}
	if _, err := scanCandidates(ScanRequest{Addresses: tooMany}); err == nil {
		t.Fatal("oversized ambient input list unexpectedly accepted")
	}
	if _, err := scanCandidates(ScanRequest{Explicit: true}); err == nil {
		t.Fatal("empty explicit scan unexpectedly accepted")
	}
	for _, input := range []string{
		"https://example.test/path",
		"https://example.test/?token=secret",
		"example.test with-space",
	} {
		if _, err := expandScanInput(input); err == nil {
			t.Fatalf("input %q unexpectedly accepted", input)
		}
	}
}

func TestProbeGRPCReportsReflectionAndTransportTruthfully(t *testing.T) {
	t.Parallel()

	t.Run("reflection available", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		server := grpc.NewServer()
		reflection.Register(server)
		go func() { _ = server.Serve(listener) }()
		defer server.Stop()

		result := probeCandidate(context.Background(), scanCandidate{Address: listener.Addr().String(), Transport: "auto"})
		if !result.GRPC || result.Reflection != "available" || result.Transport != "plaintext" {
			t.Fatalf("result = %#v", result)
		}
	})

	t.Run("reflection unavailable", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		server := grpc.NewServer()
		go func() { _ = server.Serve(listener) }()
		defer server.Stop()

		result := probeCandidate(context.Background(), scanCandidate{Address: listener.Addr().String(), Transport: "plaintext"})
		if !result.GRPC || result.Reflection != "unavailable" || result.Error == "" {
			t.Fatalf("result = %#v", result)
		}
	})

	t.Run("non gRPC", func(t *testing.T) {
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("plain HTTP"))
		}))
		defer target.Close()
		result := probeCandidate(context.Background(), scanCandidate{Address: target.Listener.Addr().String(), Transport: "plaintext"})
		if result.GRPC || !result.Alive || !result.TCP || !result.HTTP || result.HTTPProtocol != "HTTP/1.1" || len(result.Details) == 0 {
			t.Fatalf("result = %#v", result)
		}
	})

	t.Run("open TCP only", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		done := make(chan struct{})
		connections := make(chan net.Conn, 8)
		go func() {
			defer close(done)
			for {
				conn, acceptErr := listener.Accept()
				if acceptErr != nil {
					return
				}
				connections <- conn
			}
		}()

		result := probeCandidate(context.Background(), scanCandidate{Address: listener.Addr().String(), Transport: "plaintext"})
		_ = listener.Close()
		<-done
		close(connections)
		for conn := range connections {
			_ = conn.Close()
		}
		if !result.Alive || !result.TCP || result.GRPC || result.HTTP || len(result.Protocols) != 1 || result.Protocols[0] != "tcp" {
			t.Fatalf("result = %#v", result)
		}
	})
}

func TestScanHandlerReportsMultiProtocolResultsWithoutFollowingRedirects(t *testing.T) {
	t.Parallel()

	grpcListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for gRPC: %v", err)
	}
	grpcServer := grpc.NewServer()
	reflection.Register(grpcServer)
	go func() { _ = grpcServer.Serve(grpcListener) }()
	defer grpcServer.Stop()

	var redirected atomic.Bool
	var sawHead atomic.Bool
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/changed" {
			redirected.Store(true)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodHead {
			sawHead.Store(true)
		}
		if r.Method != http.MethodHead && r.Method != "PRI" {
			t.Errorf("scan used unexpected method %s", r.Method)
		}
		w.Header().Set("Location", "/changed")
		w.Header().Set("Server", "scan-fixture")
		w.WriteHeader(http.StatusFound)
	}))
	defer httpServer.Close()

	body, err := json.Marshal(ScanRequest{
		Addresses: []string{grpcListener.Addr().String(), httpServer.URL},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/scan", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	ScanHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", response.Header())
	}

	var results []ScanResult
	if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode results: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %#v", results)
	}
	if !results[0].GRPC || !results[0].TCP || results[0].Reflection != "available" {
		t.Fatalf("gRPC result = %#v", results[0])
	}
	if !results[1].HTTP || !results[1].TCP || results[1].HTTPStatusCode != http.StatusFound || results[1].HTTPServer != "scan-fixture" {
		t.Fatalf("HTTP result = %#v", results[1])
	}
	if redirected.Load() {
		t.Fatal("scan followed an HTTP redirect")
	}
	if !sawHead.Load() {
		t.Fatal("scan did not make its bounded HEAD request")
	}
}

func TestScanHandlerRejectsSaturationBeforeBodyReadAndReleasesEveryExit(t *testing.T) {
	t.Parallel()

	handler := ScanHandler()
	started := make(chan struct{}, 2)
	done := make(chan *httptest.ResponseRecorder, 2)
	cancels := make([]context.CancelFunc, 0, 2)
	for index := 0; index < 2; index++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		body := &blockingScanRequestBody{context: ctx, started: started}
		request := httptest.NewRequest(http.MethodPost, "/api/scan", body).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		go func() {
			handler.ServeHTTP(response, request)
			done <- response
		}()
	}
	for index := 0; index < 2; index++ {
		waitHealthSignal(t, started, "active scan request")
	}

	blockedBody := &countingReadCloser{reader: strings.NewReader("not-json")}
	blockedRequest := httptest.NewRequest(http.MethodPost, "/api/scan", blockedBody)
	blockedRequest.Header.Set("Content-Type", "application/json")
	blockedResponse := httptest.NewRecorder()
	handler.ServeHTTP(blockedResponse, blockedRequest)
	if blockedResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("saturated status = %d, body = %q", blockedResponse.Code, blockedResponse.Body.String())
	}
	if blockedResponse.Header().Get("Retry-After") == "" {
		t.Fatal("saturated response omitted Retry-After")
	}
	if blockedBody.reads != 0 {
		t.Fatalf("saturated request body reads = %d, want 0", blockedBody.reads)
	}

	for _, cancel := range cancels {
		cancel()
	}
	for index := 0; index < 2; index++ {
		waitHealthSignal(t, done, "canceled scan completion")
	}
	for index := 0; index < 3; index++ {
		request := httptest.NewRequest(http.MethodPost, "/api/scan", strings.NewReader("not-json"))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid request %d status = %d, body = %q", index, response.Code, response.Body.String())
		}
	}
	for index := 0; index < 3; index++ {
		request := httptest.NewRequest(http.MethodPost, "/api/scan", strings.NewReader(`{"addresses":[]}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("successful request %d status = %d, body = %q", index, response.Code, response.Body.String())
		}
	}
}

func TestStandaloneScanCSRFPrecedesSharedLimiterAndBodyRead(t *testing.T) {
	t.Parallel()

	handler := Handler(nil, "scan-target", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	for index := 0; index < 3; index++ {
		body := &countingReadCloser{reader: strings.NewReader("not-json")}
		request := httptest.NewRequest(http.MethodPost, "/api/scan", body)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized || body.reads != 0 {
			t.Fatalf("invalid CSRF request %d: status=%d reads=%d", index, response.Code, body.reads)
		}
	}

	started := make(chan struct{}, 2)
	done := make(chan struct{}, 2)
	cancels := make([]context.CancelFunc, 0, 2)
	for index := 0; index < 2; index++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		body := &blockingScanRequestBody{context: ctx, started: started}
		request := httptest.NewRequest(http.MethodPost, "/api/scan", body).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		go func() {
			handler.ServeHTTP(response, request)
			done <- struct{}{}
		}()
	}
	for index := 0; index < 2; index++ {
		waitHealthSignal(t, started, "active standalone scan request")
	}
	invalidCSRFBody := &countingReadCloser{reader: strings.NewReader("not-json")}
	invalidCSRFRequest := httptest.NewRequest(http.MethodPost, "/api/scan", invalidCSRFBody)
	invalidCSRFRequest.Header.Set("Content-Type", "application/json")
	invalidCSRFResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidCSRFResponse, invalidCSRFRequest)
	if invalidCSRFResponse.Code != http.StatusUnauthorized || invalidCSRFBody.reads != 0 {
		t.Fatalf("saturated invalid CSRF request: status=%d reads=%d", invalidCSRFResponse.Code, invalidCSRFBody.reads)
	}

	blockedBody := &countingReadCloser{reader: strings.NewReader("not-json")}
	blockedRequest := httptest.NewRequest(http.MethodPost, "/api/scan", blockedBody)
	blockedRequest.Header.Set("Content-Type", "application/json")
	blockedRequest.Header.Set(csrfHeaderName, cookie.Value)
	blockedRequest.AddCookie(cookie)
	blockedResponse := httptest.NewRecorder()
	handler.ServeHTTP(blockedResponse, blockedRequest)
	if blockedResponse.Code != http.StatusServiceUnavailable || blockedBody.reads != 0 {
		t.Fatalf("shared limiter response: status=%d reads=%d body=%q", blockedResponse.Code, blockedBody.reads, blockedResponse.Body.String())
	}

	for _, cancel := range cancels {
		cancel()
	}
	for index := 0; index < 2; index++ {
		waitHealthSignal(t, done, "standalone scan cancellation")
	}
}

func TestScanHandlerBoundsReflectionServicesAndDetailsAtThePublicSeam(t *testing.T) {
	t.Parallel()

	t.Run("services", func(t *testing.T) {
		services := make([]string, 0, 34)
		services = append(services, strings.Repeat("a", maxScanServiceBytes))
		services = append(services, strings.Repeat("b", maxScanServiceBytes+1))
		for index := 1; index < maxScanServiceAggregateBytes/maxScanServiceBytes; index++ {
			prefix := fmt.Sprintf("service-%02d.", index)
			services = append(services, prefix+strings.Repeat("s", maxScanServiceBytes-len(prefix)))
		}
		services = append(services, "one.more.Service")

		result := scanReflectionFixture(t, &boundedScanReflectionService{services: services})
		if !result.GRPC || result.Reflection != "available" {
			t.Fatalf("reflection result = %#v", result)
		}
		if !result.ServicesTruncated {
			t.Fatal("bounded service evidence omitted servicesTruncated")
		}
		if len(result.Services) != maxScanServiceAggregateBytes/maxScanServiceBytes {
			t.Fatalf("retained services = %d, want %d", len(result.Services), maxScanServiceAggregateBytes/maxScanServiceBytes)
		}
		serviceBytes := 0
		for _, service := range result.Services {
			if !utf8.ValidString(service) || len(service) > maxScanServiceBytes {
				t.Fatalf("unbounded service evidence: %q (%d bytes)", service, len(service))
			}
			serviceBytes += len(service)
		}
		if serviceBytes != maxScanServiceAggregateBytes {
			t.Fatalf("retained service bytes = %d, want exact cap %d", serviceBytes, maxScanServiceAggregateBytes)
		}
	})

	t.Run("details", func(t *testing.T) {
		result := scanReflectionFixture(t, &boundedScanReflectionService{
			err: status.Error(codes.Internal, strings.Repeat("d", maxScanDetailsBytes+1)),
		})
		if !result.DetailsTruncated {
			t.Fatal("bounded detail evidence omitted detailsTruncated")
		}
		detailBytes := 0
		for _, detail := range result.Details {
			if !utf8.ValidString(detail) {
				t.Fatalf("detail is not valid UTF-8: %q", detail)
			}
			detailBytes += len(detail)
		}
		if detailBytes != maxScanDetailsBytes {
			t.Fatalf("retained detail bytes = %d, want exact cap %d", detailBytes, maxScanDetailsBytes)
		}
	})

	t.Run("reflection response over receive cap", func(t *testing.T) {
		result := scanReflectionFixture(t, &boundedScanReflectionService{
			services: []string{strings.Repeat("oversized", maxScanGRPCResponseBytes/len("oversized")+1)},
		})
		if !result.GRPC {
			t.Fatalf("bounded reflection response lost verified gRPC evidence: %#v", result)
		}
		if result.Reflection != "available" || !result.ServicesTruncated || len(result.Services) != 0 {
			t.Fatalf("oversized reflection evidence = %#v", result)
		}
	})

	t.Run("reflection metadata over header cap", func(t *testing.T) {
		result := scanReflectionFixture(t, &boundedScanReflectionService{
			services: []string{"small.Service"},
			header:   metadata.Pairs("x-oversized", strings.Repeat("h", maxScanGRPCHeaderBytes+1)),
		})
		if result.GRPC || result.Failure != "indeterminate" || result.Reflection != "not-checked" {
			t.Fatalf("ambiguous HTTP/2 reset was overclaimed as gRPC evidence: %#v", result)
		}
		detailBytes := 0
		for _, detail := range result.Details {
			detailBytes += len(detail)
		}
		if detailBytes > maxScanDetailsBytes {
			t.Fatalf("header-cap detail bytes = %d, limit %d", detailBytes, maxScanDetailsBytes)
		}
	})
}

func TestScanHandlerBoundsHTTPAndResultStringsTruthfully(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Server", strings.Repeat("界", maxScanHTTPServerBytes))
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	request := httptest.NewRequest(http.MethodPost, "/api/scan", strings.NewReader(`{"addresses":["`+target.URL+`"]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	ScanHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var results []ScanResult
	if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(results) != 1 || !results[0].HTTP {
		t.Fatalf("results = %#v", results)
	}
	if !results[0].HTTPServerTruncated || len(results[0].HTTPServer) > maxScanHTTPServerBytes || !utf8.ValidString(results[0].HTTPServer) {
		t.Fatalf("HTTP Server evidence = %q (%d bytes), truncated=%v", results[0].HTTPServer, len(results[0].HTTPServer), results[0].HTTPServerTruncated)
	}

	bounded := boundScanResult(ScanResult{
		Error:        strings.Repeat("e", maxScanErrorBytes+1),
		HTTPProtocol: strings.Repeat("p", maxScanHTTPProtocolBytes+1),
		HTTPStatus:   strings.Repeat("s", maxScanHTTPStatusBytes+1),
		HTTPServer:   strings.Repeat("h", maxScanHTTPServerBytes+1),
		Details: []string{
			strings.Repeat("d", maxScanDetailsBytes),
			"overflow",
		},
		Services: []string{
			strings.Repeat("v", maxScanServiceBytes),
			strings.Repeat("x", maxScanServiceBytes+1),
		},
	})
	if len(bounded.Error) != maxScanErrorBytes || !bounded.ErrorTruncated {
		t.Fatalf("Error cap = %d, truncated=%v", len(bounded.Error), bounded.ErrorTruncated)
	}
	if len(bounded.HTTPProtocol) != maxScanHTTPProtocolBytes || !bounded.HTTPProtocolTruncated {
		t.Fatalf("HTTP protocol cap = %d, truncated=%v", len(bounded.HTTPProtocol), bounded.HTTPProtocolTruncated)
	}
	if len(bounded.HTTPStatus) != maxScanHTTPStatusBytes || !bounded.HTTPStatusTruncated {
		t.Fatalf("HTTP status cap = %d, truncated=%v", len(bounded.HTTPStatus), bounded.HTTPStatusTruncated)
	}
	if len(bounded.HTTPServer) != maxScanHTTPServerBytes || !bounded.HTTPServerTruncated {
		t.Fatalf("HTTP Server cap = %d, truncated=%v", len(bounded.HTTPServer), bounded.HTTPServerTruncated)
	}
	if len(bounded.Details) != 1 || len(bounded.Details[0]) != maxScanDetailsBytes || !bounded.DetailsTruncated {
		t.Fatalf("Details = %#v, truncated=%v", bounded.Details, bounded.DetailsTruncated)
	}
	if len(bounded.Services) != 1 || len(bounded.Services[0]) != maxScanServiceBytes || !bounded.ServicesTruncated {
		t.Fatalf("Services = %#v, truncated=%v", bounded.Services, bounded.ServicesTruncated)
	}
	tooManyServices := make([]string, maxScanServices+1)
	for index := range tooManyServices {
		tooManyServices[index] = fmt.Sprintf("service-%02d", index)
	}
	bounded = boundScanResult(ScanResult{Services: tooManyServices, HTTPServer: string([]byte{0xff})})
	if len(bounded.Services) != maxScanServices || !bounded.ServicesTruncated {
		t.Fatalf("service count = %d, truncated=%v", len(bounded.Services), bounded.ServicesTruncated)
	}
	if !utf8.ValidString(bounded.HTTPServer) || !bounded.HTTPServerTruncated {
		t.Fatalf("invalid UTF-8 HTTP Server was not repaired truthfully: %q, truncated=%v", bounded.HTTPServer, bounded.HTTPServerTruncated)
	}
}

func TestScanHandlerRejectsOversizedAddressWithoutEcho(t *testing.T) {
	t.Parallel()

	address := strings.Repeat("secret-host", maxScanAddressBytes/len("secret-host")+2)
	request := httptest.NewRequest(http.MethodPost, "/api/scan", strings.NewReader(`{"addresses":["`+address+`"],"explicit":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	ScanHandler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), address) || len(response.Body.String()) > maxScanAddressBytes {
		t.Fatalf("oversized address leaked into response: %q", response.Body.String())
	}
}

func TestMergeHTTPProbeAttemptPreservesCumulativeTruncation(t *testing.T) {
	t.Parallel()

	result := httpProbeResult{Details: make([]string, 0, 2)}
	if mergeHTTPProbeAttempt(&result, httpProbeResult{Details: []string{strings.Repeat("x", maxScanDetailsBytes+1)}}) {
		t.Fatal("failed attempt unexpectedly completed the probe")
	}
	if !mergeHTTPProbeAttempt(&result, httpProbeResult{Detected: true, Details: []string{"tls succeeded"}}) {
		t.Fatal("detected attempt did not complete the probe")
	}
	if !result.DetailsTruncated {
		t.Fatal("detected attempt lost truncation from the prior transport")
	}
	detailBytes := 0
	for _, detail := range result.Details {
		detailBytes += len(detail)
	}
	if detailBytes != maxScanDetailsBytes {
		t.Fatalf("retained detail bytes = %d, want %d", detailBytes, maxScanDetailsBytes)
	}
}

func scanReflectionFixture(t *testing.T, service reflectionpb.ServerReflectionServer) ScanResult {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	reflectionpb.RegisterServerReflectionServer(server, service)
	done := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(done)
	}()
	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
		<-done
	})

	request := httptest.NewRequest(http.MethodPost, "/api/scan", strings.NewReader(`{"addresses":["http://`+listener.Addr().String()+`"]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	ScanHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var results []ScanResult
	if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %#v", results)
	}
	return results[0]
}

func TestScanHandlerHonorsRequestCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	body := bytes.NewBufferString(`{"addresses":["127.0.0.1:50051"]}`)
	request := httptest.NewRequest(http.MethodPost, "/api/scan", body).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	ScanHandler().ServeHTTP(response, request)

	var results []ScanResult
	if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode results: %v", err)
	}
	if len(results) != 1 || results[0].Failure != "cancelled" {
		t.Fatalf("results = %#v", results)
	}
}

func TestProbeFailureClassificationNeverConfirmsGRPC(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name    string
		err     error
		failure string
	}{
		{name: "unavailable", err: status.Error(codes.Unavailable, "transport unavailable"), failure: "indeterminate"},
		{name: "deadline", err: context.DeadlineExceeded, failure: "timeout"},
		{name: "cancelled", err: context.Canceled, failure: "cancelled"},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			failure, _ := classifyProbeFailure(context.Background(), test.err)
			if failure != test.failure {
				t.Fatalf("failure = %q, want %q", failure, test.failure)
			}
			if isVerifiedGRPCStatus(test.err) {
				t.Fatalf("%v unexpectedly proved gRPC", test.err)
			}
		})
	}

	for _, code := range []codes.Code{codes.Unimplemented, codes.PermissionDenied, codes.Unauthenticated} {
		if !isVerifiedGRPCStatus(status.Error(code, "reflection unavailable")) {
			t.Fatalf("status %s should prove a gRPC response", code)
		}
	}
}

func TestProbeGRPCTransportTimesOutIndeterminately(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- conn
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	result := probeGRPCTransport(ctx, listener.Addr().String(), "plaintext")
	if result.GRPC || result.Failure != "timeout" {
		t.Fatalf("result = %#v", result)
	}
	select {
	case conn := <-accepted:
		_ = conn.Close()
	case <-time.After(time.Second):
		t.Fatal("probe did not establish the TCP fixture connection")
	}
}
