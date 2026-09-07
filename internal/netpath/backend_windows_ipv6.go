//go:build windows

package netpath

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"net/netip"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var icmp6CreateFile = icmpLibrary.NewProc("Icmp6CreateFile")
var icmp6SendEcho2 = icmpLibrary.NewProc("Icmp6SendEcho2")

func openICMP6Handle() (uintptr, error) {
	for _, proc := range []*windows.LazyProc{icmp6CreateFile, icmp6SendEcho2, icmpCloseHandle} {
		if err := proc.Find(); err != nil {
			return 0, err
		}
	}
	handle, _, err := icmp6CreateFile.Call()
	if handle == 0 || handle == ^uintptr(0) {
		return 0, fmt.Errorf("Icmp6CreateFile: %w", err)
	}
	return handle, nil
}

func windowsIPv6Capability(ctx context.Context) Capability {
	capability := Capability{Backend: windowsBackendName, Method: "icmp", Families: []string{"ipv6"}, Privilege: "none", Install: "built-in", Limitations: []string{
		"IPv6 ICMP echo uses the native Windows stack; scoped link-local destination syntax is not supported.",
		"RTT is measured from this process to the responder, not between routers. Routers may suppress replies.",
		"Cancellation waits at most the current two-second probe timeout.",
	}}
	if err := ctx.Err(); err != nil {
		capability.Reason = err.Error()
	} else if handle, err := openICMP6Handle(); err != nil {
		capability.Reason = err.Error()
	} else {
		capability.Available = true
		_, _, _ = icmpCloseHandle.Call(handle)
	}
	return capability
}

func traceWindowsIPv6(ctx context.Context, target Target, config TraceConfig) (BackendResult, error) {
	handle, err := openICMP6Handle()
	if err != nil {
		return BackendResult{}, err
	}
	defer icmpCloseHandle.Call(handle)
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return BackendResult{}, err
	}
	// sockaddr_in6 has a native-endian family, then port, flowinfo, 16 network-
	// order address bytes and scope ID. A zero source lets the stack select it.
	var source, destination [28]byte
	binary.LittleEndian.PutUint16(source[:2], windows.AF_INET6)
	binary.LittleEndian.PutUint16(destination[:2], windows.AF_INET6)
	address := target.Address.As16()
	copy(destination[8:24], address[:])
	probe := func(ttl int, timeout time.Duration) (windowsEchoReply, error) {
		// Microsoft specifies IP_OPTION_INFORMATION32 on 64-bit Windows too.
		options := [8]byte{byte(ttl)}
		reply := make([]byte, 512)
		count, _, callErr := icmp6SendEcho2.Call(handle, 0, 0, 0, uintptr(unsafe.Pointer(&source[0])), uintptr(unsafe.Pointer(&destination[0])), uintptr(unsafe.Pointer(&nonce[0])), uintptr(len(nonce)), uintptr(unsafe.Pointer(&options[0])), uintptr(unsafe.Pointer(&reply[0])), uintptr(len(reply)), uintptr(max(1, timeout.Milliseconds())))
		runtime.KeepAlive(source)
		runtime.KeepAlive(destination)
		runtime.KeepAlive(nonce)
		runtime.KeepAlive(options)
		runtime.KeepAlive(reply)
		if count == 0 {
			var status syscall.Errno
			if errors.As(callErr, &status) && uint32(status) >= 11000 && uint32(status) <= 11050 {
				return windowsEchoReply{status: uint32(status)}, nil
			}
			return windowsEchoReply{}, fmt.Errorf("Icmp6SendEcho2: %w", callErr)
		}
		return decodeWindowsIPv6Reply(reply)
	}
	return traceWindowsEcho(ctx, target, config, probe)
}

func decodeWindowsIPv6Reply(raw []byte) (windowsEchoReply, error) {
	// IPV6_ADDRESS_EX is packed: its address starts at byte 6 and its size is
	// 26. The outer ICMPV6_ECHO_REPLY pads Status to byte 28, then RTT to 32.
	// Read only fixed fields; never dereference pointers returned by Windows.
	if len(raw) < 36 {
		return windowsEchoReply{}, errors.New("short ICMPv6 reply buffer")
	}
	address := netip.AddrFrom16([16]byte(raw[6:22]))
	if address.IsUnspecified() || address.IsMulticast() {
		return windowsEchoReply{}, errors.New("ICMPv6 reply omitted a valid responder")
	}
	return windowsEchoReply{address: address, status: binary.LittleEndian.Uint32(raw[28:32]), rtt: float64(binary.LittleEndian.Uint32(raw[32:36])), observed: true}, nil
}
