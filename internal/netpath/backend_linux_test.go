//go:build linux

package netpath_test

import (
	"context"
	"net"
	"net/netip"
	"slices"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/netpath"
)

func TestNativeLinuxBackendReachesClosedLoopbackUDPPort(t *testing.T) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("reserve loopback UDP port: %v", err)
	}
	port := listener.LocalAddr().(*net.UDPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("close reserved UDP port: %v", err)
	}

	backend := netpath.NewNativeBackend()
	capabilities := backend.Capabilities(context.Background())
	var udp4Available bool
	for _, capability := range capabilities {
		if capability.Method == "udp" && capability.Available && slices.Contains(capability.Families, "ipv4") {
			udp4Available = true
		}
	}
	if !udp4Available {
		t.Skipf("Linux UDP error-queue capability unavailable: %#v", capabilities)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := backend.Trace(ctx, netpath.Target{
		Address: netip.MustParseAddr("127.0.0.1"),
		Port:    port,
	}, netpath.TraceConfig{
		Method:          "udp",
		DestinationPort: port,
		MaxHops:         1,
		ProbesPerHop:    3,
		PerProbeTimeout: 500 * time.Millisecond,
		WallTimeout:     3 * time.Second,
	})
	if err != nil {
		t.Fatalf("Trace() error = %v", err)
	}
	if result.Backend != "linux-udp-error-queue" || result.Method != "udp" {
		t.Fatalf("backend evidence = %q/%q", result.Backend, result.Method)
	}
	if !result.Reached || result.Termination != "reached" {
		t.Fatalf("completion = reached %t, termination %q, hops %#v", result.Reached, result.Termination, result.Hops)
	}
	if len(result.Hops) != 1 || len(result.Hops[0].Samples) != 3 {
		t.Fatalf("hops = %#v", result.Hops)
	}
	if !slices.Contains(result.Hops[0].Responders, "127.0.0.1") {
		t.Fatalf("responders = %#v", result.Hops[0].Responders)
	}
	for _, sample := range result.Hops[0].Samples {
		if sample.Status != "reply" || sample.Responder != "127.0.0.1" || sample.RTTMillis == nil {
			t.Fatalf("sample = %#v", sample)
		}
	}
}

func TestNativeLinuxBackendReachesClosedIPv6LoopbackUDPPort(t *testing.T) {
	listener, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.ParseIP("::1")})
	if err != nil {
		t.Skipf("IPv6 loopback unavailable: %v", err)
	}
	port := listener.LocalAddr().(*net.UDPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("close reserved UDP port: %v", err)
	}

	backend := netpath.NewNativeBackend()
	capabilities := backend.Capabilities(context.Background())
	var udp6Available bool
	for _, capability := range capabilities {
		if capability.Method == "udp" && capability.Available && slices.Contains(capability.Families, "ipv6") {
			udp6Available = true
		}
	}
	if !udp6Available {
		t.Skipf("Linux IPv6 UDP error-queue capability unavailable: %#v", capabilities)
	}

	result, err := backend.Trace(context.Background(), netpath.Target{
		Address: netip.MustParseAddr("::1"),
		Port:    port,
	}, netpath.TraceConfig{
		Method:          "udp",
		DestinationPort: port,
		MaxHops:         1,
		ProbesPerHop:    1,
		PerProbeTimeout: 500 * time.Millisecond,
		WallTimeout:     2 * time.Second,
	})
	if err != nil {
		t.Fatalf("Trace() error = %v", err)
	}
	if !result.Reached || len(result.Hops) != 1 || len(result.Hops[0].Samples) != 1 {
		t.Fatalf("result = %#v", result)
	}
	sample := result.Hops[0].Samples[0]
	if sample.Status != "reply" || sample.Responder != "::1" || sample.RTTMillis == nil {
		t.Fatalf("sample = %#v", sample)
	}
}

func TestNativeLinuxBackendCancelsWhileWaitingForAReply(t *testing.T) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("listen on loopback UDP: %v", err)
	}
	defer listener.Close()
	port := listener.LocalAddr().(*net.UDPAddr).Port

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type outcome struct {
		result netpath.BackendResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := netpath.NewNativeBackend().Trace(ctx, netpath.Target{
			Address: netip.MustParseAddr("127.0.0.1"),
			Port:    port,
		}, netpath.TraceConfig{
			Method:          "udp",
			DestinationPort: port,
			MaxHops:         1,
			ProbesPerHop:    1,
			PerProbeTimeout: 2 * time.Second,
			WallTimeout:     3 * time.Second,
		})
		done <- outcome{result: result, err: err}
	}()
	if err := listener.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	payload := make([]byte, 64)
	if _, _, err := listener.ReadFromUDP(payload); err != nil {
		t.Fatalf("wait for path probe: %v", err)
	}
	cancel()
	select {
	case observed := <-done:
		if observed.err != nil {
			t.Fatalf("Trace() error = %v", observed.err)
		}
		if observed.result.Termination != "cancelled" || observed.result.Reached {
			t.Fatalf("result = %#v", observed.result)
		}
	case <-time.After(time.Second):
		t.Fatal("trace did not release after cancellation")
	}
}
