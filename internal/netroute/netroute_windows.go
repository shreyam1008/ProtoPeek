//go:build windows

package netroute

import (
	"context"
	"fmt"
	"net/netip"
	"unsafe"

	"golang.org/x/sys/windows"
)

const backendName = "windows-getbestroute2"

var getBestRoute2 = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetBestRoute2")

func lookupPlatform(ctx context.Context, destination netip.Addr, result Result) (Result, error) {
	if err := ctx.Err(); err != nil {
		return result, err
	}
	destinationSockaddr, err := windowsSockaddr(destination)
	if err != nil {
		return result, err
	}
	var interfaceIndex uint32
	if err := windows.GetBestInterfaceEx(destinationSockaddr, &interfaceIndex); err != nil {
		return result, fmt.Errorf("GetBestInterfaceEx: %w", err)
	}
	if interfaceIndex == 0 {
		return result, fmt.Errorf("GetBestInterfaceEx returned interface index zero")
	}
	destinationAddress, err := windowsRawAddress(destination)
	if err != nil {
		return result, err
	}
	var row windows.MibIpForwardRow2
	var source windows.RawSockaddrInet
	status, _, _ := getBestRoute2.Call(
		0,
		uintptr(interfaceIndex),
		0,
		uintptr(unsafe.Pointer(&destinationAddress)),
		0,
		uintptr(unsafe.Pointer(&row)),
		uintptr(unsafe.Pointer(&source)),
	)
	if status != 0 {
		return result, fmt.Errorf("GetBestRoute2: %w", windows.Errno(status))
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}

	interfaceEvidence(&result, int(row.InterfaceIndex))
	sourceIP, err := windowsAddress(source, result.InterfaceName, result.InterfaceIndex)
	if err != nil {
		return result, fmt.Errorf("selected source address: %w", err)
	}
	if sourceIP != "0.0.0.0" && sourceIP != "::" {
		result.SourceIP = sourceIP
	}
	nextHop, err := windowsAddress(row.NextHop, result.InterfaceName, result.InterfaceIndex)
	if err != nil {
		return result, fmt.Errorf("selected next hop: %w", err)
	}
	if nextHop != "0.0.0.0" && nextHop != "::" {
		result.NextHop = nextHop
	}
	result.OnLink = result.NextHop == ""
	result.Local = row.Loopback != 0
	result.Prefix = intPointer(int(row.DestinationPrefix.PrefixLength))
	result.RouteMetric = intPointer(int(row.Metric))
	result.Notes = append(result.Notes, "Windows reports the route metric separately from the interface metric")
	return result, nil
}

func windowsSockaddr(address netip.Addr) (windows.Sockaddr, error) {
	if !address.IsValid() {
		return nil, fmt.Errorf("invalid destination address")
	}
	if address.Is4() {
		return &windows.SockaddrInet4{Addr: address.As4()}, nil
	}
	value := &windows.SockaddrInet6{Addr: address.As16()}
	if address.Zone() != "" {
		index, err := netInterfaceByZone(address.Zone())
		if err != nil {
			return nil, fmt.Errorf("resolve IPv6 zone %q: %w", address.Zone(), err)
		}
		value.ZoneId = uint32(index)
	}
	return value, nil
}

func windowsRawAddress(address netip.Addr) (windows.RawSockaddrInet, error) {
	var raw windows.RawSockaddrInet
	if address.Is4() {
		value := (*windows.RawSockaddrInet4)(unsafe.Pointer(&raw))
		value.Family = windows.AF_INET
		value.Addr = address.As4()
		return raw, nil
	}
	value := (*windows.RawSockaddrInet6)(unsafe.Pointer(&raw))
	value.Family = windows.AF_INET6
	value.Addr = address.As16()
	if address.Zone() != "" {
		index, err := netInterfaceByZone(address.Zone())
		if err != nil {
			return raw, fmt.Errorf("resolve IPv6 zone %q: %w", address.Zone(), err)
		}
		value.Scope_id = uint32(index)
	}
	return raw, nil
}

func windowsAddress(raw windows.RawSockaddrInet, interfaceName string, interfaceIndex int) (string, error) {
	switch raw.Family {
	case windows.AF_INET:
		value := (*windows.RawSockaddrInet4)(unsafe.Pointer(&raw))
		return netip.AddrFrom4(value.Addr).String(), nil
	case windows.AF_INET6:
		value := (*windows.RawSockaddrInet6)(unsafe.Pointer(&raw))
		address := netip.AddrFrom16(value.Addr)
		index := interfaceIndex
		if value.Scope_id > 0 {
			index = int(value.Scope_id)
		}
		return addressWithInterfaceZone(address, interfaceName, index), nil
	default:
		return "", fmt.Errorf("unknown address family %d", raw.Family)
	}
}

func intPointer(value int) *int { return &value }
