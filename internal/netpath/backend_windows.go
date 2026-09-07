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
	"slices"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const windowsBackendName = "windows-icmp-echo"
const ipRequestTimedOut = 11010
const ipTTLExpiredTransit = 11013

var icmpLibrary = windows.NewLazySystemDLL("iphlpapi.dll")
var icmpCreateFile = icmpLibrary.NewProc("IcmpCreateFile")
var icmpCloseHandle = icmpLibrary.NewProc("IcmpCloseHandle")
var icmpSendEcho = icmpLibrary.NewProc("IcmpSendEcho")

type windowsBackend struct{}
type windowsEchoReply struct {
	address  netip.Addr
	status   uint32
	rtt      float64
	observed bool
}
type windowsEchoProbe func(ttl int, timeout time.Duration) (windowsEchoReply, error)

func newPlatformBackend() Backend { return windowsBackend{} }

func openICMPHandle() (uintptr, error) {
	for _, proc := range []*windows.LazyProc{icmpCreateFile, icmpCloseHandle, icmpSendEcho} {
		if err := proc.Find(); err != nil {
			return 0, err
		}
	}
	handle, _, err := icmpCreateFile.Call()
	if handle == ^uintptr(0) || handle == 0 {
		return 0, fmt.Errorf("IcmpCreateFile: %w", err)
	}
	return handle, nil
}

func (windowsBackend) Capabilities(ctx context.Context) []Capability {
	capability := Capability{Backend: windowsBackendName, Method: "icmp", Families: []string{"ipv4"}, Privilege: "none", Install: "built-in", Limitations: []string{
		"This method uses Windows IPv4 ICMP echo. Routers may suppress or rate-limit replies.",
		"RTT is Windows' millisecond measurement from this process to the responder, not latency between routers.",
		"Cancellation stops after the current native probe returns, within its timeout (at most 2 seconds).",
	}}
	if err := ctx.Err(); err != nil {
		capability.Reason = err.Error()
	} else if handle, err := openICMPHandle(); err != nil {
		capability.Reason = err.Error()
	} else {
		capability.Available = true
		_, _, _ = icmpCloseHandle.Call(handle)
	}
	unsupported := func(method string) Capability {
		return Capability{Backend: windowsBackendName, Method: method, Families: []string{}, Privilege: "none", Install: "not-offered", Reason: "A native Windows " + method + " hop-probe backend is not implemented.", Limitations: []string{}}
	}
	return []Capability{capability, windowsIPv6Capability(ctx), unsupported("udp"), unsupported("tcp")}
}

func validateWindowsTrace(target Target, config TraceConfig) error {
	if !target.Address.IsValid() || target.Address.IsUnspecified() || target.Address.IsMulticast() || target.Address.Zone() != "" {
		return fmt.Errorf("%w: Windows ICMP requires a unicast IP target without a scope suffix", ErrInvalidRequest)
	}
	if config.Method != "icmp" {
		return fmt.Errorf("%w: Windows backend supports ICMP", ErrUnsupported)
	}
	if config.MaxHops < 1 || config.MaxHops > maxHops || config.ProbesPerHop < 1 || config.ProbesPerHop > maxProbesPerHop || config.MaxHops*config.ProbesPerHop > maxTotalProbes {
		return fmt.Errorf("%w: invalid probe count", ErrInvalidRequest)
	}
	if config.PerProbeTimeout < minProbeTimeout || config.PerProbeTimeout > maxProbeTimeout || config.WallTimeout < time.Second || config.WallTimeout > maxWallTimeout {
		return fmt.Errorf("%w: invalid probe timeout", ErrInvalidRequest)
	}
	return nil
}

func (windowsBackend) Trace(ctx context.Context, target Target, config TraceConfig) (BackendResult, error) {
	if err := validateWindowsTrace(target, config); err != nil {
		return BackendResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return BackendResult{}, err
	}
	if target.Address.Is6() {
		return traceWindowsIPv6(ctx, target, config)
	}
	handle, err := openICMPHandle()
	if err != nil {
		return BackendResult{}, err
	}
	defer icmpCloseHandle.Call(handle)
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return BackendResult{}, err
	}
	ip := target.Address.As4()
	destination := binary.LittleEndian.Uint32(ip[:])
	probe := func(ttl int, timeout time.Duration) (windowsEchoReply, error) {
		// IP_OPTION_INFORMATION32: four one-byte fields and a zero 32-bit options pointer.
		// Only TTL is set. First 12 reply bytes are address/status/RTT on both Windows ABIs;
		// no returned pointers are dereferenced. Buffer includes reply structure + data + error header.
		options := [8]byte{byte(ttl)}
		reply := make([]byte, 512)
		count, _, callErr := icmpSendEcho.Call(handle, uintptr(destination), uintptr(unsafe.Pointer(&nonce[0])), uintptr(len(nonce)), uintptr(unsafe.Pointer(&options[0])), uintptr(unsafe.Pointer(&reply[0])), uintptr(len(reply)), uintptr(max(1, timeout.Milliseconds())))
		runtime.KeepAlive(nonce)
		runtime.KeepAlive(options)
		runtime.KeepAlive(reply)
		if count == 0 {
			var status syscall.Errno
			if errors.As(callErr, &status) && uint32(status) >= 11000 && uint32(status) <= 11050 {
				return windowsEchoReply{status: uint32(status)}, nil
			}
			return windowsEchoReply{}, fmt.Errorf("IcmpSendEcho: %w", callErr)
		}
		return decodeWindowsEchoReply(reply)
	}
	return traceWindowsEcho(ctx, target, config, probe)
}

func decodeWindowsEchoReply(raw []byte) (windowsEchoReply, error) {
	if len(raw) < 12 {
		return windowsEchoReply{}, errors.New("short ICMP reply buffer")
	}
	address := netip.AddrFrom4([4]byte(raw[:4]))
	status := binary.LittleEndian.Uint32(raw[4:8])
	if address.IsUnspecified() || address.IsMulticast() {
		return windowsEchoReply{}, errors.New("ICMP reply omitted a valid responder")
	}
	return windowsEchoReply{address: address, status: status, rtt: float64(binary.LittleEndian.Uint32(raw[8:12])), observed: true}, nil
}

func windowsReplySample(reply windowsEchoReply, target netip.Addr, sequence int) (Sample, string) {
	sample := Sample{Sequence: sequence, Status: "error", Detail: fmt.Sprintf("Windows ICMP status %d", reply.status)}
	if reply.status == ipRequestTimedOut {
		return Sample{Sequence: sequence, Status: "timeout"}, ""
	}
	terminal := ""
	if reply.observed {
		sample.Responder = reply.address.String()
		sample.RTTMillis = &reply.rtt
	}
	switch reply.status {
	case 0:
		if reply.observed {
			sample.Status = "reply"
			sample.Detail = "ICMP echo reply"
			if reply.address == target {
				terminal = "reached"
			}
		}
	case ipTTLExpiredTransit:
		if reply.observed {
			sample.Status = "reply"
			sample.Detail = "TTL expired in transit"
		}
	case 11002, 11003, 11004, 11005, 11009, 11012, 11018, 11040, 11045:
		terminal = "unreachable"
		if reply.observed {
			sample.Status = "unreachable"
		}
	}
	return sample, terminal
}

func traceWindowsEcho(parent context.Context, target Target, config TraceConfig, probe windowsEchoProbe) (BackendResult, error) {
	result := BackendResult{Backend: windowsBackendName, Method: "icmp", Hops: []Hop{}, Termination: "max-hops", Warnings: []string{"Native Windows ICMP echo; no traceroute executable or elevation is used."}}
	if err := validateWindowsTrace(target, config); err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(parent, config.WallTimeout)
	defer cancel()
	var lastSent time.Time
	finish := func(hop Hop) {
		if len(hop.Samples) > 0 {
			result.Hops = append(result.Hops, hop)
		}
		if errors.Is(parent.Err(), context.Canceled) {
			result.Termination = "cancelled"
		} else {
			result.Termination = "deadline"
		}
	}
	for ttl := 1; ttl <= config.MaxHops; ttl++ {
		hop := Hop{TTL: ttl, Responders: []string{}, Samples: []Sample{}}
		terminal := ""
		for sequence := 1; sequence <= config.ProbesPerHop; sequence++ {
			if !lastSent.IsZero() {
				wait := time.Until(lastSent.Add(50 * time.Millisecond))
				if wait > 0 {
					timer := time.NewTimer(wait)
					select {
					case <-timer.C:
					case <-ctx.Done():
					}
					timer.Stop()
				}
			}
			if ctx.Err() != nil {
				finish(hop)
				return result, nil
			}
			timeout := config.PerProbeTimeout
			if deadline, ok := ctx.Deadline(); ok {
				timeout = min(timeout, time.Until(deadline))
			}
			if timeout < time.Millisecond {
				finish(hop)
				return result, nil
			}
			lastSent = time.Now()
			reply, err := probe(ttl, timeout)
			if ctx.Err() != nil {
				finish(hop)
				return result, nil
			}
			if err != nil {
				return result, err
			}
			sample, end := windowsReplySample(reply, target.Address, sequence)
			hop.Samples = append(hop.Samples, sample)
			if sample.Responder != "" && !slices.Contains(hop.Responders, sample.Responder) {
				hop.Responders = append(hop.Responders, sample.Responder)
			}
			if end == "reached" || terminal == "" {
				terminal = end
			}
		}
		result.Hops = append(result.Hops, hop)
		if terminal != "" {
			result.Termination = terminal
			result.Reached = terminal == "reached"
			return result, nil
		}
	}
	return result, nil
}
