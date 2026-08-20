//go:build windows

package netroute

import (
	"net/netip"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsSockaddrPreservesDestinationFamily(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		address string
		check   func(windows.Sockaddr) bool
	}{
		{address: "192.0.2.10", check: func(value windows.Sockaddr) bool {
			sockaddr, ok := value.(*windows.SockaddrInet4)
			return ok && sockaddr.Addr == netip.MustParseAddr("192.0.2.10").As4()
		}},
		{address: "2001:db8::10", check: func(value windows.Sockaddr) bool {
			sockaddr, ok := value.(*windows.SockaddrInet6)
			return ok && sockaddr.Addr == netip.MustParseAddr("2001:db8::10").As16()
		}},
	} {
		test := test
		t.Run(test.address, func(t *testing.T) {
			t.Parallel()
			value, err := windowsSockaddr(netip.MustParseAddr(test.address))
			if err != nil || !test.check(value) {
				t.Fatalf("sockaddr = %#v, error = %v", value, err)
			}
		})
	}
}
