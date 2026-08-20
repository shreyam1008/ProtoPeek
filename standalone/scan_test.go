package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

type scanResolverFunc func(context.Context, string, string) ([]netip.Addr, error)

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
