//go:build windows

package thispc

import (
	"context"
	"fmt"
	"math"
	"net"
	"sort"

	"golang.org/x/sys/windows"
)

type windowsCounterDependencies struct {
	interfaces func() ([]net.Interface, error)
	getIfEntry func(*windows.MibIfRow2) error
}

func platformTrafficCapability() (bool, string) { return true, "" }

func newCounterReader() counterReader {
	dependencies := windowsCounterDependencies{
		interfaces: net.Interfaces,
		getIfEntry: checkedWindowsGetIfEntry2,
	}
	return dependencies.read
}

func (dependencies windowsCounterDependencies) read(ctx context.Context) (map[string]rawCounters, error) {
	if dependencies.interfaces == nil || dependencies.getIfEntry == nil {
		return nil, fmt.Errorf("Windows interface-counter dependencies are incomplete")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	interfaces, err := dependencies.interfaces()
	if err != nil {
		return nil, fmt.Errorf("enumerate Windows network interfaces: %w", err)
	}
	sort.Slice(interfaces, func(left, right int) bool {
		if interfaces[left].Index != interfaces[right].Index {
			return interfaces[left].Index < interfaces[right].Index
		}
		return interfaces[left].Name < interfaces[right].Name
	})
	failures := 0
	var firstFailure error
	if len(interfaces) > maxSnapshotInterfaces {
		failures += len(interfaces) - maxSnapshotInterfaces
		firstFailure = fmt.Errorf("Windows interface list exceeded %d entries", maxSnapshotInterfaces)
		interfaces = interfaces[:maxSnapshotInterfaces]
	}
	result := make(map[string]rawCounters, len(interfaces))
	for _, networkInterface := range interfaces {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if networkInterface.Index < 1 || uint64(networkInterface.Index) > uint64(math.MaxUint32) {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("invalid Windows interface index %d", networkInterface.Index)
			}
			continue
		}
		if networkInterface.Name == "" {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("Windows interface %d has an empty name", networkInterface.Index)
			}
			continue
		}
		if _, duplicate := result[networkInterface.Name]; duplicate {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("duplicate Windows interface name %q", boundedText(networkInterface.Name, 255))
			}
			continue
		}
		row := windows.MibIfRow2{InterfaceIndex: uint32(networkInterface.Index)}
		if err := dependencies.getIfEntry(&row); err != nil {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("interface %q counters: %w", boundedText(networkInterface.Name, 255), err)
			}
			continue
		}
		receivedPackets, ok := addWindowsCounters(row.InUcastPkts, row.InNUcastPkts)
		if !ok {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("interface %q receive packet counters overflow uint64", boundedText(networkInterface.Name, 255))
			}
			continue
		}
		transmittedPackets, ok := addWindowsCounters(row.OutUcastPkts, row.OutNUcastPkts)
		if !ok {
			failures++
			if firstFailure == nil {
				firstFailure = fmt.Errorf("interface %q transmit packet counters overflow uint64", boundedText(networkInterface.Name, 255))
			}
			continue
		}
		result[networkInterface.Name] = rawCounters{
			receivedBytes:      row.InOctets,
			receivedPackets:    receivedPackets,
			receivedErrors:     row.InErrors,
			receivedDropped:    row.InDiscards,
			transmittedBytes:   row.OutOctets,
			transmittedPackets: transmittedPackets,
			transmittedErrors:  row.OutErrors,
			transmittedDropped: row.OutDiscards,
		}
	}
	if len(result) == 0 {
		if firstFailure != nil {
			return nil, fmt.Errorf("no Windows interface counters were available: %w", firstFailure)
		}
		return nil, fmt.Errorf("Windows reported no network interfaces with counters")
	}
	if failures > 0 {
		return result, fmt.Errorf("%d Windows interface counter entries were unavailable; first failure: %w", failures, firstFailure)
	}
	return result, nil
}

func addWindowsCounters(left, right uint64) (uint64, bool) {
	if math.MaxUint64-left < right {
		return 0, false
	}
	return left + right, true
}
