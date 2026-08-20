//go:build darwin

package netroute

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"time"

	"golang.org/x/net/route"
	"golang.org/x/sys/unix"
)

const backendName = "darwin-route-socket"

func lookupPlatform(ctx context.Context, destination netip.Addr, result Result) (Result, error) {
	fd, err := unix.Socket(unix.AF_ROUTE, unix.SOCK_RAW, unix.AF_UNSPEC)
	if err != nil {
		return result, fmt.Errorf("open routing socket: %w", err)
	}
	defer unix.Close(fd)
	unix.CloseOnExec(fd)
	if err := unix.SetNonblock(fd, true); err != nil {
		return result, fmt.Errorf("make routing socket non-blocking: %w", err)
	}

	sequence := int(time.Now().UnixNano() & 0x7fffffff)
	processID := os.Getpid()
	destinationAddr, err := darwinRouteAddress(destination)
	if err != nil {
		return result, err
	}
	message := &route.RouteMessage{
		Version: unix.RTM_VERSION,
		Type:    unix.RTM_GET,
		ID:      uintptr(processID),
		Seq:     sequence,
		Addrs:   []route.Addr{destinationAddr},
	}
	encoded, err := message.Marshal()
	if err != nil {
		return result, fmt.Errorf("encode routing-socket request: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	written, err := unix.Write(fd, encoded)
	if err != nil {
		return result, fmt.Errorf("request selected route: %w", err)
	}
	if written != len(encoded) {
		return result, fmt.Errorf("request selected route: short routing-socket write %d of %d bytes", written, len(encoded))
	}

	buffer := make([]byte, 32<<10)
	for {
		if err := waitDarwinReadable(ctx, fd); err != nil {
			return result, err
		}
		n, err := unix.Read(fd, buffer)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read selected route: %w", err)
		}
		messages, err := route.ParseRIB(route.RIBTypeRoute, buffer[:n])
		if err != nil {
			return result, fmt.Errorf("parse routing-socket response: %w", err)
		}
		for _, parsed := range messages {
			routeMessage, ok := parsed.(*route.RouteMessage)
			if !ok || routeMessage.ID != uintptr(processID) || routeMessage.Seq != sequence {
				continue
			}
			if routeMessage.Type != unix.RTM_GET {
				return result, fmt.Errorf("unexpected routing-socket response type %d", routeMessage.Type)
			}
			if routeMessage.Err != nil {
				return result, fmt.Errorf("kernel route lookup: %w", routeMessage.Err)
			}
			return parseDarwinRouteMessage(routeMessage, destination, result)
		}
	}
}

func darwinRouteAddress(destination netip.Addr) (route.Addr, error) {
	if destination.Is4() {
		return &route.Inet4Addr{IP: destination.As4()}, nil
	}
	address := &route.Inet6Addr{IP: destination.As16()}
	if destination.Zone() != "" {
		index, err := netInterfaceByZone(destination.Zone())
		if err != nil {
			return nil, fmt.Errorf("resolve IPv6 zone %q: %w", destination.Zone(), err)
		}
		address.ZoneID = index
	}
	return address, nil
}

func parseDarwinRouteMessage(message *route.RouteMessage, destination netip.Addr, result Result) (Result, error) {
	if message.Flags&(unix.RTF_REJECT|unix.RTF_BLACKHOLE) != 0 {
		return result, fmt.Errorf("kernel selected a rejecting or blackhole route")
	}
	interfaceIndex := message.Index
	if len(message.Addrs) > unix.RTAX_IFP {
		if link, ok := message.Addrs[unix.RTAX_IFP].(*route.LinkAddr); ok && link != nil {
			if link.Index > 0 {
				interfaceIndex = link.Index
			}
			result.InterfaceName = link.Name
		}
	}
	interfaceEvidence(&result, interfaceIndex)

	if len(message.Addrs) > unix.RTAX_IFA {
		if source, ok := darwinNetIP(message.Addrs[unix.RTAX_IFA], result.InterfaceName, interfaceIndex); ok {
			result.SourceIP = source
		}
	}
	if len(message.Addrs) > unix.RTAX_NETMASK && message.Addrs[unix.RTAX_NETMASK] != nil {
		mask, ok := darwinMask(message.Addrs[unix.RTAX_NETMASK], destination.Is4())
		if !ok {
			return result, fmt.Errorf("route response contains an invalid netmask family")
		}
		prefix, err := prefixLength(mask)
		if err != nil {
			return result, err
		}
		result.Prefix = intPointer(prefix)
	} else if message.Flags&unix.RTF_HOST != 0 {
		prefix := 128
		if destination.Is4() {
			prefix = 32
		}
		result.Prefix = intPointer(prefix)
	}
	result.Local = message.Flags&unix.RTF_LOCAL != 0
	if message.Flags&unix.RTF_GATEWAY != 0 && len(message.Addrs) > unix.RTAX_GATEWAY {
		if gateway, ok := darwinNetIP(message.Addrs[unix.RTAX_GATEWAY], result.InterfaceName, interfaceIndex); ok {
			if gateway != "0.0.0.0" && gateway != "::" {
				result.NextHop = gateway
			}
		}
	}
	result.OnLink = result.NextHop == ""
	result.Notes = append(result.Notes, "Darwin routing sockets do not expose a portable route metric or table identifier for this lookup")
	return result, nil
}

func darwinNetIP(value route.Addr, interfaceName string, interfaceIndex int) (string, bool) {
	switch address := value.(type) {
	case *route.Inet4Addr:
		return netip.AddrFrom4(address.IP).String(), true
	case *route.Inet6Addr:
		ip := netip.AddrFrom16(address.IP)
		index := interfaceIndex
		if address.ZoneID > 0 {
			index = address.ZoneID
		}
		return addressWithInterfaceZone(ip, interfaceName, index), true
	default:
		return "", false
	}
}

func darwinMask(value route.Addr, ipv4 bool) ([]byte, bool) {
	if ipv4 {
		address, ok := value.(*route.Inet4Addr)
		if !ok {
			return nil, false
		}
		return address.IP[:], true
	}
	address, ok := value.(*route.Inet6Addr)
	if !ok {
		return nil, false
	}
	return address.IP[:], true
}

func waitDarwinReadable(ctx context.Context, fd int) error {
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
		poll := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		n, err := unix.Poll(poll, timeout)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("wait for route response: %w", err)
		}
		if n > 0 && poll[0].Revents&unix.POLLIN != 0 {
			return nil
		}
		if n > 0 && poll[0].Revents&(unix.POLLERR|unix.POLLHUP|unix.POLLNVAL) != 0 {
			return fmt.Errorf("routing socket reported poll error %#x", poll[0].Revents)
		}
	}
}

func intPointer(value int) *int { return &value }
