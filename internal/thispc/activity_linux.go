//go:build linux

package thispc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	maxProcSocketTableBytes = 4 << 20
	maxProcStatusBytes      = 64 << 10
	maxProcCommBytes        = 4 << 10
	maxProcProcessDirNames  = 4096
	maxOwnersPerSocket      = 8
)

type activityDependencies struct {
	readFile     func(string, int64) ([]byte, error)
	listPIDs     func(int) ([]int, bool, error)
	listFDs      func(int, int) ([]string, bool, error)
	readLink     func(string) (string, error)
	effectiveUID func() int
	now          func() time.Time
}

func platformActivityCapability() (bool, string) { return true, "" }

func newActivityReader() activityReader {
	dependencies := activityDependencies{
		readFile:     readBoundedFile,
		listPIDs:     listProcessIDs,
		listFDs:      listFileDescriptors,
		readLink:     os.Readlink,
		effectiveUID: os.Geteuid,
		now:          time.Now,
	}
	return dependencies.collect
}

func (dependencies activityDependencies) collect(parent context.Context) (Activity, error) {
	ctx, cancel := context.WithTimeout(parent, activityWallTimeMS*time.Millisecond)
	defer cancel()
	result := Activity{
		SchemaVersion: SchemaVersion,
		Status:        "ok",
		Scope:         Scope,
		ScopeNotice:   ScopeNotice,
		ObservedAt:    dependencies.now().UTC(),
		Listeners:     make([]Socket, 0),
		Connections:   make([]Socket, 0),
		Limits: ActivityLimits{
			MaxSockets:         maxSockets,
			MaxProcesses:       maxProcesses,
			MaxFileDescriptors: maxFileDescriptors,
			WallTimeMS:         activityWallTimeMS,
		},
		Notes: []string{
			LocalListenerNotice,
			"Process attribution is best-effort and limited to same-effective-UID processes visible to ProtoPeek. It reads only procfs status, comm, and file-descriptor socket links; it never reads command lines, environments, working directories, or executable links.",
		},
	}

	tables := []struct {
		path     string
		protocol string
	}{
		{path: "/proc/net/tcp", protocol: "tcp4"},
		{path: "/proc/net/tcp6", protocol: "tcp6"},
		{path: "/proc/net/udp", protocol: "udp4"},
		{path: "/proc/net/udp6", protocol: "udp6"},
	}
	sockets := make([]Socket, 0)
	successfulTables := 0
	for _, table := range tables {
		if err := ctx.Err(); err != nil {
			result.Truncated = true
			result.Status = "partial"
			result.Notes = append(result.Notes, "local socket inspection reached its 2 second wall-time limit")
			break
		}
		remaining := maxSockets - len(sockets)
		if remaining <= 0 {
			result.Truncated = true
			result.Status = "partial"
			result.Notes = append(result.Notes, "local socket list was truncated at 4096 entries")
			break
		}
		contents, err := dependencies.readFile(table.path, maxProcSocketTableBytes)
		if err != nil {
			result.Status = "partial"
			result.Notes = append(result.Notes, fmt.Sprintf("%s activity unavailable: %s", table.protocol, boundedError(err)))
			continue
		}
		parsed, truncated, err := parseProcSocketTable(bytes.NewReader(contents), table.protocol, remaining)
		if err != nil {
			result.Status = "partial"
			result.Notes = append(result.Notes, fmt.Sprintf("%s activity malformed: %s", table.protocol, boundedError(err)))
			continue
		}
		successfulTables++
		sockets = append(sockets, parsed...)
		if truncated {
			result.Truncated = true
			result.Status = "partial"
			result.Notes = append(result.Notes, "local socket list was truncated at 4096 entries")
			break
		}
	}
	if successfulTables == 0 {
		if err := parent.Err(); err != nil {
			return result, err
		}
		return result, ErrActivityUnavailable
	}

	attributions := dependencies.attribute(ctx, sockets)
	if attributions.truncated {
		result.Truncated = true
		result.Status = "partial"
	}
	result.Notes = append(result.Notes, attributions.notes...)
	for index := range sockets {
		sockets[index].Exposure = socketExposure(sockets[index].Local)
		sockets[index].Processes = make([]ProcessAttribution, 0)
		if processes := attributions.owners[sockets[index].inode]; len(processes) > 0 {
			sockets[index].Processes = processes
			sockets[index].OwnerStatus = "observed"
		} else if attributions.restricted {
			sockets[index].OwnerStatus = "restricted"
		} else {
			sockets[index].OwnerStatus = "not-found"
		}
		if attributions.ownersTruncated[sockets[index].inode] {
			sockets[index].OwnersTruncated = true
			result.Truncated = true
			result.Status = "partial"
		}
		if isListenerSocket(sockets[index]) {
			result.Listeners = append(result.Listeners, sockets[index])
		} else {
			result.Connections = append(result.Connections, sockets[index])
		}
	}
	if err := parent.Err(); err != nil {
		return result, err
	}
	return result, nil
}

type attributionResult struct {
	owners          map[uint64][]ProcessAttribution
	ownersTruncated map[uint64]bool
	notes           []string
	truncated       bool
	restricted      bool
}

func (dependencies activityDependencies) attribute(ctx context.Context, sockets []Socket) attributionResult {
	wanted := make(map[uint64]struct{}, len(sockets))
	for _, socket := range sockets {
		if socket.inode != 0 {
			wanted[socket.inode] = struct{}{}
		}
	}
	result := attributionResult{
		owners:          make(map[uint64][]ProcessAttribution),
		ownersTruncated: make(map[uint64]bool),
		notes:           make([]string, 0, 3),
	}
	if len(wanted) == 0 {
		return result
	}
	pids, processTruncated, err := dependencies.listPIDs(maxProcesses)
	if err != nil {
		result.restricted = true
		result.notes = append(result.notes, "process attribution unavailable: "+boundedError(err))
		return result
	}
	if len(pids) > maxProcesses {
		pids = pids[:maxProcesses]
		processTruncated = true
	}
	notes := make([]string, 0, 2)
	result.truncated = processTruncated
	result.restricted = processTruncated
	if processTruncated {
		notes = append(notes, "process attribution was truncated at 512 processes")
	}
	effectiveUID := dependencies.effectiveUID()
	fileDescriptors := 0
	for _, pid := range pids {
		if err := ctx.Err(); err != nil {
			result.truncated = true
			result.restricted = true
			notes = append(notes, "process attribution reached its 2 second wall-time limit")
			break
		}
		statusPath := fmt.Sprintf("/proc/%d/status", pid)
		status, err := dependencies.readFile(statusPath, maxProcStatusBytes)
		if err != nil {
			result.restricted = true
			continue
		}
		uid, err := parseEffectiveUID(status)
		if err != nil {
			result.restricted = true
			continue
		}
		if uid != effectiveUID {
			result.restricted = true
			continue
		}
		commContents, err := dependencies.readFile(fmt.Sprintf("/proc/%d/comm", pid), maxProcCommBytes)
		if err != nil {
			result.restricted = true
			continue
		}
		comm := boundedText(string(commContents), 256)
		if comm == "" {
			continue
		}
		remaining := maxFileDescriptors - fileDescriptors
		if remaining <= 0 {
			result.truncated = true
			result.restricted = true
			notes = append(notes, "process attribution was truncated at 16384 file descriptors")
			break
		}
		fds, fdTruncated, err := dependencies.listFDs(pid, remaining)
		if err != nil {
			result.restricted = true
			continue
		}
		if len(fds) > remaining {
			fds = fds[:remaining]
			fdTruncated = true
		}
		if fdTruncated {
			result.truncated = true
			result.restricted = true
			notes = append(notes, "process attribution was truncated at 16384 file descriptors")
		}
		fileDescriptors += len(fds)
		for _, fd := range fds {
			if err := ctx.Err(); err != nil {
				result.truncated = true
				result.restricted = true
				break
			}
			target, err := dependencies.readLink(fmt.Sprintf("/proc/%d/fd/%s", pid, fd))
			if err != nil {
				result.restricted = true
				continue
			}
			inode, ok := socketLinkInode(target)
			if !ok {
				continue
			}
			if _, needed := wanted[inode]; !needed {
				continue
			}
			owners := result.owners[inode]
			alreadyPresent := false
			for _, owner := range owners {
				if owner.PID == pid {
					alreadyPresent = true
					break
				}
			}
			if alreadyPresent {
				continue
			}
			if len(owners) == maxOwnersPerSocket {
				result.ownersTruncated[inode] = true
				result.truncated = true
				continue
			}
			result.owners[inode] = append(owners, ProcessAttribution{PID: pid, Comm: comm})
		}
	}
	for inode := range result.owners {
		sort.Slice(result.owners[inode], func(left, right int) bool {
			if result.owners[inode][left].PID != result.owners[inode][right].PID {
				return result.owners[inode][left].PID < result.owners[inode][right].PID
			}
			return result.owners[inode][left].Comm < result.owners[inode][right].Comm
		})
	}
	for range result.ownersTruncated {
		notes = append(notes, "one or more socket owner lists were truncated at 8 same-UID processes")
		break
	}
	result.notes = deduplicateNotes(append(result.notes, notes...))
	return result
}

func parseProcSocketTable(reader io.Reader, protocol string, maximum int) ([]Socket, bool, error) {
	if protocol != "tcp4" && protocol != "tcp6" && protocol != "udp4" && protocol != "udp6" {
		return nil, false, fmt.Errorf("unsupported proc socket protocol %q", protocol)
	}
	if maximum < 1 || maximum > maxSockets {
		return nil, false, fmt.Errorf("invalid socket parse limit")
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	result := make([]Socket, 0, min(maximum, 64))
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		if lineNumber == 1 {
			continue
		}
		if len(result) == maximum {
			return result, true, nil
		}
		fields := strings.Fields(scanner.Text())
		if len(fields) < 10 {
			return nil, false, fmt.Errorf("short socket record on line %d", lineNumber)
		}
		local, err := parseProcEndpoint(fields[1], strings.HasSuffix(protocol, "6"))
		if err != nil {
			return nil, false, fmt.Errorf("local endpoint on line %d: %w", lineNumber, err)
		}
		remote, err := parseProcEndpoint(fields[2], strings.HasSuffix(protocol, "6"))
		if err != nil {
			return nil, false, fmt.Errorf("remote endpoint on line %d: %w", lineNumber, err)
		}
		state, err := procSocketState(protocol, fields[3])
		if err != nil {
			return nil, false, fmt.Errorf("state on line %d: %w", lineNumber, err)
		}
		inode, err := strconv.ParseUint(fields[9], 10, 64)
		if err != nil {
			return nil, false, fmt.Errorf("inode on line %d: %w", lineNumber, err)
		}
		result = append(result, Socket{Protocol: protocol, State: state, Local: local, Remote: remote, Processes: make([]ProcessAttribution, 0), inode: inode})
	}
	if err := scanner.Err(); err != nil {
		return nil, false, err
	}
	if lineNumber == 0 {
		return nil, false, fmt.Errorf("socket table was empty")
	}
	return result, false, nil
}

func parseProcEndpoint(input string, ipv6 bool) (Endpoint, error) {
	addressHex, portHex, found := strings.Cut(input, ":")
	if !found || strings.Contains(portHex, ":") || len(portHex) != 4 {
		return Endpoint{}, fmt.Errorf("invalid proc endpoint")
	}
	port, err := strconv.ParseUint(portHex, 16, 16)
	if err != nil {
		return Endpoint{}, fmt.Errorf("invalid proc port")
	}
	expected := 8
	if ipv6 {
		expected = 32
	}
	if len(addressHex) != expected {
		return Endpoint{}, fmt.Errorf("invalid proc address length")
	}
	raw, err := hex.DecodeString(addressHex)
	if err != nil {
		return Endpoint{}, fmt.Errorf("invalid proc address")
	}
	if ipv6 {
		for offset := 0; offset < len(raw); offset += 4 {
			raw[offset], raw[offset+3] = raw[offset+3], raw[offset]
			raw[offset+1], raw[offset+2] = raw[offset+2], raw[offset+1]
		}
		var value [16]byte
		copy(value[:], raw)
		address := netip.AddrFrom16(value)
		return Endpoint{Address: address.String(), Port: uint16(port), Wildcard: address.IsUnspecified()}, nil
	}
	raw[0], raw[3] = raw[3], raw[0]
	raw[1], raw[2] = raw[2], raw[1]
	var value [4]byte
	copy(value[:], raw)
	address := netip.AddrFrom4(value)
	return Endpoint{Address: address.String(), Port: uint16(port), Wildcard: address.IsUnspecified()}, nil
}

var procTCPStates = map[string]string{
	"01": "ESTABLISHED",
	"02": "SYN_SENT",
	"03": "SYN_RECV",
	"04": "FIN_WAIT1",
	"05": "FIN_WAIT2",
	"06": "TIME_WAIT",
	"07": "CLOSE",
	"08": "CLOSE_WAIT",
	"09": "LAST_ACK",
	"0A": "LISTEN",
	"0B": "CLOSING",
	"0C": "NEW_SYN_RECV",
}

func procSocketState(protocol, input string) (string, error) {
	code := strings.ToUpper(input)
	if strings.HasPrefix(protocol, "udp") && code == "07" {
		return "UNCONNECTED", nil
	}
	state, ok := procTCPStates[code]
	if !ok {
		return "", fmt.Errorf("unknown Linux socket state %q", input)
	}
	return state, nil
}

func parseEffectiveUID(contents []byte) (int, error) {
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	scanner.Buffer(make([]byte, 4096), 64<<10)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 || fields[0] != "Uid:" {
			continue
		}
		if len(fields) < 3 {
			return 0, fmt.Errorf("short Uid status field")
		}
		value, err := strconv.ParseUint(fields[2], 10, 31)
		if err != nil {
			return 0, fmt.Errorf("invalid effective Uid")
		}
		return int(value), nil
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	return 0, fmt.Errorf("effective Uid missing")
}

func socketLinkInode(input string) (uint64, bool) {
	if !strings.HasPrefix(input, "socket:[") || !strings.HasSuffix(input, "]") {
		return 0, false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(input, "socket:["), "]")
	if value == "" || strings.ContainsAny(value, "[]/") {
		return 0, false
	}
	inode, err := strconv.ParseUint(value, 10, 64)
	return inode, err == nil && inode != 0
}

func listProcessIDs(maximum int) ([]int, bool, error) {
	names, truncated, err := listNumericDirectoryNames("/proc", maximum, maxProcProcessDirNames)
	if err != nil {
		return nil, false, err
	}
	result := make([]int, 0, len(names))
	for _, name := range names {
		value, err := strconv.Atoi(name)
		if err == nil && value > 0 {
			result = append(result, value)
		}
	}
	sort.Ints(result)
	return result, truncated, nil
}

func listFileDescriptors(pid, maximum int) ([]string, bool, error) {
	if pid < 1 {
		return nil, false, fmt.Errorf("invalid process id")
	}
	return listNumericDirectoryNames(fmt.Sprintf("/proc/%d/fd", pid), maximum, min(maximum+1, maxFileDescriptors+1))
}

func listNumericDirectoryNames(path string, maximum, scanLimit int) ([]string, bool, error) {
	if maximum < 1 {
		return nil, true, nil
	}
	if scanLimit < maximum || scanLimit > maxFileDescriptors+1 {
		return nil, false, fmt.Errorf("invalid directory scan limit")
	}
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	return readNumericNames(file.Readdirnames, maximum, scanLimit)
}

func readNumericNames(read func(int) ([]string, error), maximum, scanLimit int) ([]string, bool, error) {
	result := make([]string, 0, min(maximum, 128))
	scanned := 0
	for scanned < scanLimit {
		names, readErr := read(min(128, scanLimit-scanned))
		for _, name := range names {
			scanned++
			if !allDigits(name) {
				continue
			}
			if len(result) == maximum {
				return result, true, nil
			}
			result = append(result, name)
		}
		if errors.Is(readErr, io.EOF) {
			return result, false, nil
		}
		if readErr != nil {
			return nil, false, readErr
		}
	}
	return result, true, nil
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
