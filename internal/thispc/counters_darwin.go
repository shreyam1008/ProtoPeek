//go:build darwin

package thispc

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"sort"
	"unsafe"

	"golang.org/x/sys/unix"
)

const maxDarwinInterfaceBytes = 1 << 20

type darwinCounterDependencies struct {
	interfaces func() ([]net.Interface, error)
	read       func(int) ([]byte, error)
}

func platformTrafficCapability() (bool, string) { return true, "" }

func newCounterReader() counterReader {
	return (darwinCounterDependencies{interfaces: net.Interfaces, read: func(index int) ([]byte, error) {
		// One selected interface per query avoids a process-wide routing-table dump.
		return unix.SysctlRaw("net", unix.AF_ROUTE, 0, 0, unix.NET_RT_IFLIST2, index)
	}}).collect
}

func (d darwinCounterDependencies) collect(ctx context.Context) (map[string]rawCounters, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	interfaces, err := d.interfaces()
	if err != nil {
		return nil, fmt.Errorf("enumerate Darwin interfaces: %w", err)
	}
	sort.Slice(interfaces, func(i, j int) bool { return interfaces[i].Index < interfaces[j].Index })
	var first error
	if len(interfaces) > maxSnapshotInterfaces {
		first = fmt.Errorf("Darwin counter list exceeded %d interfaces", maxSnapshotInterfaces)
		interfaces = interfaces[:maxSnapshotInterfaces]
	}
	result := make(map[string]rawCounters)
	for _, iface := range interfaces {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if iface.Index < 1 || iface.Index > 65535 || iface.Name == "" || len(iface.Name) > 255 {
			if first == nil {
				first = fmt.Errorf("invalid Darwin interface identity")
			}
			continue
		}
		if _, exists := result[iface.Name]; exists {
			return result, fmt.Errorf("duplicate Darwin interface name")
		}
		raw, err := d.read(iface.Index)
		if err == nil {
			var counters rawCounters
			counters, err = parseDarwinInterfaceCounters(raw, iface.Index)
			if err == nil {
				result[iface.Name] = counters
			}
		}
		if err != nil && first == nil {
			first = fmt.Errorf("Darwin interface %q counters: %w", iface.Name, err)
		}
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if len(result) == 0 && first == nil {
		first = fmt.Errorf("Darwin returned no interface counters")
	}
	return result, first
}

func parseDarwinInterfaceCounters(raw []byte, index int) (rawCounters, error) {
	if len(raw) > maxDarwinInterfaceBytes {
		return rawCounters{}, fmt.Errorf("interface evidence exceeded 1 MiB")
	}
	var counters rawCounters
	found := false
	for len(raw) > 0 {
		if len(raw) < 4 {
			return counters, fmt.Errorf("truncated Darwin interface message")
		}
		size := int(binary.NativeEndian.Uint16(raw[:2]))
		if size < 4 || size > len(raw) {
			return counters, fmt.Errorf("invalid Darwin interface message size")
		}
		message := raw[:size]
		raw = raw[size:]
		if message[3] != unix.RTM_IFINFO2 {
			continue
		}
		if len(message) < unix.SizeofIfMsghdr2 || message[2] != unix.RTM_VERSION {
			return counters, fmt.Errorf("unknown Darwin interface counter ABI")
		}
		var header unix.IfMsghdr2
		// This generated, pointer-free ABI struct includes native padding. Copying
		// avoids unaligned pointer reads and encoding/binary's omission of padding.
		copy(unsafe.Slice((*byte)(unsafe.Pointer(&header)), unix.SizeofIfMsghdr2), message[:unix.SizeofIfMsghdr2])
		if int(header.Index) != index {
			continue
		}
		if found || header.Snd_drops < 0 {
			return counters, fmt.Errorf("ambiguous or invalid Darwin counters")
		}
		found = true
		data := header.Data
		counters = rawCounters{receivedBytes: data.Ibytes, receivedPackets: data.Ipackets, receivedErrors: data.Ierrors, receivedDropped: data.Iqdrops,
			transmittedBytes: data.Obytes, transmittedPackets: data.Opackets, transmittedErrors: data.Oerrors, transmittedDropped: uint64(header.Snd_drops)}
	}
	if !found {
		return counters, fmt.Errorf("selected Darwin interface counter message not found")
	}
	return counters, nil
}
