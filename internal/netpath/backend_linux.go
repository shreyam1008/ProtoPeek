//go:build linux

package netpath

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

const (
	linuxBackendName = "linux-udp-error-queue"
	probePayloadSize = 16
	maxReplyBytes    = 4 << 10
	maxControlBytes  = 4 << 10
	probeInterval    = 50 * time.Millisecond
)

var errProbeTimeout = errors.New("path probe timed out")

type linuxBackend struct{}

type linuxExtendedError struct {
	errno    uint32
	origin   uint8
	typeCode uint8
	code     uint8
	offender netip.Addr
}

func newPlatformBackend() Backend {
	return linuxBackend{}
}

func (linuxBackend) Capabilities(ctx context.Context) []Capability {
	families := make([]string, 0, 2)
	reasons := make([]string, 0, 2)
	for _, candidate := range []struct {
		name   string
		family int
	}{
		{name: "ipv4", family: unix.AF_INET},
		{name: "ipv6", family: unix.AF_INET6},
	} {
		if err := ctx.Err(); err != nil {
			reasons = append(reasons, err.Error())
			break
		}
		if err := checkLinuxErrorQueue(candidate.family); err != nil {
			reasons = append(reasons, candidate.name+": "+err.Error())
			continue
		}
		families = append(families, candidate.name)
	}
	reason := ""
	if len(families) == 0 {
		reason = strings.Join(reasons, "; ")
	}
	return []Capability{
		{
			Backend:   linuxBackendName,
			Method:    "udp",
			Families:  families,
			Available: len(families) > 0,
			Privilege: "none",
			Install:   "built-in",
			Reason:    reason,
			Limitations: []string{
				"Uses one stable UDP five-tuple and Linux asynchronous ICMP error-queue evidence.",
				"Routers may suppress, rate-limit, or return multiple responses at a TTL.",
				"An open or silent UDP destination can time out instead of proving arrival.",
			},
		},
		unavailableCapability("icmp", "A native unprivileged ICMP backend is not implemented in this slice."),
		unavailableCapability("tcp", "A native TCP path backend is not implemented in this slice."),
	}
}

func unavailableCapability(method, reason string) Capability {
	return Capability{
		Backend:     "not-implemented",
		Method:      method,
		Families:    make([]string, 0),
		Available:   false,
		Privilege:   "none",
		Install:     "not-offered",
		Reason:      reason,
		Limitations: make([]string, 0),
	}
}

func checkLinuxErrorQueue(family int) error {
	fd, err := unix.Socket(family, unix.SOCK_DGRAM|unix.SOCK_CLOEXEC, unix.IPPROTO_UDP)
	if err != nil {
		return fmt.Errorf("open UDP socket: %w", err)
	}
	defer unix.Close(fd)
	if family == unix.AF_INET {
		if err := unix.SetsockoptInt(fd, unix.SOL_IP, unix.IP_RECVERR, 1); err != nil {
			return fmt.Errorf("enable IP_RECVERR: %w", err)
		}
		return nil
	}
	if err := unix.SetsockoptInt(fd, unix.SOL_IPV6, unix.IPV6_RECVERR, 1); err != nil {
		return fmt.Errorf("enable IPV6_RECVERR: %w", err)
	}
	return nil
}

func (linuxBackend) Trace(ctx context.Context, target Target, config TraceConfig) (BackendResult, error) {
	result := BackendResult{
		Backend:     linuxBackendName,
		Method:      "udp",
		Hops:        make([]Hop, 0, config.MaxHops),
		Termination: "max-hops",
		Warnings: []string{
			"The UDP source and destination ports remain stable so load balancers are less likely to invent path changes.",
		},
	}
	if err := validateLinuxTrace(target, config); err != nil {
		return result, err
	}
	traceCtx, cancel := context.WithTimeout(ctx, config.WallTimeout)
	defer cancel()

	fd, family, err := openLinuxTraceSocket(target)
	if err != nil {
		return result, err
	}
	defer unix.Close(fd)

	var runNonce [8]byte
	if _, err := rand.Read(runNonce[:]); err != nil {
		return result, fmt.Errorf("create probe nonce: %w", err)
	}
	sequence := 0
	var lastSent time.Time
	for ttl := 1; ttl <= config.MaxHops; ttl++ {
		hop := Hop{TTL: ttl, Responders: make([]string, 0, config.ProbesPerHop), Samples: make([]Sample, 0, config.ProbesPerHop)}
		hopReached := false
		hopUnreachable := false
		for probeIndex := range config.ProbesPerHop {
			if err := waitProbePacing(traceCtx, lastSent); err != nil {
				appendHopIfObserved(&result, hop)
				setContextTermination(&result, ctx, traceCtx)
				return result, nil
			}
			sequence++
			sampleSequence := probeIndex + 1
			payload := marshalProbePayload(runNonce, ttl, sequence)
			if err := setLinuxHopLimit(fd, family, ttl); err != nil {
				return result, fmt.Errorf("set hop limit %d: %w", ttl, err)
			}
			drainLinuxErrorQueue(fd)
			sentAt := time.Now()
			if err := unix.Send(fd, payload, 0); err != nil {
				return result, fmt.Errorf("send UDP path probe: %w", err)
			}
			lastSent = sentAt
			sample, terminal, err := receiveLinuxProbe(traceCtx, fd, family, target.Address, payload, sampleSequence, sentAt, config.PerProbeTimeout)
			if errors.Is(err, errProbeTimeout) {
				hop.Samples = append(hop.Samples, Sample{Sequence: sampleSequence, Status: "timeout"})
				continue
			}
			if err != nil {
				if traceCtx.Err() != nil {
					appendHopIfObserved(&result, hop)
					setContextTermination(&result, ctx, traceCtx)
					return result, nil
				}
				return result, err
			}
			hop.Samples = append(hop.Samples, sample)
			if sample.Responder != "" && !containsString(hop.Responders, sample.Responder) {
				hop.Responders = append(hop.Responders, sample.Responder)
			}
			hopReached = hopReached || terminal == "reached"
			hopUnreachable = hopUnreachable || terminal == "unreachable"
		}
		result.Hops = append(result.Hops, hop)
		if hopReached {
			result.Reached = true
			result.Termination = "reached"
			return result, nil
		}
		if hopUnreachable {
			result.Termination = "unreachable"
			return result, nil
		}
	}
	return result, nil
}

func validateLinuxTrace(target Target, config TraceConfig) error {
	if !target.Address.IsValid() || target.Address.IsUnspecified() || target.Address.IsMulticast() {
		return fmt.Errorf("%w: invalid UDP trace destination", ErrInvalidRequest)
	}
	if config.Method != "udp" {
		return fmt.Errorf("%w: Linux error-queue backend only supports udp", ErrUnsupported)
	}
	if target.Port < 1 || target.Port > 65535 || config.DestinationPort != target.Port {
		return fmt.Errorf("%w: invalid or inconsistent destination port", ErrInvalidRequest)
	}
	if config.MaxHops < 1 || config.MaxHops > maxHops || config.ProbesPerHop < 1 || config.ProbesPerHop > maxProbesPerHop || config.MaxHops*config.ProbesPerHop > maxTotalProbes {
		return fmt.Errorf("%w: probe count exceeds fixed limits", ErrInvalidRequest)
	}
	if config.PerProbeTimeout < minProbeTimeout || config.PerProbeTimeout > maxProbeTimeout {
		return fmt.Errorf("%w: per-probe timeout exceeds fixed limits", ErrInvalidRequest)
	}
	if config.WallTimeout < time.Second || config.WallTimeout > maxWallTimeout {
		return fmt.Errorf("%w: wall timeout exceeds fixed limits", ErrInvalidRequest)
	}
	return nil
}

func openLinuxTraceSocket(target Target) (int, int, error) {
	address := target.Address.Unmap()
	family := unix.AF_INET6
	if address.Is4() {
		family = unix.AF_INET
	}
	fd, err := unix.Socket(family, unix.SOCK_DGRAM|unix.SOCK_CLOEXEC|unix.SOCK_NONBLOCK, unix.IPPROTO_UDP)
	if err != nil {
		return -1, family, fmt.Errorf("open UDP trace socket: %w", err)
	}
	closeOnError := true
	defer func() {
		if closeOnError {
			_ = unix.Close(fd)
		}
	}()
	if family == unix.AF_INET {
		if err := unix.SetsockoptInt(fd, unix.SOL_IP, unix.IP_RECVERR, 1); err != nil {
			return -1, family, fmt.Errorf("enable IP_RECVERR: %w", err)
		}
		v4 := address.As4()
		sockaddr := &unix.SockaddrInet4{Port: target.Port, Addr: v4}
		if err := unix.Connect(fd, sockaddr); err != nil {
			return -1, family, fmt.Errorf("connect UDP trace socket: %w", err)
		}
	} else {
		if err := unix.SetsockoptInt(fd, unix.SOL_IPV6, unix.IPV6_RECVERR, 1); err != nil {
			return -1, family, fmt.Errorf("enable IPV6_RECVERR: %w", err)
		}
		v6 := address.As16()
		sockaddr := &unix.SockaddrInet6{Port: target.Port, Addr: v6}
		if address.Zone() != "" {
			zone, err := linuxZoneID(address.Zone())
			if err != nil {
				return -1, family, err
			}
			sockaddr.ZoneId = zone
		}
		if err := unix.Connect(fd, sockaddr); err != nil {
			return -1, family, fmt.Errorf("connect UDP trace socket: %w", err)
		}
	}
	closeOnError = false
	return fd, family, nil
}

func linuxZoneID(zone string) (uint32, error) {
	if index, err := strconv.ParseUint(zone, 10, 32); err == nil && index > 0 {
		return uint32(index), nil
	}
	iface, err := net.InterfaceByName(zone)
	if err != nil {
		return 0, fmt.Errorf("resolve IPv6 zone %q: %w", zone, err)
	}
	return uint32(iface.Index), nil
}

func setLinuxHopLimit(fd, family, ttl int) error {
	if family == unix.AF_INET {
		return unix.SetsockoptInt(fd, unix.SOL_IP, unix.IP_TTL, ttl)
	}
	return unix.SetsockoptInt(fd, unix.SOL_IPV6, unix.IPV6_UNICAST_HOPS, ttl)
}

func marshalProbePayload(nonce [8]byte, ttl, sequence int) []byte {
	payload := make([]byte, probePayloadSize)
	copy(payload[:4], "PPTH")
	copy(payload[4:12], nonce[:])
	binary.BigEndian.PutUint16(payload[12:14], uint16(ttl))
	binary.BigEndian.PutUint16(payload[14:16], uint16(sequence))
	return payload
}

func receiveLinuxProbe(ctx context.Context, fd, family int, target netip.Addr, expected []byte, sequence int, sentAt time.Time, timeout time.Duration) (Sample, string, error) {
	deadline := sentAt.Add(timeout)
	payload := make([]byte, maxReplyBytes)
	control := make([]byte, maxControlBytes)
	for {
		n, oobn, flags, _, err := unix.Recvmsg(fd, payload, control, unix.MSG_ERRQUEUE|unix.MSG_DONTWAIT)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			if err := pollLinuxErrorQueue(ctx, fd, deadline); err != nil {
				return Sample{}, "", err
			}
			continue
		}
		if err != nil {
			return Sample{}, "", fmt.Errorf("read UDP error queue: %w", err)
		}
		if flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || n > len(payload) || oobn > len(control) {
			return Sample{}, "", fmt.Errorf("reject truncated UDP error-queue response")
		}
		if !bytes.Equal(payload[:n], expected) {
			continue
		}
		extended, found, err := parseLinuxErrorControl(control[:oobn], family)
		if err != nil {
			return Sample{}, "", err
		}
		if !found {
			continue
		}
		return linuxSample(extended, target, sequence, time.Since(sentAt))
	}
}

func pollLinuxErrorQueue(ctx context.Context, fd int, deadline time.Time) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return errProbeTimeout
		}
		wait := min(remaining, 50*time.Millisecond)
		timeoutMS := int((wait + time.Millisecond - 1) / time.Millisecond)
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLERR}}
		count, err := unix.Poll(fds, timeoutMS)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("wait for UDP error queue: %w", err)
		}
		if count > 0 && fds[0].Revents&unix.POLLERR != 0 {
			return nil
		}
		if count > 0 && fds[0].Revents&(unix.POLLNVAL|unix.POLLHUP) != 0 {
			return fmt.Errorf("UDP error-queue socket became unavailable")
		}
	}
}

func parseLinuxErrorControl(control []byte, family int) (linuxExtendedError, bool, error) {
	messages, err := unix.ParseSocketControlMessage(control)
	if err != nil {
		return linuxExtendedError{}, false, fmt.Errorf("parse UDP error control message: %w", err)
	}
	for _, message := range messages {
		valid := family == unix.AF_INET && message.Header.Level == unix.SOL_IP && message.Header.Type == unix.IP_RECVERR ||
			family == unix.AF_INET6 && message.Header.Level == unix.SOL_IPV6 && message.Header.Type == unix.IPV6_RECVERR
		if !valid {
			continue
		}
		extended, err := parseLinuxExtendedError(message.Data)
		if err == nil && (family == unix.AF_INET && extended.origin != unix.SO_EE_ORIGIN_ICMP || family == unix.AF_INET6 && extended.origin != unix.SO_EE_ORIGIN_ICMP6) {
			return linuxExtendedError{}, false, fmt.Errorf("ICMP error origin does not match socket family")
		}
		if err == nil && (family == unix.AF_INET && !extended.offender.Is4() || family == unix.AF_INET6 && !extended.offender.Is6()) {
			return linuxExtendedError{}, false, fmt.Errorf("ICMP responder does not match socket family")
		}
		return extended, err == nil, err
	}
	return linuxExtendedError{}, false, nil
}

func parseLinuxExtendedError(data []byte) (linuxExtendedError, error) {
	if len(data) < 16 {
		return linuxExtendedError{}, fmt.Errorf("short Linux extended error")
	}
	extended := linuxExtendedError{
		errno:    binary.NativeEndian.Uint32(data[0:4]),
		origin:   data[4],
		typeCode: data[5],
		code:     data[6],
	}
	if extended.origin != unix.SO_EE_ORIGIN_ICMP && extended.origin != unix.SO_EE_ORIGIN_ICMP6 {
		return linuxExtendedError{}, fmt.Errorf("reject UDP error with origin %d", extended.origin)
	}
	offender, err := parseLinuxOffender(data[16:])
	if err != nil {
		return linuxExtendedError{}, err
	}
	if !offender.IsValid() || offender.IsUnspecified() {
		return linuxExtendedError{}, fmt.Errorf("ICMP error omits its responder address")
	}
	extended.offender = offender
	return extended, nil
}

func parseLinuxOffender(data []byte) (netip.Addr, error) {
	if len(data) < 2 {
		return netip.Addr{}, fmt.Errorf("short Linux error offender address")
	}
	family := int(binary.NativeEndian.Uint16(data[:2]))
	switch family {
	case unix.AF_UNSPEC:
		return netip.Addr{}, nil
	case unix.AF_INET:
		if len(data) < 16 {
			return netip.Addr{}, fmt.Errorf("short IPv4 offender address")
		}
		return netip.AddrFrom4([4]byte(data[4:8])), nil
	case unix.AF_INET6:
		if len(data) < 28 {
			return netip.Addr{}, fmt.Errorf("short IPv6 offender address")
		}
		address := netip.AddrFrom16([16]byte(data[8:24]))
		scope := binary.NativeEndian.Uint32(data[24:28])
		if scope != 0 {
			address = address.WithZone(strconv.FormatUint(uint64(scope), 10))
		}
		return address, nil
	default:
		return netip.Addr{}, fmt.Errorf("unknown offender address family %d", family)
	}
}

func linuxSample(extended linuxExtendedError, target netip.Addr, sequence int, rtt time.Duration) (Sample, string, error) {
	typeCode := int(extended.typeCode)
	code := int(extended.code)
	rttMS := float64(rtt.Microseconds()) / 1000
	sample := Sample{
		Sequence:  sequence,
		Responder: extended.offender.String(),
		RTTMillis: &rttMS,
		ICMPType:  &typeCode,
		ICMPCode:  &code,
	}
	if extended.origin == unix.SO_EE_ORIGIN_ICMP && extended.typeCode == 11 && extended.code == 0 ||
		extended.origin == unix.SO_EE_ORIGIN_ICMP6 && extended.typeCode == 3 && extended.code == 0 {
		sample.Status = "reply"
		return sample, "", nil
	}
	portUnreachable := extended.origin == unix.SO_EE_ORIGIN_ICMP && extended.typeCode == 3 && extended.code == 3 ||
		extended.origin == unix.SO_EE_ORIGIN_ICMP6 && extended.typeCode == 1 && extended.code == 4
	if portUnreachable && sameAddressWithoutZone(extended.offender, target) {
		sample.Status = "reply"
		sample.Detail = "destination returned UDP port unreachable"
		return sample, "reached", nil
	}
	destinationUnreachable := extended.origin == unix.SO_EE_ORIGIN_ICMP && extended.typeCode == 3 ||
		extended.origin == unix.SO_EE_ORIGIN_ICMP6 && extended.typeCode == 1
	if destinationUnreachable {
		sample.Status = "unreachable"
		sample.Detail = unix.Errno(extended.errno).Error()
		return sample, "unreachable", nil
	}
	sample.Status = "error"
	sample.Detail = fmt.Sprintf("unhandled ICMP error origin=%d type=%d code=%d", extended.origin, extended.typeCode, extended.code)
	return sample, "", nil
}

func sameAddressWithoutZone(left, right netip.Addr) bool {
	if !left.IsValid() || !right.IsValid() {
		return false
	}
	return left.WithZone("").Unmap() == right.WithZone("").Unmap()
}

func waitProbePacing(ctx context.Context, previous time.Time) error {
	if previous.IsZero() {
		return ctx.Err()
	}
	wait := time.Until(previous.Add(probeInterval))
	if wait <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-timer.C:
		return ctx.Err()
	case <-ctx.Done():
		return ctx.Err()
	}
}

func drainLinuxErrorQueue(fd int) {
	payload := make([]byte, maxReplyBytes)
	control := make([]byte, maxControlBytes)
	for {
		_, _, _, _, err := unix.Recvmsg(fd, payload, control, unix.MSG_ERRQUEUE|unix.MSG_DONTWAIT)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			return
		}
		if err != nil {
			return
		}
	}
}

func appendHopIfObserved(result *BackendResult, hop Hop) {
	if len(hop.Samples) > 0 {
		result.Hops = append(result.Hops, hop)
	}
}

func setContextTermination(result *BackendResult, parent, trace context.Context) {
	if errors.Is(parent.Err(), context.Canceled) {
		result.Termination = "cancelled"
		return
	}
	if parent.Err() != nil || trace.Err() != nil {
		result.Termination = "deadline"
	}
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
