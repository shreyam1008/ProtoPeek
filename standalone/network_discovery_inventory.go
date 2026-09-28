package standalone

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

const maxNetworkInventoryDevices = 256

// NetworkNeighborInventory is read-only OS evidence. A cache record is neither
// a current reachability check nor a complete inventory of the local network.
type NetworkNeighborInventory struct {
	ObservedAt            string                  `json:"observedAt"`
	Status                string                  `json:"status"`
	Source                string                  `json:"source"`
	DefaultInterfaceIndex int                     `json:"defaultInterfaceIndex"`
	DefaultGateway        string                  `json:"defaultGateway"`
	Devices               []NetworkNeighborDevice `json:"devices"`
	Warnings              []string                `json:"warnings"`
}

type NetworkNeighborDevice struct {
	Address        string `json:"address"`
	InterfaceIndex int    `json:"interfaceIndex"`
	InterfaceName  string `json:"interfaceName"`
	MAC            string `json:"mac"`
	Hostname       string `json:"hostname"`
	Kind           string `json:"kind"`
	State          string `json:"state"`
	Source         string `json:"source"`
}

type networkNeighborRecord struct {
	address        string
	mac            string
	interfaceIndex int
	interfaceName  string
}

func collectNetworkNeighborInventory(ctx context.Context, interfaces []NetworkInterfaceSuggestion) NetworkNeighborInventory {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	hostname, _ := os.Hostname()
	// This asks the kernel which route it would select. It sends no packet to
	// this address, does not resolve a name, and does not test Internet access.
	route := netroute.Lookup(ctx, netip.MustParseAddr("1.1.1.1"))
	neighbors, err := readNetworkNeighborRecords(ctx)
	return buildNetworkNeighborInventory(interfaces, hostname, route, neighbors, err)
}

func buildNetworkNeighborInventory(interfaces []NetworkInterfaceSuggestion, hostname string, route netroute.Result, neighbors []networkNeighborRecord, readErr error) NetworkNeighborInventory {
	inventory := NetworkNeighborInventory{
		ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Status:     "available", Source: "os-neighbor-cache",
		Devices: make([]NetworkNeighborDevice, 0),
		Warnings: []string{
			"Read-only local interface and IPv4 neighbor-cache records; no discovery packets were sent.",
			"Cached neighbors can be stale or incomplete. Missing devices may be sleeping, isolated, on another network, or absent from this computer's cache.",
			"Names are shown only for this computer. Device advertisements (mDNS, SSDP, and NetBIOS), vendor identity, and other devices' traffic are not collected here.",
		},
	}
	if !utf8.ValidString(hostname) || len(hostname) > 253 || strings.ContainsRune(hostname, '\x00') {
		hostname = ""
	}
	seen := make(map[string]bool)
	for _, iface := range interfaces {
		key := fmt.Sprintf("%d:%s", iface.Index, iface.Address)
		seen[key] = true
		inventory.Devices = append(inventory.Devices, NetworkNeighborDevice{
			Address: iface.Address, InterfaceIndex: iface.Index, InterfaceName: iface.Name,
			Hostname: hostname, Kind: "self", State: "local", Source: "local-interface",
		})
		if route.Status == "ok" && route.InterfaceIndex == iface.Index &&
			(route.SourceIP == "" || route.SourceIP == iface.Address) {
			inventory.DefaultInterfaceIndex = iface.Index
			if gateway, err := netip.ParseAddr(route.NextHop); err == nil && gateway.Is4() && gateway.IsPrivate() {
				inventory.DefaultGateway = gateway.String()
			}
		}
	}
	if route.Status != "ok" {
		inventory.Warnings = append(inventory.Warnings, "The default route could not be read; choose from the available local networks.")
	}
	for _, neighbor := range neighbors {
		address, addressErr := netip.ParseAddr(neighbor.address)
		mac, macErr := net.ParseMAC(strings.ReplaceAll(neighbor.mac, "-", ":"))
		if addressErr != nil || !address.Is4() || !address.IsPrivate() || macErr != nil || len(mac) != 6 || mac[0]&1 != 0 || mac.String() == "00:00:00:00:00:00" {
			continue
		}
		for _, iface := range interfaces {
			if neighbor.interfaceIndex != 0 && neighbor.interfaceIndex != iface.Index || neighbor.interfaceName != "" && neighbor.interfaceName != iface.Name {
				continue
			}
			prefix, err := netip.ParsePrefix(iface.InterfaceCIDR)
			if err != nil || !prefix.Contains(address) {
				continue
			}
			// Reject IPv4 subnet and broadcast pseudo-neighbors.
			if prefix.Bits() < 31 {
				bytes := address.As4()
				value := uint32(bytes[0])<<24 | uint32(bytes[1])<<16 | uint32(bytes[2])<<8 | uint32(bytes[3])
				hostMask := uint32(1)<<(32-prefix.Bits()) - 1
				if value&hostMask == 0 || value&hostMask == hostMask {
					continue
				}
			}
			key := fmt.Sprintf("%d:%s", iface.Index, address)
			if seen[key] {
				continue
			}
			seen[key] = true
			if len(inventory.Devices) >= maxNetworkInventoryDevices {
				inventory.Status = "partial"
				continue
			}
			inventory.Devices = append(inventory.Devices, NetworkNeighborDevice{
				Address: address.String(), InterfaceIndex: iface.Index, InterfaceName: iface.Name,
				MAC: mac.String(), Kind: "neighbor", State: "cached", Source: "os-neighbor-cache",
			})
		}
	}
	if inventory.Status == "partial" {
		inventory.Warnings = append(inventory.Warnings, "Neighbor inventory is limited to 256 records; additional cached entries were omitted.")
	}
	if readErr != nil {
		inventory.Status = "partial"
		if len(inventory.Devices) == 0 {
			inventory.Status = "unavailable"
		}
		inventory.Warnings = append(inventory.Warnings, "The operating-system neighbor cache is unavailable. Local interface addresses are still shown; use Scan network to check selected service ports.")
	}
	sort.SliceStable(inventory.Devices, func(i, j int) bool {
		a, b := inventory.Devices[i], inventory.Devices[j]
		if a.Kind != b.Kind {
			return a.Kind == "self"
		}
		if a.InterfaceIndex != b.InterfaceIndex {
			return a.InterfaceIndex < b.InterfaceIndex
		}
		return netip.MustParseAddr(a.Address).Less(netip.MustParseAddr(b.Address))
	})
	return inventory
}

var windowsARPInterface = regexp.MustCompile(`:\s*\d+\.\d+\.\d+\.\d+\s+---\s+0x([0-9a-fA-F]+)`)

func parseWindowsNetworkNeighbors(raw string) []networkNeighborRecord {
	result := []networkNeighborRecord{}
	index := 0
	for _, line := range strings.Split(raw, "\n") {
		if matches := windowsARPInterface.FindStringSubmatch(line); len(matches) == 2 {
			parsed, _ := strconv.ParseInt(matches[1], 16, 32)
			index = int(parsed)
			continue
		}
		fields := strings.Fields(line)
		if index > 0 && len(fields) >= 2 {
			if address, err := netip.ParseAddr(fields[0]); err == nil && address.Is4() {
				result = append(result, networkNeighborRecord{address: address.String(), mac: fields[1], interfaceIndex: index})
			}
		}
	}
	return result
}

func parseLinuxNetworkNeighbors(raw string) []networkNeighborRecord {
	result := []networkNeighborRecord{}
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 6 {
			continue
		}
		flags, err := strconv.ParseUint(strings.TrimPrefix(fields[2], "0x"), 16, 32)
		if err != nil || flags&2 == 0 {
			continue
		}
		result = append(result, networkNeighborRecord{address: fields[0], mac: fields[3], interfaceName: fields[5]})
	}
	return result
}

func parseDarwinNetworkNeighbors(raw string) []networkNeighborRecord {
	result := []networkNeighborRecord{}
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[2] != "at" || fields[4] != "on" {
			continue
		}
		macParts := strings.Split(fields[3], ":")
		for index, part := range macParts {
			if len(part) == 1 {
				macParts[index] = "0" + part
			}
		}
		result = append(result, networkNeighborRecord{
			address: strings.Trim(fields[1], "()"), mac: strings.Join(macParts, ":"), interfaceName: fields[5],
		})
	}
	return result
}
