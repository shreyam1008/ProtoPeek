package netroute

import (
	"fmt"
	"net"
	"net/netip"
	"strconv"
)

func netInterfaceByZone(zone string) (int, error) {
	if index, err := strconv.Atoi(zone); err == nil {
		if index <= 0 {
			return 0, fmt.Errorf("interface index must be positive")
		}
		if _, err := net.InterfaceByIndex(index); err != nil {
			return 0, err
		}
		return index, nil
	}
	iface, err := net.InterfaceByName(zone)
	if err != nil {
		return 0, err
	}
	return iface.Index, nil
}

func addressWithInterfaceZone(address netip.Addr, interfaceName string, interfaceIndex int) string {
	if !address.Is6() || !address.IsLinkLocalUnicast() && !address.IsLinkLocalMulticast() {
		return address.String()
	}
	zone := interfaceName
	if zone == "" && interfaceIndex > 0 {
		zone = strconv.Itoa(interfaceIndex)
	}
	if zone == "" {
		return address.String()
	}
	return address.WithZone(zone).String()
}

func prefixLength(mask []byte) (int, error) {
	bits := 0
	seenZero := false
	for _, value := range mask {
		for bit := 7; bit >= 0; bit-- {
			one := value&(1<<bit) != 0
			if one && seenZero {
				return 0, fmt.Errorf("route netmask is not contiguous")
			}
			if one {
				bits++
			} else {
				seenZero = true
			}
		}
	}
	return bits, nil
}
