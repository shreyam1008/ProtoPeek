package thispc

import (
	"net/netip"
	"strings"
)

func isListenerSocket(socket Socket) bool {
	if socket.State == "LISTEN" {
		return true
	}
	return strings.HasPrefix(socket.Protocol, "udp") && socket.State == "UNCONNECTED" && socket.Remote.Wildcard && socket.Remote.Port == 0
}

func socketExposure(local Endpoint) string {
	address, err := netip.ParseAddr(local.Address)
	if err != nil {
		return "unknown"
	}
	address = address.Unmap()
	switch {
	case local.Wildcard || address.IsUnspecified():
		return "all-interfaces"
	case address.IsLoopback():
		return "loopback-only"
	case address.IsValid():
		return "interface-bound"
	default:
		return "unknown"
	}
}

func deduplicateNotes(input []string) []string {
	seen := make(map[string]struct{}, len(input))
	result := make([]string, 0, len(input))
	for _, note := range input {
		if _, exists := seen[note]; exists {
			continue
		}
		seen[note] = struct{}{}
		result = append(result, note)
	}
	return result
}
