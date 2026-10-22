//go:build windows

package netdiag

import (
	"errors"
	"net"

	"golang.org/x/sys/windows"
)

func platformNetworkError(err error) (string, string, bool) {
	var operation *net.OpError
	if errors.As(err, &operation) && (operation.Net == "udp" || operation.Net == "udp4" || operation.Net == "udp6") && errors.Is(err, windows.WSAECONNRESET) {
		return "refused", "The operating system reported UDP port unreachable for this datagram.", true
	}
	if errors.Is(err, windows.WSAECONNREFUSED) {
		return "refused", "The operating system reported connection refused.", true
	}
	if errors.Is(err, windows.WSAENETUNREACH) || errors.Is(err, windows.WSAEHOSTUNREACH) {
		return "unreachable", "The operating system reported an unreachable network or host.", true
	}
	return "", "", false
}
