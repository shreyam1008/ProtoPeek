//go:build windows

package thispc

import (
	"context"
	"encoding/binary"
	"errors"
	"math/bits"
	"net/netip"
	"strings"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestWindowsOwnerPIDTableParsingPreservesNativeEvidence(t *testing.T) {
	t.Parallel()
	tcp4 := windowsTableFixture(windowsTCPTableOffset,
		mibTCPRowOwnerPID{
			State: 2, LocalAddr: rawWindowsIPv4("0.0.0.0"), LocalPort: rawWindowsPort(8080),
			RemoteAddr: rawWindowsIPv4("203.0.113.8"), RemotePort: rawWindowsPort(443), OwningPID: 10,
		},
		mibTCPRowOwnerPID{
			State: 5, LocalAddr: rawWindowsIPv4("127.0.0.1"), LocalPort: rawWindowsPort(50000),
			RemoteAddr: rawWindowsIPv4("8.8.8.8"), RemotePort: rawWindowsPort(443), OwningPID: 20,
		},
		mibTCPRowOwnerPID{
			State: 99, LocalAddr: rawWindowsIPv4("192.0.2.1"), LocalPort: rawWindowsPort(1234),
			RemoteAddr: rawWindowsIPv4("192.0.2.2"), RemotePort: rawWindowsPort(4321), OwningPID: 30,
		},
	)
	parsedTCP4, err := parseWindowsTCPTable(tcp4, 8)
	if err != nil || parsedTCP4.truncated || parsedTCP4.unknownStates != 1 || len(parsedTCP4.records) != 3 {
		t.Fatalf("parseWindowsTCPTable() = %#v, %v", parsedTCP4, err)
	}
	listener := parsedTCP4.records[0]
	if listener.protocol != "tcp4" || listener.state != "LISTEN" || listener.local.Address != "0.0.0.0" || listener.local.Port != 8080 || !listener.local.Wildcard || listener.remote.Address != "0.0.0.0" || listener.remote.Port != 0 || !listener.remote.Wildcard || listener.ownerPID != 10 {
		t.Fatalf("TCP4 listener = %#v", listener)
	}
	connection := parsedTCP4.records[1]
	if connection.state != "ESTABLISHED" || connection.local.Address != "127.0.0.1" || connection.local.Port != 50000 || connection.remote.Address != "8.8.8.8" || connection.remote.Port != 443 || connection.ownerPID != 20 {
		t.Fatalf("TCP4 connection = %#v", connection)
	}
	if parsedTCP4.records[2].state != "UNKNOWN(99)" {
		t.Fatalf("unknown TCP state = %q", parsedTCP4.records[2].state)
	}

	local6 := netip.MustParseAddr("fe80::1234").As16()
	remote6 := netip.MustParseAddr("2001:db8::5").As16()
	tcp6 := windowsTableFixture(windowsTCP6TableOffset, mibTCP6RowOwnerPID{
		LocalAddr: local6, LocalScopeID: bits.ReverseBytes32(12), LocalPort: rawWindowsPort(8443),
		RemoteAddr: remote6, RemotePort: rawWindowsPort(443), State: 5, OwningPID: 40,
	})
	parsedTCP6, err := parseWindowsTCP6Table(tcp6, 8)
	if err != nil || len(parsedTCP6.records) != 1 {
		t.Fatalf("parseWindowsTCP6Table() = %#v, %v", parsedTCP6, err)
	}
	if got := parsedTCP6.records[0]; got.local.Address != "fe80::1234%12" || got.local.Port != 8443 || got.remote.Address != "2001:db8::5" || got.remote.Port != 443 || got.protocol != "tcp6" {
		t.Fatalf("TCP6 connection = %#v", got)
	}

	udp4 := windowsTableFixture(windowsUDPTableOffset, mibUDPRowOwnerPID{
		LocalAddr: rawWindowsIPv4("0.0.0.0"), LocalPort: rawWindowsPort(53), OwningPID: 50,
	})
	parsedUDP4, err := parseWindowsUDPTable(udp4, 8)
	if err != nil || len(parsedUDP4.records) != 1 || parsedUDP4.records[0].state != "UNCONNECTED" || !parsedUDP4.records[0].remote.Wildcard {
		t.Fatalf("parseWindowsUDPTable() = %#v, %v", parsedUDP4, err)
	}
	udp6 := windowsTableFixture(windowsUDP6TableOffset, mibUDP6RowOwnerPID{
		LocalAddr: local6, LocalScopeID: bits.ReverseBytes32(7), LocalPort: rawWindowsPort(5353), OwningPID: 60,
	})
	parsedUDP6, err := parseWindowsUDP6Table(udp6, 8)
	if err != nil || len(parsedUDP6.records) != 1 || parsedUDP6.records[0].local.Address != "fe80::1234%7" || parsedUDP6.records[0].protocol != "udp6" || !isListenerSocket(Socket{Protocol: "udp6", State: parsedUDP6.records[0].state, Remote: parsedUDP6.records[0].remote}) {
		t.Fatalf("parseWindowsUDP6Table() = %#v, %v", parsedUDP6, err)
	}
}

func TestWindowsTCPStateNormalizesToExistingVocabulary(t *testing.T) {
	t.Parallel()
	want := []string{"CLOSE", "LISTEN", "SYN_SENT", "SYN_RECV", "ESTABLISHED", "FIN_WAIT1", "FIN_WAIT2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "DELETE_TCB"}
	for index, expected := range want {
		state, known := windowsTCPState(uint32(index + 1))
		if !known || state != expected {
			t.Errorf("windowsTCPState(%d) = %q, %v", index+1, state, known)
		}
	}
	if state, known := windowsTCPState(0); known || state != "UNKNOWN(0)" {
		t.Fatalf("windowsTCPState(0) = %q, %v", state, known)
	}
}

func TestWindowsTableParserRejectsTruncationAndMasksDWORDPorts(t *testing.T) {
	t.Parallel()
	fixture := windowsTableFixture(windowsTCPTableOffset,
		mibTCPRowOwnerPID{State: 2, LocalPort: rawWindowsPort(80)},
		mibTCPRowOwnerPID{State: 2, LocalPort: rawWindowsPort(81)},
	)
	parsed, err := parseWindowsTCPTable(fixture, 1)
	if err != nil || !parsed.truncated || len(parsed.records) != 1 {
		t.Fatalf("bounded parse = %#v, %v", parsed, err)
	}
	truncated := append([]byte(nil), fixture[:len(fixture)-1]...)
	if _, err := parseWindowsTCPTable(truncated, 8); err == nil || !strings.Contains(err.Error(), "declares") {
		t.Fatalf("truncated table error = %v", err)
	}
	ports := windowsTableFixture(windowsUDPTableOffset,
		mibUDPRowOwnerPID{LocalPort: 0xabcd0000 | rawWindowsPort(53)},
		mibUDPRowOwnerPID{LocalPort: rawWindowsPort(80)},
	)
	parsed, err = parseWindowsUDPTable(ports, 8)
	if err != nil || parsed.malformedRows != 0 || len(parsed.records) != 2 || parsed.records[0].local.Port != 53 || parsed.records[1].local.Port != 80 {
		t.Fatalf("DWORD port parse = %#v, %v", parsed, err)
	}
	if _, err := parseWindowsUDPTable(windowsTableFixture(windowsUDPTableOffset, mibUDPRowOwnerPID{}), 0); err == nil {
		t.Fatal("zero parse limit was accepted")
	}
}

func TestWindowsOwnerPIDParsersAcceptFixedSDKByteLayouts(t *testing.T) {
	t.Parallel()
	tcp4 := make([]byte, 4+24)
	binary.LittleEndian.PutUint32(tcp4[0:], 1)
	binary.LittleEndian.PutUint32(tcp4[4+0:], 5)
	binary.LittleEndian.PutUint32(tcp4[4+4:], rawWindowsIPv4("127.0.0.1"))
	binary.LittleEndian.PutUint32(tcp4[4+8:], 0xcafe0000|rawWindowsPort(50000))
	binary.LittleEndian.PutUint32(tcp4[4+12:], rawWindowsIPv4("8.8.8.8"))
	binary.LittleEndian.PutUint32(tcp4[4+16:], 0xbeef0000|rawWindowsPort(443))
	binary.LittleEndian.PutUint32(tcp4[4+20:], 42)
	parsedTCP4, err := parseWindowsTCPTable(tcp4, 1)
	if err != nil || len(parsedTCP4.records) != 1 {
		t.Fatalf("fixed TCP4 parse = %#v, %v", parsedTCP4, err)
	}
	if got := parsedTCP4.records[0]; got.state != "ESTABLISHED" || got.local.Address != "127.0.0.1" || got.local.Port != 50000 || got.remote.Address != "8.8.8.8" || got.remote.Port != 443 || got.ownerPID != 42 {
		t.Fatalf("fixed TCP4 row = %#v", got)
	}

	tcp6 := make([]byte, 4+56)
	binary.LittleEndian.PutUint32(tcp6[0:], 1)
	local6 := netip.MustParseAddr("fe80::1234").As16()
	remote6 := netip.MustParseAddr("2001:db8::5").As16()
	copy(tcp6[4+0:], local6[:])
	binary.LittleEndian.PutUint32(tcp6[4+16:], bits.ReverseBytes32(12))
	binary.LittleEndian.PutUint32(tcp6[4+20:], rawWindowsPort(8443))
	copy(tcp6[4+24:], remote6[:])
	binary.LittleEndian.PutUint32(tcp6[4+40:], bits.ReverseBytes32(13))
	binary.LittleEndian.PutUint32(tcp6[4+44:], rawWindowsPort(443))
	binary.LittleEndian.PutUint32(tcp6[4+48:], 5)
	binary.LittleEndian.PutUint32(tcp6[4+52:], 43)
	parsedTCP6, err := parseWindowsTCP6Table(tcp6, 1)
	if err != nil || len(parsedTCP6.records) != 1 {
		t.Fatalf("fixed TCP6 parse = %#v, %v", parsedTCP6, err)
	}
	if got := parsedTCP6.records[0]; got.local.Address != "fe80::1234%12" || got.local.Port != 8443 || got.remote.Address != "2001:db8::5%13" || got.remote.Port != 443 || got.ownerPID != 43 {
		t.Fatalf("fixed TCP6 row = %#v", got)
	}

	udp4 := make([]byte, 4+12)
	binary.LittleEndian.PutUint32(udp4[0:], 1)
	binary.LittleEndian.PutUint32(udp4[4+0:], rawWindowsIPv4("0.0.0.0"))
	binary.LittleEndian.PutUint32(udp4[4+4:], rawWindowsPort(53))
	binary.LittleEndian.PutUint32(udp4[4+8:], 44)
	parsedUDP4, err := parseWindowsUDPTable(udp4, 1)
	if err != nil || len(parsedUDP4.records) != 1 || parsedUDP4.records[0].local.Port != 53 || parsedUDP4.records[0].ownerPID != 44 {
		t.Fatalf("fixed UDP4 parse = %#v, %v", parsedUDP4, err)
	}

	udp6 := make([]byte, 4+28)
	binary.LittleEndian.PutUint32(udp6[0:], 1)
	copy(udp6[4+0:], local6[:])
	binary.LittleEndian.PutUint32(udp6[4+16:], bits.ReverseBytes32(7))
	binary.LittleEndian.PutUint32(udp6[4+20:], rawWindowsPort(5353))
	binary.LittleEndian.PutUint32(udp6[4+24:], 45)
	parsedUDP6, err := parseWindowsUDP6Table(udp6, 1)
	if err != nil || len(parsedUDP6.records) != 1 || parsedUDP6.records[0].local.Address != "fe80::1234%7" || parsedUDP6.records[0].local.Port != 5353 || parsedUDP6.records[0].ownerPID != 45 {
		t.Fatalf("fixed UDP6 parse = %#v, %v", parsedUDP6, err)
	}
}

func TestFetchWindowsTableRetriesOneGrowthRaceWithinBounds(t *testing.T) {
	t.Parallel()
	fixture := windowsTableFixture(windowsUDPTableOffset, mibUDPRowOwnerPID{})
	calls := 0
	call := func(buffer []byte, size *uint32, family, tableClass uint32) error {
		calls++
		if family != windows.AF_INET6 || tableClass != windowsUDPTableOwnerPID {
			t.Fatalf("family=%d class=%d", family, tableClass)
		}
		switch calls {
		case 1:
			if buffer != nil {
				t.Fatal("sizing call received a buffer")
			}
			*size = 8
			return windows.ERROR_INSUFFICIENT_BUFFER
		case 2:
			*size = uint32(len(fixture))
			return windows.ERROR_INSUFFICIENT_BUFFER
		default:
			copy(buffer, fixture)
			*size = uint32(len(fixture))
			return nil
		}
	}
	buffer, err := fetchWindowsTable(context.Background(), call, windows.AF_INET6, windowsUDPTableOwnerPID)
	if err != nil || calls != 3 || len(buffer) != len(fixture) {
		t.Fatalf("fetchWindowsTable() bytes=%d calls=%d err=%v", len(buffer), calls, err)
	}
}

func TestFetchWindowsTableRejectsCapsRetriesAndCancellation(t *testing.T) {
	t.Parallel()
	tooLarge := func(_ []byte, size *uint32, _, _ uint32) error {
		*size = maxWindowsSocketTableBytes + 1
		return windows.ERROR_INSUFFICIENT_BUFFER
	}
	if _, err := fetchWindowsTable(context.Background(), tooLarge, windows.AF_INET, windowsTCPTableOwnerPIDAll); err == nil || !strings.Contains(err.Error(), "above") {
		t.Fatalf("oversized table error = %v", err)
	}
	calls := 0
	growing := func(buffer []byte, size *uint32, _, _ uint32) error {
		calls++
		if buffer == nil {
			*size = 8
		} else {
			*size = uint32(len(buffer) + 8)
		}
		return windows.ERROR_INSUFFICIENT_BUFFER
	}
	if _, err := fetchWindowsTable(context.Background(), growing, windows.AF_INET, windowsTCPTableOwnerPIDAll); err == nil || calls != maxWindowsTableAttempts+1 || !strings.Contains(err.Error(), "kept growing") {
		t.Fatalf("growing table calls=%d error=%v", calls, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if _, err := fetchWindowsTable(ctx, func([]byte, *uint32, uint32, uint32) error { called = true; return nil }, windows.AF_INET, windowsTCPTableOwnerPIDAll); !errors.Is(err, context.Canceled) || called {
		t.Fatalf("cancelled fetch called=%v error=%v", called, err)
	}
}

func TestWindowsProcessNameUsesOnlyLimitedQueryAndReturnsBasename(t *testing.T) {
	t.Parallel()
	opened := false
	closed := false
	queried := false
	dependencies := windowsProcessDependencies{
		openProcess: func(access uint32, inherit bool, pid uint32) (windows.Handle, error) {
			opened = true
			if access != windows.PROCESS_QUERY_LIMITED_INFORMATION || inherit || pid != 42 {
				t.Fatalf("open access=%#x inherit=%v pid=%d", access, inherit, pid)
			}
			return windows.Handle(123), nil
		},
		queryImage: func(handle windows.Handle, flags uint32, output *uint16, size *uint32) error {
			queried = true
			if handle != windows.Handle(123) || flags != 0 {
				t.Fatalf("query handle=%v flags=%d", handle, flags)
			}
			encoded, err := windows.UTF16FromString(`C:\Users\private\protopeek-test.exe`)
			if err != nil {
				t.Fatal(err)
			}
			if int(*size) < len(encoded) {
				return windows.ERROR_INSUFFICIENT_BUFFER
			}
			copy(unsafe.Slice(output, int(*size)), encoded)
			*size = uint32(len(encoded) - 1)
			return nil
		},
		closeHandle: func(handle windows.Handle) error {
			closed = true
			if handle != windows.Handle(123) {
				t.Fatalf("closed handle=%v", handle)
			}
			return nil
		},
	}
	name, err := dependencies.processName(42)
	if err != nil || name != "protopeek-test.exe" || !opened || !queried || !closed || strings.Contains(name, `\`) {
		t.Fatalf("processName() name=%q opened=%v queried=%v closed=%v err=%v", name, opened, queried, closed, err)
	}
}

func TestWindowsProcessNameClosesAccessDeniedAndRetriesBoundedBuffer(t *testing.T) {
	t.Parallel()
	queryCalls := 0
	closeCalls := 0
	dependencies := windowsProcessDependencies{
		openProcess: func(uint32, bool, uint32) (windows.Handle, error) { return 9, nil },
		queryImage: func(_ windows.Handle, _ uint32, output *uint16, size *uint32) error {
			queryCalls++
			if *size < 1024 {
				return windows.ERROR_INSUFFICIENT_BUFFER
			}
			encoded, _ := windows.UTF16FromString(`C:\Program Files\long.exe`)
			copy(unsafe.Slice(output, int(*size)), encoded)
			*size = uint32(len(encoded) - 1)
			return nil
		},
		closeHandle: func(windows.Handle) error { closeCalls++; return nil },
	}
	name, err := dependencies.processName(7)
	if err != nil || name != "long.exe" || queryCalls != 2 || closeCalls != 1 {
		t.Fatalf("retry name=%q queries=%d closes=%d err=%v", name, queryCalls, closeCalls, err)
	}
	dependencies.openProcess = func(uint32, bool, uint32) (windows.Handle, error) { return 0, windows.ERROR_ACCESS_DENIED }
	if _, err := dependencies.processName(7); !errors.Is(err, windows.ERROR_ACCESS_DENIED) || closeCalls != 1 {
		t.Fatalf("access denied closes=%d err=%v", closeCalls, err)
	}
}

func TestWindowsActivityCollectsAllFourTablesWithTruthfulOwners(t *testing.T) {
	t.Parallel()
	tcpFixtures := map[uint32][]byte{
		windows.AF_INET: windowsTableFixture(windowsTCPTableOffset,
			mibTCPRowOwnerPID{State: 2, LocalAddr: rawWindowsIPv4("127.0.0.1"), LocalPort: rawWindowsPort(8080), OwningPID: 10},
			mibTCPRowOwnerPID{State: 5, LocalAddr: rawWindowsIPv4("127.0.0.1"), LocalPort: rawWindowsPort(50000), RemoteAddr: rawWindowsIPv4("127.0.0.1"), RemotePort: rawWindowsPort(8080), OwningPID: 20},
		),
		windows.AF_INET6: windowsTableFixture[mibTCP6RowOwnerPID](windowsTCP6TableOffset),
	}
	udpFixtures := map[uint32][]byte{
		windows.AF_INET:  windowsTableFixture(windowsUDPTableOffset, mibUDPRowOwnerPID{LocalAddr: rawWindowsIPv4("0.0.0.0"), LocalPort: rawWindowsPort(5353), OwningPID: 30}),
		windows.AF_INET6: windowsTableFixture(windowsUDP6TableOffset, mibUDP6RowOwnerPID{LocalPort: rawWindowsPort(5353)}),
	}
	processCalls := make([]uint32, 0)
	dependencies := windowsActivityDependencies{
		tcpTable: staticWindowsTableCall(tcpFixtures),
		udpTable: staticWindowsTableCall(udpFixtures),
		processName: func(pid uint32) (string, error) {
			processCalls = append(processCalls, pid)
			switch pid {
			case 10:
				return "server.exe", nil
			case 20:
				return "", windows.ERROR_ACCESS_DENIED
			default:
				return "", windows.ERROR_INVALID_PARAMETER
			}
		},
		now: func() time.Time { return time.Unix(100, 0) },
	}
	activity, err := dependencies.collect(context.Background())
	if err != nil || activity.Status != "ok" || activity.Truncated || len(activity.Listeners) != 3 || len(activity.Connections) != 1 {
		t.Fatalf("collect() = %#v, %v", activity, err)
	}
	if got := activity.Listeners[0]; got.OwnerStatus != "observed" || len(got.Processes) != 1 || got.Processes[0].PID != 10 || got.Processes[0].Comm != "server.exe" || got.Exposure != "loopback-only" {
		t.Fatalf("observed owner = %#v", got)
	}
	if got := activity.Connections[0]; got.OwnerStatus != "restricted" || len(got.Processes) != 0 {
		t.Fatalf("restricted owner = %#v", got)
	}
	if got := activity.Listeners[1]; got.OwnerStatus != "not-found" || len(got.Processes) != 0 || got.Protocol != "udp4" {
		t.Fatalf("vanished UDP owner = %#v", got)
	}
	if got := activity.Listeners[2]; got.OwnerStatus != "restricted" || got.Protocol != "udp6" {
		t.Fatalf("PID-zero UDP owner = %#v", got)
	}
	if len(processCalls) != 3 || processCalls[0] != 10 || processCalls[1] != 20 || processCalls[2] != 30 {
		t.Fatalf("process calls = %v", processCalls)
	}
	joinedNotes := strings.Join(activity.Notes, "\n")
	if !strings.Contains(joinedNotes, "send-only") || !strings.Contains(joinedNotes, "access-restricted") || !strings.Contains(joinedNotes, "exited") || !strings.Contains(joinedNotes, "reported PID 0") {
		t.Fatalf("activity notes = %v", activity.Notes)
	}
}

func TestWindowsOwnerResolutionCapsUniquePIDs(t *testing.T) {
	t.Parallel()
	records := make([]windowsSocketRecord, maxProcesses+1)
	for index := range records {
		records[index].ownerPID = uint32(index + 1)
	}
	calls := 0
	dependencies := windowsActivityDependencies{processName: func(pid uint32) (string, error) {
		calls++
		return "process.exe", nil
	}}
	resolved := dependencies.resolveOwners(context.Background(), records)
	if !resolved.truncated || calls != maxProcesses || len(resolved.owners) != maxProcesses+1 || resolved.owners[uint32(maxProcesses+1)].status != "restricted" {
		t.Fatalf("resolved calls=%d owners=%d truncated=%v tail=%#v", calls, len(resolved.owners), resolved.truncated, resolved.owners[uint32(maxProcesses+1)])
	}
}

func staticWindowsTableCall(fixtures map[uint32][]byte) windowsTableCall {
	return func(buffer []byte, size *uint32, family, _ uint32) error {
		fixture, exists := fixtures[family]
		if !exists {
			return windows.ERROR_NOT_SUPPORTED
		}
		if buffer == nil || len(buffer) < len(fixture) {
			*size = uint32(len(fixture))
			return windows.ERROR_INSUFFICIENT_BUFFER
		}
		copy(buffer, fixture)
		*size = uint32(len(fixture))
		return nil
	}
}

func windowsTableFixture[T any](offset int, rows ...T) []byte {
	var row T
	rowSize := int(unsafe.Sizeof(row))
	buffer := make([]byte, offset+len(rows)*rowSize)
	binary.LittleEndian.PutUint32(buffer[:4], uint32(len(rows)))
	for index := range rows {
		start := offset + index*rowSize
		source := unsafe.Slice((*byte)(unsafe.Pointer(&rows[index])), rowSize)
		copy(buffer[start:start+rowSize], source)
	}
	return buffer
}

func rawWindowsIPv4(value string) uint32 {
	bytes := netip.MustParseAddr(value).As4()
	return binary.LittleEndian.Uint32(bytes[:])
}

func rawWindowsPort(value uint16) uint32 {
	return uint32(bits.ReverseBytes16(value))
}
