//go:build linux

package netroute

import (
	"context"
	"encoding/binary"
	"net"
	"net/netip"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestLookupLoopbackUsesReadOnlyKernelRoute(t *testing.T) {
	t.Parallel()
	result := Lookup(context.Background(), netip.MustParseAddr("127.0.0.1"))
	if result.Status != "ok" {
		t.Fatalf("loopback lookup = %#v", result)
	}
	if !result.Local || !result.OnLink || result.NextHop != "" || result.SourceIP == "" || result.InterfaceIndex == 0 {
		t.Fatalf("loopback evidence = %#v", result)
	}
}

func TestLookupRejectsInvalidAddressWithoutCallingPlatform(t *testing.T) {
	t.Parallel()
	result := Lookup(context.Background(), netip.Addr{})
	if result.Status != "error" || !strings.Contains(result.Error, "invalid") {
		t.Fatalf("invalid lookup = %#v", result)
	}
}

func TestParseLinuxRouteGatewayAndOnLink(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		gateway    []byte
		wantHop    string
		wantOnLink bool
	}{
		{name: "gateway", gateway: []byte{192, 0, 2, 1}, wantHop: "192.0.2.1"},
		{name: "on link", wantOnLink: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			attributes := marshalRouteAttribute(unix.RTA_OIF, uint32Bytes(7))
			attributes = append(attributes, marshalRouteAttribute(unix.RTA_PREFSRC, []byte{192, 0, 2, 25})...)
			attributes = append(attributes, marshalRouteAttribute(unix.RTA_PRIORITY, uint32Bytes(42))...)
			attributes = append(attributes, marshalRouteAttribute(unix.RTA_TABLE, uint32Bytes(254))...)
			if test.gateway != nil {
				attributes = append(attributes, marshalRouteAttribute(unix.RTA_GATEWAY, test.gateway)...)
			}
			body := make([]byte, routeMessageSize)
			body[0] = unix.AF_INET
			body[1] = 24
			body[7] = unix.RTN_UNICAST
			body = append(body, attributes...)

			result, err := parseLinuxRouteMessage(body, netip.MustParseAddr("192.0.2.80"), newResult(netip.MustParseAddr("192.0.2.80"), backendName))
			if err != nil {
				t.Fatalf("parse route: %v", err)
			}
			if result.NextHop != test.wantHop || result.OnLink != test.wantOnLink {
				t.Fatalf("next hop = %q, onLink = %v", result.NextHop, result.OnLink)
			}
			if result.SourceIP != "192.0.2.25" || result.InterfaceIndex != 7 || value(result.Prefix) != 24 || value(result.RouteMetric) != 42 || value(result.Table) != 254 {
				t.Fatalf("route result = %#v", result)
			}
		})
	}
}

func TestParseLinuxRouteRejectsMalformedAndMismatchedMessages(t *testing.T) {
	t.Parallel()
	destination := netip.MustParseAddr("203.0.113.10")
	base := newResult(destination, backendName)

	if _, _, err := parseLinuxRouteResponse([]byte{1, 2, 3}, 9, 44, destination, base); err == nil {
		t.Fatal("short header unexpectedly accepted")
	}

	message := linuxRouteResponse(t, 10, 44, unix.RTM_NEWROUTE, []byte{unix.AF_INET})
	if _, _, err := parseLinuxRouteResponse(message, 9, 44, destination, base); err == nil {
		t.Fatal("mismatched sequence unexpectedly accepted")
	}
	message = linuxRouteResponse(t, 9, 45, unix.RTM_NEWROUTE, []byte{unix.AF_INET})
	if _, _, err := parseLinuxRouteResponse(message, 9, 44, destination, base); err == nil {
		t.Fatal("mismatched port ID unexpectedly accepted")
	}

	badAttribute := make([]byte, routeMessageSize+4)
	badAttribute[0] = unix.AF_INET
	badAttribute[1] = 32
	binary.NativeEndian.PutUint16(badAttribute[routeMessageSize:], 3)
	message = linuxRouteResponse(t, 9, 44, unix.RTM_NEWROUTE, badAttribute)
	if _, _, err := parseLinuxRouteResponse(message, 9, 44, destination, base); err == nil {
		t.Fatal("invalid attribute unexpectedly accepted")
	}

	nonForwarding := make([]byte, routeMessageSize)
	nonForwarding[0] = unix.AF_INET
	nonForwarding[1] = 32
	nonForwarding[7] = unix.RTN_BLACKHOLE
	message = linuxRouteResponse(t, 9, 44, unix.RTM_NEWROUTE, nonForwarding)
	if _, _, err := parseLinuxRouteResponse(message, 9, 44, destination, base); err == nil {
		t.Fatal("blackhole route unexpectedly accepted as forwarding evidence")
	}
}

func TestParseLinuxRouteFailsClosedForUnrepresentedNextHopEvidence(t *testing.T) {
	t.Parallel()
	destination := netip.MustParseAddr("203.0.113.10")
	for _, test := range []struct {
		name    string
		kind    uint16
		payload []byte
		want    string
	}{
		{name: "multipath", kind: unix.RTA_MULTIPATH, payload: []byte{8, 0, 0, 0, 2, 0, 0, 0}, want: "multipath"},
		{name: "cross family via", kind: unix.RTA_VIA, payload: []byte{unix.AF_INET, 0, 192, 0, 2, 1}, want: "RTA_VIA"},
		{name: "next hop object", kind: linuxRTA_NHID, payload: uint32Bytes(9), want: "RTA_NH_ID"},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			body := make([]byte, routeMessageSize)
			body[0] = unix.AF_INET
			body[1] = 32
			body[7] = unix.RTN_UNICAST
			body = append(body, marshalRouteAttribute(unix.RTA_OIF, uint32Bytes(7))...)
			body = append(body, marshalRouteAttribute(test.kind, test.payload)...)
			result, err := parseLinuxRouteMessage(body, destination, newResult(destination, backendName))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("result = %#v, error = %v", result, err)
			}
			if result.OnLink {
				t.Fatalf("ambiguous route was reported on-link: %#v", result)
			}
		})
	}
}

func TestParseLinuxRoutePreservesLinkLocalPreferredSourceZone(t *testing.T) {
	t.Parallel()
	iface, err := net.InterfaceByName("lo")
	if err != nil {
		t.Skipf("loopback interface unavailable: %v", err)
	}
	destination := netip.MustParseAddr("2001:db8::10")
	body := make([]byte, routeMessageSize)
	body[0] = unix.AF_INET6
	body[1] = 128
	body[7] = unix.RTN_UNICAST
	body = append(body, marshalRouteAttribute(unix.RTA_OIF, uint32Bytes(uint32(iface.Index)))...)
	body = append(body, marshalRouteAttribute(unix.RTA_PREFSRC, netip.MustParseAddr("fe80::2").AsSlice())...)

	result, err := parseLinuxRouteMessage(body, destination, newResult(destination, backendName))
	if err != nil {
		t.Fatalf("parse route: %v", err)
	}
	if result.SourceIP != "fe80::2%"+iface.Name {
		t.Fatalf("preferred source = %q, want zone %q", result.SourceIP, iface.Name)
	}
}

func TestMarshalLinuxRouteRequestUsesRequestFlagWithoutDump(t *testing.T) {
	t.Parallel()
	message, err := marshalLinuxRouteRequest(netip.MustParseAddr("198.51.100.4"), 77, 44)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if got := binary.NativeEndian.Uint16(message[6:8]); got != unix.NLM_F_REQUEST {
		t.Fatalf("flags = %#x, want NLM_F_REQUEST only", got)
	}
	if got := binary.NativeEndian.Uint32(message[8:12]); got != 77 {
		t.Fatalf("sequence = %d", got)
	}
	if got := binary.NativeEndian.Uint32(message[12:16]); got != 44 {
		t.Fatalf("port ID = %d", got)
	}
}

func linuxRouteResponse(t *testing.T, sequence, portID uint32, kind uint16, body []byte) []byte {
	t.Helper()
	message := make([]byte, netlinkHeaderSize+len(body))
	binary.NativeEndian.PutUint32(message[0:4], uint32(len(message)))
	binary.NativeEndian.PutUint16(message[4:6], kind)
	binary.NativeEndian.PutUint32(message[8:12], sequence)
	binary.NativeEndian.PutUint32(message[12:16], portID)
	copy(message[netlinkHeaderSize:], body)
	return message
}

func uint32Bytes(value uint32) []byte {
	data := make([]byte, 4)
	binary.NativeEndian.PutUint32(data, value)
	return data
}

func value(pointer *int) int {
	if pointer == nil {
		return -1
	}
	return *pointer
}
