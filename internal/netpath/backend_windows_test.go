//go:build windows

package netpath

import (
	"context"
	"encoding/binary"
	"errors"
	"net/netip"
	"testing"
	"time"
)

func windowsTestConfig() TraceConfig {
	return TraceConfig{Method: "icmp", DestinationPort: 33434, MaxHops: 3, ProbesPerHop: 1, PerProbeTimeout: 100 * time.Millisecond, WallTimeout: time.Second}
}

func TestWindowsNativeLoopback(t *testing.T) {
	backend := windowsBackend{}
	capability := backend.Capabilities(context.Background())[0]
	if !capability.Available {
		t.Fatalf("native ICMP unavailable: %s", capability.Reason)
	}
	target := Target{Address: netip.MustParseAddr("127.0.0.1"), Port: 33434}
	result, err := backend.Trace(context.Background(), target, windowsTestConfig())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Reached || len(result.Hops) != 1 || result.Hops[0].Responders[0] != "127.0.0.1" {
		t.Fatalf("loopback: %+v", result)
	}
	if err := validateBackendResult(result, capability, windowsTestConfig()); err != nil {
		t.Fatal(err)
	}
	t.Logf("Native Windows ICMP reached loopback at TTL 1: %+v", result.Hops[0].Samples[0])
}

func TestWindowsReplyDecoding(t *testing.T) {
	raw := make([]byte, 512)
	copy(raw, []byte{10, 0, 0, 1})
	binary.LittleEndian.PutUint32(raw[4:], ipTTLExpiredTransit)
	binary.LittleEndian.PutUint32(raw[8:], 17)
	reply, err := decodeWindowsEchoReply(raw)
	if err != nil {
		t.Fatal(err)
	}
	sample, end := windowsReplySample(reply, netip.MustParseAddr("1.1.1.1"), 1)
	if sample.Status != "reply" || sample.Responder != "10.0.0.1" || *sample.RTTMillis != 17 || end != "" {
		t.Fatalf("%+v %s", sample, end)
	}
	for _, raw := range [][]byte{nil, make([]byte, 12)} {
		if _, err := decodeWindowsEchoReply(raw); err == nil {
			t.Fatal("accepted missing reply")
		}
	}
	timeout, _ := windowsReplySample(windowsEchoReply{status: ipRequestTimedOut}, netip.MustParseAddr("1.1.1.1"), 2)
	if timeout.Status != "timeout" || timeout.Responder != "" || timeout.RTTMillis != nil {
		t.Fatalf("fabricated timeout evidence: %+v", timeout)
	}
	unknown, end := windowsReplySample(windowsEchoReply{status: 11003}, netip.MustParseAddr("1.1.1.1"), 3)
	if unknown.Status != "error" || unknown.Responder != "" || unknown.RTTMillis != nil || end != "unreachable" {
		t.Fatalf("fabricated unreachable responder: %+v", unknown)
	}
}

func TestWindowsTraceSamplesAndCancellation(t *testing.T) {
	target := Target{Address: netip.MustParseAddr("1.1.1.1"), Port: 33434}
	config := windowsTestConfig()
	config.ProbesPerHop = 3
	calls := 0
	result, err := traceWindowsEcho(context.Background(), target, config, func(ttl int, _ time.Duration) (windowsEchoReply, error) {
		calls++
		if ttl == 1 {
			return windowsEchoReply{address: netip.MustParseAddr("10.0.0.1"), status: ipTTLExpiredTransit, rtt: 3, observed: true}, nil
		}
		if calls == 4 {
			return windowsEchoReply{status: ipRequestTimedOut}, nil
		}
		return windowsEchoReply{address: target.Address, rtt: 15, observed: true}, nil
	})
	if err != nil || !result.Reached || len(result.Hops) != 2 || calls != 6 {
		t.Fatalf("%+v %v calls=%d", result, err, calls)
	}
	capability := Capability{Backend: windowsBackendName, Method: "icmp", Available: true, Families: []string{"ipv4"}}
	if err := validateBackendResult(result, capability, config); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	calls = 0
	result, err = traceWindowsEcho(ctx, target, config, func(int, time.Duration) (windowsEchoReply, error) {
		calls++
		cancel()
		return windowsEchoReply{status: ipRequestTimedOut}, nil
	})
	if err != nil || result.Termination != "cancelled" || calls != 1 {
		t.Fatalf("cancel: %+v %v calls=%d", result, err, calls)
	}
	if err := validateBackendResult(result, capability, config); err != nil {
		t.Fatal(err)
	}
	config.MaxHops = 33
	_, err = traceWindowsEcho(context.Background(), target, config, func(int, time.Duration) (windowsEchoReply, error) {
		t.Fatal("invalid plan sent a packet")
		return windowsEchoReply{}, nil
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatal(err)
	}
}

func TestAutoSelectsWindowsICMP(t *testing.T) {
	capabilities := []Capability{{Backend: windowsBackendName, Method: "icmp", Available: true, Families: []string{"ipv4"}}}
	method, _, err := selectCapability(capabilities, "auto", "ipv4")
	if err != nil || method != "icmp" {
		t.Fatalf("%s %v", method, err)
	}
	if _, _, err := selectCapability(capabilities, "auto", "ipv6"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("claimed IPv6 support: %v", err)
	}
}
