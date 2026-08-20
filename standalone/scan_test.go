package standalone

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

func TestValidateScanAddress(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		address      string
		allowPrivate bool
		explicit     bool
		wantErr      bool
	}{
		{name: "localhost", address: "localhost:50051"},
		{name: "localhost absolute hostname denied", address: "localhost.:50051", wantErr: true},
		{name: "ipv4 loopback", address: "127.0.0.1:9090"},
		{name: "ipv6 loopback", address: "[::1]:50051"},
		{name: "private denied by default", address: "192.168.1.20:50051", wantErr: true},
		{name: "private opt in", address: "192.168.1.20:50051", allowPrivate: true},
		{name: "public ambient denied", address: "8.8.8.8:443", wantErr: true},
		{name: "public explicit", address: "8.8.8.8:443", explicit: true},
		{name: "hostname ambient denied", address: "api.example.test:443", wantErr: true},
		{name: "hostname explicit", address: "api.example.test:443", explicit: true},
		{name: "missing port", address: "localhost", wantErr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validateScanAddress(test.address, test.allowPrivate, test.explicit)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateScanAddress(%q, %v, %v) error = %v, wantErr %v", test.address, test.allowPrivate, test.explicit, err, test.wantErr)
			}
		})
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

		result := probeGRPC(context.Background(), scanCandidate{Address: listener.Addr().String(), Transport: "auto"})
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

		result := probeGRPC(context.Background(), scanCandidate{Address: listener.Addr().String(), Transport: "plaintext"})
		if !result.GRPC || result.Reflection != "unavailable" || result.Error == "" {
			t.Fatalf("result = %#v", result)
		}
	})

	t.Run("non gRPC", func(t *testing.T) {
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("plain HTTP"))
		}))
		defer target.Close()
		result := probeGRPC(context.Background(), scanCandidate{Address: target.Listener.Addr().String(), Transport: "plaintext"})
		if result.GRPC || !result.Alive || result.Failure == "" || len(result.Details) == 0 {
			t.Fatalf("result = %#v", result)
		}
	})
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
