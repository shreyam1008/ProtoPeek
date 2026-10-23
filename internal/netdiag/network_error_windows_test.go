//go:build windows

package netdiag

import (
	"fmt"
	"net"
	"os"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsUDPResetMeansPortUnreachableOnlyForUDP(t *testing.T) {
	for _, network := range []string{"udp", "udp4", "udp6", "tcp", "tcp4", "tcp6", ""} {
		t.Run(network, func(t *testing.T) {
			err := fmt.Errorf("wrapped: %w", &net.OpError{Op: "read", Net: network, Err: os.NewSyscallError("recvfrom", windows.WSAECONNRESET)})
			outcome, detail := networkError(err)
			if strings.HasPrefix(network, "udp") {
				if outcome != "refused" || !strings.Contains(detail, "UDP port unreachable") {
					t.Fatalf("UDP reset lost cause: %s %q", outcome, detail)
				}
			} else if outcome == "refused" || strings.Contains(detail, "UDP") {
				t.Fatalf("TCP/unknown reset became UDP refusal: %s %q", outcome, detail)
			}
		})
	}
	if outcome, _ := networkError(windows.WSAECONNRESET); outcome == "refused" {
		t.Fatal("unattributed reset became UDP refusal")
	}
}
