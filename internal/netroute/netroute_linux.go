//go:build linux

package netroute

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"golang.org/x/sys/unix"
)

const (
	backendName       = "linux-netlink"
	netlinkHeaderSize = 16
	routeMessageSize  = 12
	routeAttrMask     = 0x3fff
	linuxRTA_NHID     = 30
)

func lookupPlatform(ctx context.Context, destination netip.Addr, result Result) (Result, error) {
	fd, err := unix.Socket(unix.AF_NETLINK, unix.SOCK_RAW|unix.SOCK_CLOEXEC|unix.SOCK_NONBLOCK, unix.NETLINK_ROUTE)
	if err != nil {
		return result, fmt.Errorf("open route netlink socket: %w", err)
	}
	defer unix.Close(fd)

	if err := unix.Bind(fd, &unix.SockaddrNetlink{Family: unix.AF_NETLINK}); err != nil {
		return result, fmt.Errorf("bind route netlink socket: %w", err)
	}
	bound, err := unix.Getsockname(fd)
	if err != nil {
		return result, fmt.Errorf("read route netlink port ID: %w", err)
	}
	boundNetlink, ok := bound.(*unix.SockaddrNetlink)
	if !ok || boundNetlink.Pid == 0 {
		return result, fmt.Errorf("route netlink socket has an invalid port ID")
	}
	sequence := uint32(time.Now().UnixNano())
	request, err := marshalLinuxRouteRequest(destination, sequence, boundNetlink.Pid)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if err := unix.Sendto(fd, request, 0, &unix.SockaddrNetlink{Family: unix.AF_NETLINK}); err != nil {
		return result, fmt.Errorf("request selected route: %w", err)
	}

	buffer := make([]byte, 32<<10)
	for {
		if err := waitReadable(ctx, fd); err != nil {
			return result, err
		}
		n, _, flags, sender, err := unix.Recvmsg(fd, buffer, nil, unix.MSG_TRUNC)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read selected route: %w", err)
		}
		if flags&unix.MSG_TRUNC != 0 || n > len(buffer) {
			return result, fmt.Errorf("kernel route response exceeded %d bytes", len(buffer))
		}
		netlinkSender, ok := sender.(*unix.SockaddrNetlink)
		if !ok || netlinkSender.Pid != 0 || netlinkSender.Groups != 0 {
			return result, fmt.Errorf("reject route response from non-kernel sender")
		}
		parsed, found, err := parseLinuxRouteResponse(buffer[:n], sequence, boundNetlink.Pid, destination, result)
		if err != nil {
			return result, err
		}
		if found {
			return parsed, nil
		}
	}
}

func marshalLinuxRouteRequest(destination netip.Addr, sequence, portID uint32) ([]byte, error) {
	family := byte(unix.AF_INET6)
	prefix := byte(128)
	v6 := destination.As16()
	address := v6[:]
	if destination.Is4() {
		family = unix.AF_INET
		prefix = 32
		v4 := destination.As4()
		address = v4[:]
	}

	attributes := marshalRouteAttribute(unix.RTA_DST, address)
	if destination.Zone() != "" {
		iface, err := interfaceForZone(destination.Zone())
		if err != nil {
			return nil, err
		}
		var index [4]byte
		binary.NativeEndian.PutUint32(index[:], uint32(iface))
		attributes = append(attributes, marshalRouteAttribute(unix.RTA_OIF, index[:])...)
	}

	length := netlinkHeaderSize + routeMessageSize + len(attributes)
	request := make([]byte, length)
	binary.NativeEndian.PutUint32(request[0:4], uint32(length))
	binary.NativeEndian.PutUint16(request[4:6], unix.RTM_GETROUTE)
	binary.NativeEndian.PutUint16(request[6:8], unix.NLM_F_REQUEST)
	binary.NativeEndian.PutUint32(request[8:12], sequence)
	binary.NativeEndian.PutUint32(request[12:16], portID)
	request[16] = family
	request[17] = prefix
	request[20] = unix.RT_TABLE_UNSPEC
	copy(request[netlinkHeaderSize+routeMessageSize:], attributes)
	return request, nil
}

func interfaceForZone(zone string) (int, error) {
	iface, err := netInterfaceByZone(zone)
	if err != nil {
		return 0, fmt.Errorf("resolve IPv6 zone %q: %w", zone, err)
	}
	return iface, nil
}

func parseLinuxRouteResponse(data []byte, sequence, portID uint32, destination netip.Addr, base Result) (Result, bool, error) {
	for len(data) > 0 {
		if len(data) < netlinkHeaderSize {
			return base, false, fmt.Errorf("short netlink header")
		}
		length := int(binary.NativeEndian.Uint32(data[0:4]))
		if length < netlinkHeaderSize || length > len(data) {
			return base, false, fmt.Errorf("invalid netlink message length %d", length)
		}
		message := data[:length]
		if binary.NativeEndian.Uint32(message[8:12]) != sequence {
			return base, false, fmt.Errorf("route response sequence mismatch")
		}
		if binary.NativeEndian.Uint32(message[12:16]) != portID {
			return base, false, fmt.Errorf("route response port ID mismatch")
		}

		switch binary.NativeEndian.Uint16(message[4:6]) {
		case unix.NLMSG_ERROR:
			if len(message) < netlinkHeaderSize+4 {
				return base, false, fmt.Errorf("short netlink error response")
			}
			code := int32(binary.NativeEndian.Uint32(message[16:20]))
			if code != 0 {
				return base, false, fmt.Errorf("kernel route lookup: %w", unix.Errno(-code))
			}
		case unix.NLMSG_DONE:
			return base, false, fmt.Errorf("kernel route lookup completed without a route")
		case unix.RTM_NEWROUTE:
			result, err := parseLinuxRouteMessage(message[netlinkHeaderSize:], destination, base)
			return result, err == nil, err
		default:
			return base, false, fmt.Errorf("unexpected netlink route response type %d", binary.NativeEndian.Uint16(message[4:6]))
		}

		aligned := align4(length)
		if aligned > len(data) {
			if length == len(data) {
				return base, false, nil
			}
			return base, false, fmt.Errorf("truncated netlink alignment padding")
		}
		data = data[aligned:]
	}
	return base, false, nil
}

func parseLinuxRouteMessage(data []byte, destination netip.Addr, result Result) (Result, error) {
	if len(data) < routeMessageSize {
		return result, fmt.Errorf("short route message")
	}
	family := data[0]
	if destination.Is4() && family != unix.AF_INET || destination.Is6() && family != unix.AF_INET6 {
		return result, fmt.Errorf("route response family does not match destination")
	}
	prefix := int(data[1])
	maxPrefix := 128
	if destination.Is4() {
		maxPrefix = 32
	}
	if prefix < 0 || prefix > maxPrefix {
		return result, fmt.Errorf("invalid route prefix %d", prefix)
	}
	result.Prefix = intPointer(prefix)
	routeType := data[7]
	if routeType != unix.RTN_UNICAST && routeType != unix.RTN_LOCAL {
		return result, fmt.Errorf("kernel selected non-forwarding route type %d", routeType)
	}
	result.Local = routeType == unix.RTN_LOCAL
	result.Notes = append(result.Notes, "Linux prefix is the resolved RTM_GETROUTE destination prefix; ProtoPeek does not dump the routing table")
	table := int(data[4])
	if table != unix.RT_TABLE_UNSPEC {
		result.Table = intPointer(table)
	}

	attributes, err := parseRouteAttributes(data[routeMessageSize:])
	if err != nil {
		return result, err
	}
	// A top-level missing gateway means on-link only when the kernel response
	// does not defer next-hop selection to one of these richer attributes.
	// Returning an explicit unsupported error is safer than inventing route
	// evidence for ECMP or cross-family routes that this result model cannot
	// faithfully represent yet.
	if _, ok := attributes[unix.RTA_MULTIPATH]; ok {
		return result, fmt.Errorf("kernel selected a multipath route; ECMP next-hop evidence is not represented yet")
	}
	if _, ok := attributes[unix.RTA_VIA]; ok {
		return result, fmt.Errorf("kernel selected a cross-family RTA_VIA next hop that is not represented yet")
	}
	if _, ok := attributes[linuxRTA_NHID]; ok {
		return result, fmt.Errorf("kernel selected a next-hop object (RTA_NH_ID) that is not represented yet")
	}
	if payload, ok := attributes[unix.RTA_TABLE]; ok {
		value, err := uint32Attribute("route table", payload)
		if err != nil {
			return result, err
		}
		result.Table = intPointer(int(value))
	}
	if payload, ok := attributes[unix.RTA_PRIORITY]; ok {
		value, err := uint32Attribute("route metric", payload)
		if err != nil {
			return result, err
		}
		result.RouteMetric = intPointer(int(value))
	}
	if payload, ok := attributes[unix.RTA_OIF]; ok {
		value, err := uint32Attribute("output interface", payload)
		if err != nil || value == 0 {
			if err == nil {
				err = fmt.Errorf("output interface is zero")
			}
			return result, err
		}
		interfaceEvidence(&result, int(value))
	}
	if payload, ok := attributes[unix.RTA_PREFSRC]; ok {
		address, err := addressAttribute(payload, family)
		if err != nil {
			return result, fmt.Errorf("preferred source: %w", err)
		}
		result.SourceIP = addressWithInterfaceZone(address, result.InterfaceName, result.InterfaceIndex)
	}
	if payload, ok := attributes[unix.RTA_GATEWAY]; ok {
		gateway, err := addressAttribute(payload, family)
		if err != nil {
			return result, fmt.Errorf("next hop: %w", err)
		}
		if gateway.IsValid() && !gateway.IsUnspecified() {
			result.NextHop = addressWithInterfaceZone(gateway, result.InterfaceName, result.InterfaceIndex)
		}
	}
	result.OnLink = result.NextHop == ""
	return result, nil
}

func parseRouteAttributes(data []byte) (map[uint16][]byte, error) {
	attributes := make(map[uint16][]byte)
	for len(data) > 0 {
		if len(data) < 4 {
			return nil, fmt.Errorf("short route attribute header")
		}
		length := int(binary.NativeEndian.Uint16(data[0:2]))
		if length < 4 || length > len(data) {
			return nil, fmt.Errorf("invalid route attribute length %d", length)
		}
		kind := binary.NativeEndian.Uint16(data[2:4]) & routeAttrMask
		if _, exists := attributes[kind]; !exists {
			attributes[kind] = data[4:length]
		}
		aligned := align4(length)
		if aligned > len(data) {
			if length == len(data) {
				break
			}
			return nil, fmt.Errorf("truncated route attribute alignment padding")
		}
		data = data[aligned:]
	}
	return attributes, nil
}

func marshalRouteAttribute(kind uint16, payload []byte) []byte {
	length := 4 + len(payload)
	attribute := make([]byte, align4(length))
	binary.NativeEndian.PutUint16(attribute[0:2], uint16(length))
	binary.NativeEndian.PutUint16(attribute[2:4], kind)
	copy(attribute[4:], payload)
	return attribute
}

func uint32Attribute(name string, payload []byte) (uint32, error) {
	if len(payload) != 4 {
		return 0, fmt.Errorf("%s attribute has length %d", name, len(payload))
	}
	return binary.NativeEndian.Uint32(payload), nil
}

func addressAttribute(payload []byte, family byte) (netip.Addr, error) {
	switch family {
	case unix.AF_INET:
		if len(payload) != 4 {
			return netip.Addr{}, fmt.Errorf("IPv4 attribute has length %d", len(payload))
		}
		return netip.AddrFrom4([4]byte(payload)), nil
	case unix.AF_INET6:
		if len(payload) != 16 {
			return netip.Addr{}, fmt.Errorf("IPv6 attribute has length %d", len(payload))
		}
		return netip.AddrFrom16([16]byte(payload)), nil
	default:
		return netip.Addr{}, fmt.Errorf("unknown address family %d", family)
	}
}

func waitReadable(ctx context.Context, fd int) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		timeout := 100
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return context.DeadlineExceeded
			}
			if remaining < 100*time.Millisecond {
				timeout = max(1, int((remaining+time.Millisecond-1)/time.Millisecond))
			}
		}
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		n, err := unix.Poll(fds, timeout)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("wait for route response: %w", err)
		}
		if n > 0 {
			if fds[0].Revents&(unix.POLLERR|unix.POLLHUP|unix.POLLNVAL) != 0 {
				return fmt.Errorf("route netlink socket reported poll error %#x", fds[0].Revents)
			}
			if fds[0].Revents&unix.POLLIN != 0 {
				return nil
			}
		}
	}
}

func align4(length int) int { return (length + 3) &^ 3 }

func intPointer(value int) *int { return &value }
