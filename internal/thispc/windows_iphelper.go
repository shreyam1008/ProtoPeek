//go:build windows

package thispc

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math/bits"
	"net/netip"
	"runtime"
	"strconv"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowsTCPTableOwnerPIDAll = 5
	windowsUDPTableOwnerPID    = 1

	maxWindowsSocketTableBytes = 4 << 20
	maxWindowsTableAttempts    = 3
)

type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPID  uint32
}

type mibTCP6RowOwnerPID struct {
	LocalAddr     [16]byte
	LocalScopeID  uint32
	LocalPort     uint32
	RemoteAddr    [16]byte
	RemoteScopeID uint32
	RemotePort    uint32
	State         uint32
	OwningPID     uint32
}

type mibUDPRowOwnerPID struct {
	LocalAddr uint32
	LocalPort uint32
	OwningPID uint32
}

type mibUDP6RowOwnerPID struct {
	LocalAddr    [16]byte
	LocalScopeID uint32
	LocalPort    uint32
	OwningPID    uint32
}

type mibTCPTableOwnerPID struct {
	Count uint32
	Table [1]mibTCPRowOwnerPID
}

type mibTCP6TableOwnerPID struct {
	Count uint32
	Table [1]mibTCP6RowOwnerPID
}

type mibUDPTableOwnerPID struct {
	Count uint32
	Table [1]mibUDPRowOwnerPID
}

type mibUDP6TableOwnerPID struct {
	Count uint32
	Table [1]mibUDP6RowOwnerPID
}

const (
	windowsTCPRowOwnerPIDSize  = int(unsafe.Sizeof(mibTCPRowOwnerPID{}))
	windowsTCP6RowOwnerPIDSize = int(unsafe.Sizeof(mibTCP6RowOwnerPID{}))
	windowsUDPRowOwnerPIDSize  = int(unsafe.Sizeof(mibUDPRowOwnerPID{}))
	windowsUDP6RowOwnerPIDSize = int(unsafe.Sizeof(mibUDP6RowOwnerPID{}))

	windowsTCPTableOffset  = int(unsafe.Offsetof(mibTCPTableOwnerPID{}.Table))
	windowsTCP6TableOffset = int(unsafe.Offsetof(mibTCP6TableOwnerPID{}.Table))
	windowsUDPTableOffset  = int(unsafe.Offsetof(mibUDPTableOwnerPID{}.Table))
	windowsUDP6TableOffset = int(unsafe.Offsetof(mibUDP6TableOwnerPID{}.Table))

	windowsTCPStateOffset      = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.State))
	windowsTCPLocalAddrOffset  = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.LocalAddr))
	windowsTCPLocalPortOffset  = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.LocalPort))
	windowsTCPRemoteAddrOffset = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.RemoteAddr))
	windowsTCPRemotePortOffset = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.RemotePort))
	windowsTCPOwningPIDOffset  = int(unsafe.Offsetof(mibTCPRowOwnerPID{}.OwningPID))

	windowsTCP6LocalAddrOffset   = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.LocalAddr))
	windowsTCP6LocalScopeOffset  = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.LocalScopeID))
	windowsTCP6LocalPortOffset   = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.LocalPort))
	windowsTCP6RemoteAddrOffset  = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.RemoteAddr))
	windowsTCP6RemoteScopeOffset = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.RemoteScopeID))
	windowsTCP6RemotePortOffset  = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.RemotePort))
	windowsTCP6StateOffset       = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.State))
	windowsTCP6OwningPIDOffset   = int(unsafe.Offsetof(mibTCP6RowOwnerPID{}.OwningPID))
	windowsUDPLocalAddrOffset    = int(unsafe.Offsetof(mibUDPRowOwnerPID{}.LocalAddr))
	windowsUDPLocalPortOffset    = int(unsafe.Offsetof(mibUDPRowOwnerPID{}.LocalPort))
	windowsUDPOwningPIDOffset    = int(unsafe.Offsetof(mibUDPRowOwnerPID{}.OwningPID))
	windowsUDP6LocalAddrOffset   = int(unsafe.Offsetof(mibUDP6RowOwnerPID{}.LocalAddr))
	windowsUDP6LocalScopeOffset  = int(unsafe.Offsetof(mibUDP6RowOwnerPID{}.LocalScopeID))
	windowsUDP6LocalPortOffset   = int(unsafe.Offsetof(mibUDP6RowOwnerPID{}.LocalPort))
	windowsUDP6OwningPIDOffset   = int(unsafe.Offsetof(mibUDP6RowOwnerPID{}.OwningPID))
)

// These paired assertions fail compilation if Go's Windows layout ever stops
// matching the SDK's DWORD/UCHAR owner-PID table ABI.
var (
	_ [24 - windowsTCPRowOwnerPIDSize]byte
	_ [windowsTCPRowOwnerPIDSize - 24]byte
	_ [56 - windowsTCP6RowOwnerPIDSize]byte
	_ [windowsTCP6RowOwnerPIDSize - 56]byte
	_ [12 - windowsUDPRowOwnerPIDSize]byte
	_ [windowsUDPRowOwnerPIDSize - 12]byte
	_ [28 - windowsUDP6RowOwnerPIDSize]byte
	_ [windowsUDP6RowOwnerPIDSize - 28]byte

	_ [4 - windowsTCPTableOffset]byte
	_ [windowsTCPTableOffset - 4]byte
	_ [4 - windowsTCP6TableOffset]byte
	_ [windowsTCP6TableOffset - 4]byte
	_ [4 - windowsUDPTableOffset]byte
	_ [windowsUDPTableOffset - 4]byte
	_ [4 - windowsUDP6TableOffset]byte
	_ [windowsUDP6TableOffset - 4]byte

	_ [0 - windowsTCPStateOffset]byte
	_ [windowsTCPStateOffset - 0]byte
	_ [4 - windowsTCPLocalAddrOffset]byte
	_ [windowsTCPLocalAddrOffset - 4]byte
	_ [8 - windowsTCPLocalPortOffset]byte
	_ [windowsTCPLocalPortOffset - 8]byte
	_ [12 - windowsTCPRemoteAddrOffset]byte
	_ [windowsTCPRemoteAddrOffset - 12]byte
	_ [16 - windowsTCPRemotePortOffset]byte
	_ [windowsTCPRemotePortOffset - 16]byte
	_ [20 - windowsTCPOwningPIDOffset]byte
	_ [windowsTCPOwningPIDOffset - 20]byte

	_ [0 - windowsTCP6LocalAddrOffset]byte
	_ [windowsTCP6LocalAddrOffset - 0]byte
	_ [16 - windowsTCP6LocalScopeOffset]byte
	_ [windowsTCP6LocalScopeOffset - 16]byte
	_ [20 - windowsTCP6LocalPortOffset]byte
	_ [windowsTCP6LocalPortOffset - 20]byte
	_ [24 - windowsTCP6RemoteAddrOffset]byte
	_ [windowsTCP6RemoteAddrOffset - 24]byte
	_ [40 - windowsTCP6RemoteScopeOffset]byte
	_ [windowsTCP6RemoteScopeOffset - 40]byte
	_ [44 - windowsTCP6RemotePortOffset]byte
	_ [windowsTCP6RemotePortOffset - 44]byte
	_ [48 - windowsTCP6StateOffset]byte
	_ [windowsTCP6StateOffset - 48]byte
	_ [52 - windowsTCP6OwningPIDOffset]byte
	_ [windowsTCP6OwningPIDOffset - 52]byte

	_ [0 - windowsUDPLocalAddrOffset]byte
	_ [windowsUDPLocalAddrOffset - 0]byte
	_ [4 - windowsUDPLocalPortOffset]byte
	_ [windowsUDPLocalPortOffset - 4]byte
	_ [8 - windowsUDPOwningPIDOffset]byte
	_ [windowsUDPOwningPIDOffset - 8]byte

	_ [0 - windowsUDP6LocalAddrOffset]byte
	_ [windowsUDP6LocalAddrOffset - 0]byte
	_ [16 - windowsUDP6LocalScopeOffset]byte
	_ [windowsUDP6LocalScopeOffset - 16]byte
	_ [20 - windowsUDP6LocalPortOffset]byte
	_ [windowsUDP6LocalPortOffset - 20]byte
	_ [24 - windowsUDP6OwningPIDOffset]byte
	_ [windowsUDP6OwningPIDOffset - 24]byte
)

type windowsTableCall func([]byte, *uint32, uint32, uint32) error

type windowsSocketRecord struct {
	protocol string
	state    string
	local    Endpoint
	remote   Endpoint
	ownerPID uint32
}

type windowsParsedSocketTable struct {
	records       []windowsSocketRecord
	truncated     bool
	unknownStates int
	malformedRows int
}

var (
	windowsIPHelperDLL          = windows.NewLazySystemDLL("iphlpapi.dll")
	windowsExtendedTCPTableProc = windowsIPHelperDLL.NewProc("GetExtendedTcpTable")
	windowsExtendedUDPTableProc = windowsIPHelperDLL.NewProc("GetExtendedUdpTable")
	windowsIfEntry2Proc         = windowsIPHelperDLL.NewProc("GetIfEntry2")
)

func callWindowsExtendedTCPTable(buffer []byte, size *uint32, family, tableClass uint32) error {
	return callWindowsIPHelperTable(windowsExtendedTCPTableProc, buffer, size, family, tableClass)
}

func callWindowsExtendedUDPTable(buffer []byte, size *uint32, family, tableClass uint32) error {
	return callWindowsIPHelperTable(windowsExtendedUDPTableProc, buffer, size, family, tableClass)
}

func callWindowsIPHelperTable(proc *windows.LazyProc, buffer []byte, size *uint32, family, tableClass uint32) error {
	if size == nil {
		return fmt.Errorf("Windows IP Helper table size pointer is nil")
	}
	if err := proc.Find(); err != nil {
		return fmt.Errorf("find %s: %w", proc.Name, err)
	}
	var tablePointer uintptr
	if len(buffer) > 0 {
		tablePointer = uintptr(unsafe.Pointer(&buffer[0]))
	}
	result, _, _ := proc.Call(
		tablePointer,
		uintptr(unsafe.Pointer(size)),
		1,
		uintptr(family),
		uintptr(tableClass),
		0,
	)
	runtime.KeepAlive(buffer)
	runtime.KeepAlive(size)
	if result != 0 {
		return syscall.Errno(result)
	}
	return nil
}

func checkedWindowsGetIfEntry2(row *windows.MibIfRow2) error {
	if row == nil {
		return fmt.Errorf("Windows interface row pointer is nil")
	}
	// GetIfEntry2 is available on every Windows version supported by the Go
	// toolchain. Resolve it only during the explicit read so Capabilities stays
	// I/O-free and an unexpectedly missing symbol is still a normal error.
	if err := windowsIfEntry2Proc.Find(); err != nil {
		return fmt.Errorf("find GetIfEntry2: %w", err)
	}
	result, _, _ := windowsIfEntry2Proc.Call(uintptr(unsafe.Pointer(row)))
	runtime.KeepAlive(row)
	if result != 0 {
		return syscall.Errno(result)
	}
	return nil
}

func fetchWindowsTable(ctx context.Context, call windowsTableCall, family, tableClass uint32) ([]byte, error) {
	if call == nil {
		return nil, fmt.Errorf("Windows IP Helper table call is nil")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var required uint32
	err := call(nil, &required, family, tableClass)
	if err != nil && !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
		return nil, err
	}
	if required < 4 {
		return nil, fmt.Errorf("Windows IP Helper returned an invalid table size %d", required)
	}
	for attempt := 0; attempt < maxWindowsTableAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if required > maxWindowsSocketTableBytes {
			return nil, fmt.Errorf("Windows IP Helper table requires %d bytes, above the %d-byte limit", required, maxWindowsSocketTableBytes)
		}
		buffer := make([]byte, int(required))
		used := required
		err = call(buffer, &used, family, tableClass)
		if err == nil {
			if used < 4 || used > uint32(len(buffer)) {
				return nil, fmt.Errorf("Windows IP Helper returned an invalid used size %d for a %d-byte buffer", used, len(buffer))
			}
			return buffer[:used], nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return nil, err
		}
		if used <= uint32(len(buffer)) {
			return nil, fmt.Errorf("Windows IP Helper table grew without reporting a larger size")
		}
		required = used
	}
	return nil, fmt.Errorf("Windows IP Helper table kept growing after %d bounded attempts", maxWindowsTableAttempts)
}

func parseWindowsTCPTable(buffer []byte, maximum int) (windowsParsedSocketTable, error) {
	count, err := windowsTableCount(buffer, windowsTCPTableOffset, windowsTCPRowOwnerPIDSize)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	countToRead, truncated, err := boundedWindowsRowCount(count, maximum)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	result := windowsParsedSocketTable{records: make([]windowsSocketRecord, 0, countToRead), truncated: truncated}
	for index := 0; index < countToRead; index++ {
		row := windowsRowAt[mibTCPRowOwnerPID](buffer, windowsTCPTableOffset, index)
		local, endpointErr := windowsIPv4Endpoint(row.LocalAddr, row.LocalPort)
		if endpointErr != nil {
			result.malformedRows++
			continue
		}
		state, known := windowsTCPState(row.State)
		remote := windowsUnspecifiedEndpoint(false)
		if state != "LISTEN" {
			remote, endpointErr = windowsIPv4Endpoint(row.RemoteAddr, row.RemotePort)
			if endpointErr != nil {
				result.malformedRows++
				continue
			}
		}
		if !known {
			result.unknownStates++
		}
		result.records = append(result.records, windowsSocketRecord{
			protocol: "tcp4",
			state:    state,
			local:    local,
			remote:   remote,
			ownerPID: row.OwningPID,
		})
	}
	return result, nil
}

func parseWindowsTCP6Table(buffer []byte, maximum int) (windowsParsedSocketTable, error) {
	count, err := windowsTableCount(buffer, windowsTCP6TableOffset, windowsTCP6RowOwnerPIDSize)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	countToRead, truncated, err := boundedWindowsRowCount(count, maximum)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	result := windowsParsedSocketTable{records: make([]windowsSocketRecord, 0, countToRead), truncated: truncated}
	for index := 0; index < countToRead; index++ {
		row := windowsRowAt[mibTCP6RowOwnerPID](buffer, windowsTCP6TableOffset, index)
		local, endpointErr := windowsIPv6Endpoint(row.LocalAddr, row.LocalScopeID, row.LocalPort)
		if endpointErr != nil {
			result.malformedRows++
			continue
		}
		state, known := windowsTCPState(row.State)
		remote := windowsUnspecifiedEndpoint(true)
		if state != "LISTEN" {
			remote, endpointErr = windowsIPv6Endpoint(row.RemoteAddr, row.RemoteScopeID, row.RemotePort)
			if endpointErr != nil {
				result.malformedRows++
				continue
			}
		}
		if !known {
			result.unknownStates++
		}
		result.records = append(result.records, windowsSocketRecord{
			protocol: "tcp6",
			state:    state,
			local:    local,
			remote:   remote,
			ownerPID: row.OwningPID,
		})
	}
	return result, nil
}

func parseWindowsUDPTable(buffer []byte, maximum int) (windowsParsedSocketTable, error) {
	count, err := windowsTableCount(buffer, windowsUDPTableOffset, windowsUDPRowOwnerPIDSize)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	countToRead, truncated, err := boundedWindowsRowCount(count, maximum)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	result := windowsParsedSocketTable{records: make([]windowsSocketRecord, 0, countToRead), truncated: truncated}
	for index := 0; index < countToRead; index++ {
		row := windowsRowAt[mibUDPRowOwnerPID](buffer, windowsUDPTableOffset, index)
		local, endpointErr := windowsIPv4Endpoint(row.LocalAddr, row.LocalPort)
		if endpointErr != nil {
			result.malformedRows++
			continue
		}
		result.records = append(result.records, windowsSocketRecord{
			protocol: "udp4",
			state:    "UNCONNECTED",
			local:    local,
			remote:   windowsUnspecifiedEndpoint(false),
			ownerPID: row.OwningPID,
		})
	}
	return result, nil
}

func parseWindowsUDP6Table(buffer []byte, maximum int) (windowsParsedSocketTable, error) {
	count, err := windowsTableCount(buffer, windowsUDP6TableOffset, windowsUDP6RowOwnerPIDSize)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	countToRead, truncated, err := boundedWindowsRowCount(count, maximum)
	if err != nil {
		return windowsParsedSocketTable{}, err
	}
	result := windowsParsedSocketTable{records: make([]windowsSocketRecord, 0, countToRead), truncated: truncated}
	for index := 0; index < countToRead; index++ {
		row := windowsRowAt[mibUDP6RowOwnerPID](buffer, windowsUDP6TableOffset, index)
		local, endpointErr := windowsIPv6Endpoint(row.LocalAddr, row.LocalScopeID, row.LocalPort)
		if endpointErr != nil {
			result.malformedRows++
			continue
		}
		result.records = append(result.records, windowsSocketRecord{
			protocol: "udp6",
			state:    "UNCONNECTED",
			local:    local,
			remote:   windowsUnspecifiedEndpoint(true),
			ownerPID: row.OwningPID,
		})
	}
	return result, nil
}

func windowsTableCount(buffer []byte, offset, rowSize int) (int, error) {
	if offset < 4 || rowSize < 1 || len(buffer) < offset {
		return 0, fmt.Errorf("Windows IP Helper table header is truncated")
	}
	count := binary.LittleEndian.Uint32(buffer[:4])
	available := (len(buffer) - offset) / rowSize
	if uint64(count) > uint64(available) {
		return 0, fmt.Errorf("Windows IP Helper table declares %d rows but contains space for %d", count, available)
	}
	return int(count), nil
}

func boundedWindowsRowCount(count, maximum int) (int, bool, error) {
	if maximum < 1 || maximum > maxSockets {
		return 0, false, fmt.Errorf("invalid Windows socket parse limit")
	}
	if count > maximum {
		return maximum, true, nil
	}
	return count, false, nil
}

func windowsRowAt[T any](buffer []byte, offset, index int) T {
	var row T
	size := int(unsafe.Sizeof(row))
	start := offset + index*size
	destination := unsafe.Slice((*byte)(unsafe.Pointer(&row)), size)
	copy(destination, buffer[start:start+size])
	return row
}

func windowsIPv4Endpoint(rawAddress, rawPort uint32) (Endpoint, error) {
	port, err := windowsPort(rawPort)
	if err != nil {
		return Endpoint{}, err
	}
	var bytes [4]byte
	binary.LittleEndian.PutUint32(bytes[:], rawAddress)
	address := netip.AddrFrom4(bytes)
	return Endpoint{Address: address.String(), Port: port, Wildcard: address.IsUnspecified()}, nil
}

func windowsIPv6Endpoint(rawAddress [16]byte, rawScope, rawPort uint32) (Endpoint, error) {
	port, err := windowsPort(rawPort)
	if err != nil {
		return Endpoint{}, err
	}
	address := netip.AddrFrom16(rawAddress)
	scope := bits.ReverseBytes32(rawScope)
	if scope != 0 && !address.IsUnspecified() {
		address = address.WithZone(strconv.FormatUint(uint64(scope), 10))
	}
	return Endpoint{Address: address.String(), Port: port, Wildcard: address.IsUnspecified()}, nil
}

func windowsPort(raw uint32) (uint16, error) {
	// IP Helper stores a network-order 16-bit port in a DWORD. Microsoft
	// documents the upper 16 bits as potentially uninitialized.
	return bits.ReverseBytes16(uint16(raw)), nil
}

func windowsUnspecifiedEndpoint(ipv6 bool) Endpoint {
	if ipv6 {
		return Endpoint{Address: "::", Wildcard: true}
	}
	return Endpoint{Address: "0.0.0.0", Wildcard: true}
}

func windowsTCPState(value uint32) (string, bool) {
	states := [...]string{
		"",
		"CLOSE",
		"LISTEN",
		"SYN_SENT",
		"SYN_RECV",
		"ESTABLISHED",
		"FIN_WAIT1",
		"FIN_WAIT2",
		"CLOSE_WAIT",
		"CLOSING",
		"LAST_ACK",
		"TIME_WAIT",
		"DELETE_TCB",
	}
	if value > 0 && value < uint32(len(states)) {
		return states[value], true
	}
	return fmt.Sprintf("UNKNOWN(%d)", value), false
}
