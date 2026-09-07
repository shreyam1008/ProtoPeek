//go:build windows

package netpath

import (
	"context"
	"encoding/binary"
	"net/netip"
	"testing"
)

func TestWindowsNativeIPv6Loopback(t *testing.T) {
	capability := windowsIPv6Capability(context.Background())
	if !capability.Available {
		t.Skipf("Native ICMPv6 unavailable: %s", capability.Reason)
	}
	result, err := (windowsBackend{}).Trace(context.Background(), Target{Address: netip.MustParseAddr("::1")}, windowsTestConfig())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Reached || len(result.Hops) != 1 || len(result.Hops[0].Responders) != 1 || result.Hops[0].Responders[0] != "::1" {
		t.Fatalf("native IPv6 loopback: %+v", result)
	}
	if err := validateBackendResult(result, capability, windowsTestConfig()); err != nil {
		t.Fatal(err)
	}
	t.Logf("Native ICMPv6 loopback: %+v", result.Hops[0].Samples[0])
}

func TestWindowsIPv6ReplyLayoutAndHopLimitStatus(t *testing.T) {
	address := netip.MustParseAddr("2001:4860:4860::8888")
	raw := make([]byte, 36)
	ip := address.As16()
	copy(raw[6:22], ip[:])
	binary.LittleEndian.PutUint32(raw[28:32], ipTTLExpiredTransit)
	binary.LittleEndian.PutUint32(raw[32:36], 17)
	reply, err := decodeWindowsIPv6Reply(raw)
	if err != nil || reply.address != address || reply.rtt != 17 {
		t.Fatal(reply, err)
	}
	sample, termination := windowsReplySample(reply, netip.MustParseAddr("::1"), 1)
	if sample.Status != "reply" || termination != "" {
		t.Fatal(sample, termination)
	}
	for _, invalid := range [][]byte{nil, make([]byte, 35), make([]byte, 36)} {
		if _, err := decodeWindowsIPv6Reply(invalid); err == nil {
			t.Fatal("accepted missing IPv6 reply")
		}
	}
}
