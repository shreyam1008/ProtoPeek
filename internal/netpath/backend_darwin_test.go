//go:build darwin

package netpath

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"
)

func darwinTestConfig() TraceConfig {
	return TraceConfig{Method: "icmp", DestinationPort: 33434, MaxHops: 2, ProbesPerHop: 1, PerProbeTimeout: 500 * time.Millisecond, WallTimeout: 2 * time.Second}
}

func TestNativeDarwinEchoReachesIPv4AndIPv6Loopback(t *testing.T) {
	backend := darwinBackend{}
	for _, address := range []string{"127.0.0.1", "::1"} {
		t.Run(address, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			config := darwinTestConfig()
			result, err := backend.Trace(ctx, Target{Address: netip.MustParseAddr(address), Port: config.DestinationPort}, config)
			if err != nil {
				t.Fatal(err)
			}
			if !result.Reached || result.Termination != "reached" || len(result.Hops) != 1 || result.Hops[0].Samples[0].Responder != address || result.Hops[0].Samples[0].RTTMillis == nil {
				t.Fatalf("native %s loopback evidence: %+v", address, result)
			}
			if err := validateBackendResult(result, Capability{Backend: darwinBackendName}, config); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestNativeDarwinCancellationClosesOwnedEndpoint(t *testing.T) {
	connection, err := openDarwinEcho(false)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	ctx, cancel := context.WithCancel(context.Background())
	stop := context.AfterFunc(ctx, func() { connection.Close() })
	defer stop()
	done := make(chan error, 1)
	started := make(chan struct{})
	go func() { close(started); _, _, err := connection.ReadFrom(make([]byte, 2048)); done <- err }()
	<-started
	start := time.Now()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("native cancellation did not close owned endpoint: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("native read did not unblock promptly on cancellation")
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("native cancellation exceeded bound")
	}
	if _, err := (darwinBackend{}).Trace(ctx, Target{Address: netip.MustParseAddr("127.0.0.1")}, darwinTestConfig()); !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-cancelled trace opened a new endpoint: %v", err)
	}
}

func TestDarwinTraceRejectsUnboundedOrUnsupportedInputs(t *testing.T) {
	target := Target{Address: netip.MustParseAddr("127.0.0.1")}
	for _, config := range []TraceConfig{{Method: "udp"}, {Method: "icmp", MaxHops: 999}, {Method: "icmp", MaxHops: 2, ProbesPerHop: 1, PerProbeTimeout: time.Hour, WallTimeout: 2 * time.Second}} {
		if err := validateDarwinTrace(target, config); err == nil {
			t.Fatal("invalid direct native configuration accepted")
		}
	}
	capabilities := (darwinBackend{}).Capabilities(context.Background())
	if len(capabilities) != 4 || !capabilities[0].Available || !capabilities[1].Available || capabilities[2].Available || capabilities[3].Available {
		t.Fatalf("native capabilities: %+v", capabilities)
	}
}
