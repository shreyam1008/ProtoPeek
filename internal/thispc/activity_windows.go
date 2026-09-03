//go:build windows

package thispc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"time"

	"golang.org/x/sys/windows"
)

const (
	initialWindowsProcessImageChars = 512
	maxWindowsProcessImageChars     = 32768
)

type windowsActivityDependencies struct {
	tcpTable    windowsTableCall
	udpTable    windowsTableCall
	processName func(uint32) (string, error)
	now         func() time.Time
}

type windowsProcessDependencies struct {
	openProcess func(uint32, bool, uint32) (windows.Handle, error)
	queryImage  func(windows.Handle, uint32, *uint16, *uint32) error
	closeHandle func(windows.Handle) error
}

type windowsOwnerResolution struct {
	status  string
	process *ProcessAttribution
}

type windowsOwnerResolutionResult struct {
	owners    map[uint32]windowsOwnerResolution
	notes     []string
	truncated bool
}

func platformActivityCapability() (bool, string) { return true, "" }

func newActivityReader() activityReader {
	processes := windowsProcessDependencies{
		openProcess: windows.OpenProcess,
		queryImage:  windows.QueryFullProcessImageName,
		closeHandle: windows.CloseHandle,
	}
	dependencies := windowsActivityDependencies{
		tcpTable:    callWindowsExtendedTCPTable,
		udpTable:    callWindowsExtendedUDPTable,
		processName: processes.processName,
		now:         time.Now,
	}
	return dependencies.collect
}

func (dependencies windowsActivityDependencies) collect(parent context.Context) (Activity, error) {
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
			"Windows socket ownership comes from native IP Helper owner-PID tables. Process labels are best-effort executable basenames resolved with limited query rights; executable paths are not returned and ProtoPeek never requests elevation.",
			"Windows UDP rows report bound local endpoints only. A bound endpoint can be send-only and does not prove that it receives datagrams.",
		},
	}

	tables := []struct {
		label      string
		call       windowsTableCall
		family     uint32
		tableClass uint32
		parse      func([]byte, int) (windowsParsedSocketTable, error)
	}{
		{label: "tcp4", call: dependencies.tcpTable, family: windows.AF_INET, tableClass: windowsTCPTableOwnerPIDAll, parse: parseWindowsTCPTable},
		{label: "tcp6", call: dependencies.tcpTable, family: windows.AF_INET6, tableClass: windowsTCPTableOwnerPIDAll, parse: parseWindowsTCP6Table},
		{label: "udp4", call: dependencies.udpTable, family: windows.AF_INET, tableClass: windowsUDPTableOwnerPID, parse: parseWindowsUDPTable},
		{label: "udp6", call: dependencies.udpTable, family: windows.AF_INET6, tableClass: windowsUDPTableOwnerPID, parse: parseWindowsUDP6Table},
	}
	records := make([]windowsSocketRecord, 0)
	successfulTables := 0
	unknownStates := 0
	malformedRows := 0
	wallReached := false
	for _, table := range tables {
		if err := ctx.Err(); err != nil {
			wallReached = true
			break
		}
		remaining := maxSockets - len(records)
		if remaining <= 0 {
			result.Status = "partial"
			result.Truncated = true
			result.Notes = append(result.Notes, "local socket list was truncated at 4096 entries")
			break
		}
		contents, err := fetchWindowsTable(ctx, table.call, table.family, table.tableClass)
		if err != nil {
			if ctx.Err() != nil {
				wallReached = true
				break
			}
			result.Status = "partial"
			result.Notes = append(result.Notes, fmt.Sprintf("%s activity unavailable: %s", table.label, boundedError(err)))
			continue
		}
		parsed, err := table.parse(contents, remaining)
		if err != nil {
			result.Status = "partial"
			result.Notes = append(result.Notes, fmt.Sprintf("%s activity malformed: %s", table.label, boundedError(err)))
			continue
		}
		successfulTables++
		records = append(records, parsed.records...)
		unknownStates += parsed.unknownStates
		malformedRows += parsed.malformedRows
		if parsed.truncated {
			result.Status = "partial"
			result.Truncated = true
			result.Notes = append(result.Notes, "local socket list was truncated at 4096 entries")
			break
		}
	}
	if wallReached {
		result.Status = "partial"
		result.Truncated = true
		result.Notes = append(result.Notes, "local socket inspection reached its 2 second cooperative processing budget")
	}
	if successfulTables == 0 {
		if err := parent.Err(); err != nil {
			return result, err
		}
		return result, ErrActivityUnavailable
	}
	if unknownStates > 0 {
		result.Status = "partial"
		result.Notes = append(result.Notes, fmt.Sprintf("%d TCP rows used an unknown Windows state value", unknownStates))
	}
	if malformedRows > 0 {
		result.Status = "partial"
		result.Notes = append(result.Notes, fmt.Sprintf("%d malformed Windows socket rows were omitted", malformedRows))
	}

	resolved := dependencies.resolveOwners(ctx, records)
	if resolved.truncated {
		result.Status = "partial"
		result.Truncated = true
	}
	result.Notes = append(result.Notes, resolved.notes...)
	ownersUnavailable := 0
	for _, record := range records {
		socket := Socket{
			Protocol:  record.protocol,
			State:     record.state,
			Local:     record.local,
			Remote:    record.remote,
			Exposure:  socketExposure(record.local),
			Processes: make([]ProcessAttribution, 0, 1),
		}
		if record.ownerPID == 0 {
			// Windows uses PID 0 when owner information is unavailable. Keep the
			// existing wire vocabulary while avoiding the stronger claim that no
			// owner exists.
			socket.OwnerStatus = "restricted"
			ownersUnavailable++
		} else if owner, exists := resolved.owners[record.ownerPID]; exists {
			socket.OwnerStatus = owner.status
			if owner.process != nil {
				socket.Processes = append(socket.Processes, *owner.process)
			}
		} else {
			socket.OwnerStatus = "restricted"
		}
		if isListenerSocket(socket) {
			result.Listeners = append(result.Listeners, socket)
		} else {
			result.Connections = append(result.Connections, socket)
		}
	}
	if ownersUnavailable > 0 {
		result.Notes = append(result.Notes, fmt.Sprintf("ownership information was unavailable for %d socket rows that reported PID 0", ownersUnavailable))
	}
	result.Notes = deduplicateNotes(result.Notes)
	if err := parent.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func (dependencies windowsActivityDependencies) resolveOwners(ctx context.Context, records []windowsSocketRecord) windowsOwnerResolutionResult {
	wanted := make(map[uint32]struct{})
	for _, record := range records {
		if record.ownerPID != 0 {
			wanted[record.ownerPID] = struct{}{}
		}
	}
	pids := make([]uint32, 0, len(wanted))
	for pid := range wanted {
		pids = append(pids, pid)
	}
	sort.Slice(pids, func(left, right int) bool { return pids[left] < pids[right] })
	result := windowsOwnerResolutionResult{owners: make(map[uint32]windowsOwnerResolution, len(pids))}
	if len(pids) > maxProcesses {
		for _, pid := range pids[maxProcesses:] {
			result.owners[pid] = windowsOwnerResolution{status: "restricted"}
		}
		pids = pids[:maxProcesses]
		result.truncated = true
		result.notes = append(result.notes, "process attribution was truncated at 512 owner PIDs")
	}
	restricted := 0
	vanished := 0
	otherFailures := 0
	var firstOtherError error
	for index, pid := range pids {
		if err := ctx.Err(); err != nil {
			for _, remainingPID := range pids[index:] {
				result.owners[remainingPID] = windowsOwnerResolution{status: "restricted"}
			}
			result.truncated = true
			result.notes = append(result.notes, "process attribution reached its 2 second cooperative processing budget")
			break
		}
		if uint64(pid) > uint64(math.MaxInt) {
			result.owners[pid] = windowsOwnerResolution{status: "restricted"}
			otherFailures++
			continue
		}
		name, err := dependencies.processName(pid)
		switch {
		case err == nil && name != "":
			process := ProcessAttribution{PID: int(pid), Comm: name}
			result.owners[pid] = windowsOwnerResolution{status: "observed", process: &process}
		case errors.Is(err, windows.ERROR_ACCESS_DENIED):
			result.owners[pid] = windowsOwnerResolution{status: "restricted"}
			restricted++
		case errors.Is(err, windows.ERROR_INVALID_PARAMETER), errors.Is(err, windows.ERROR_NOT_FOUND), err == nil:
			result.owners[pid] = windowsOwnerResolution{status: "not-found"}
			vanished++
		default:
			result.owners[pid] = windowsOwnerResolution{status: "restricted"}
			otherFailures++
			if firstOtherError == nil {
				firstOtherError = err
			}
		}
	}
	if restricted > 0 {
		result.notes = append(result.notes, fmt.Sprintf("process names were access-restricted for %d owner PIDs", restricted))
	}
	if vanished > 0 {
		result.notes = append(result.notes, fmt.Sprintf("%d owner processes exited before their names could be resolved", vanished))
	}
	if otherFailures > 0 {
		note := fmt.Sprintf("process names were unavailable for %d additional owner PIDs", otherFailures)
		if firstOtherError != nil {
			note += ": " + boundedError(firstOtherError)
		}
		result.notes = append(result.notes, note)
	}
	return result
}

func (dependencies windowsProcessDependencies) processName(pid uint32) (string, error) {
	if pid == 0 {
		return "", windows.ERROR_INVALID_PARAMETER
	}
	if dependencies.openProcess == nil || dependencies.queryImage == nil || dependencies.closeHandle == nil {
		return "", fmt.Errorf("Windows process-name dependencies are incomplete")
	}
	handle, err := dependencies.openProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", fmt.Errorf("open process %d for its image name: %w", pid, err)
	}
	defer func() { _ = dependencies.closeHandle(handle) }()

	for characters := initialWindowsProcessImageChars; characters <= maxWindowsProcessImageChars; characters *= 2 {
		buffer := make([]uint16, characters)
		written := uint32(len(buffer))
		err = dependencies.queryImage(handle, 0, &buffer[0], &written)
		if err == nil {
			if written == 0 || written > uint32(len(buffer)) {
				return "", fmt.Errorf("process %d returned an invalid image-name length", pid)
			}
			name := boundedText(filepath.Base(windows.UTF16ToString(buffer[:written])), 256)
			if name == "" || name == "." || name == string(filepath.Separator) {
				return "", fmt.Errorf("process %d returned an empty image basename", pid)
			}
			return name, nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return "", fmt.Errorf("query process %d image name: %w", pid, err)
		}
	}
	return "", fmt.Errorf("process %d image name exceeded %d UTF-16 characters: %w", pid, maxWindowsProcessImageChars, windows.ERROR_INSUFFICIENT_BUFFER)
}
