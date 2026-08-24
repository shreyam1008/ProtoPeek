//go:build linux

package thispc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestParseProcEndpointUsesKernelByteOrderAndWildcard(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input    string
		ipv6     bool
		address  string
		port     uint16
		wildcard bool
	}{
		{input: "0100007F:1F90", address: "127.0.0.1", port: 8080},
		{input: "00000000:0000", address: "0.0.0.0", wildcard: true},
		{input: "00000000000000000000000001000000:01BB", ipv6: true, address: "::1", port: 443},
		{input: "00000000000000000000000000000000:0000", ipv6: true, address: "::", wildcard: true},
	}
	for _, test := range tests {
		endpoint, err := parseProcEndpoint(test.input, test.ipv6)
		if err != nil || endpoint.Address != test.address || endpoint.Port != test.port || endpoint.Wildcard != test.wildcard {
			t.Errorf("parseProcEndpoint(%q, %v) = %#v, %v", test.input, test.ipv6, endpoint, err)
		}
	}
}

func TestParseProcSocketTableStatesAndKinds(t *testing.T) {
	t.Parallel()
	fixture := "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n" +
		"   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 42\n" +
		"   1: 0100007F:C350 08080808:01BB 01 00000000:00000000 00:00000000 00000000 1000 0 43\n"
	sockets, truncated, err := parseProcSocketTable(strings.NewReader(fixture), "tcp4", 8)
	if err != nil || truncated || len(sockets) != 2 {
		t.Fatalf("parseProcSocketTable() = %#v, %v, %v", sockets, truncated, err)
	}
	if sockets[0].State != "LISTEN" || !isListenerSocket(sockets[0]) || sockets[0].Local.Address != "0.0.0.0" {
		t.Fatalf("listener = %#v", sockets[0])
	}
	if sockets[1].State != "ESTABLISHED" || isListenerSocket(sockets[1]) || sockets[1].Remote.Address != "8.8.8.8" {
		t.Fatalf("connection = %#v", sockets[1])
	}
	if state, err := procSocketState("tcp4", "07"); err != nil || state != "CLOSE" {
		t.Fatalf("TCP state 07 = %q, %v", state, err)
	}
	if state, err := procSocketState("udp4", "07"); err != nil || state != "UNCONNECTED" {
		t.Fatalf("UDP state 07 = %q, %v", state, err)
	}
	if _, err := procSocketState("tcp4", "FF"); err == nil {
		t.Fatal("unknown state was accepted")
	}
}

func TestAttributionReturnsAllBoundedSameUIDOwnersAndReadsOnlyAllowedPaths(t *testing.T) {
	t.Parallel()
	readPaths := make([]string, 0)
	fdPIDs := make([]int, 0)
	dependencies := activityDependencies{
		readFile: func(path string, _ int64) ([]byte, error) {
			readPaths = append(readPaths, path)
			if strings.Contains(path, "cmdline") || strings.Contains(path, "environ") || strings.Contains(path, "/cwd") || strings.Contains(path, "/exe") {
				t.Fatalf("prohibited procfs path read: %s", path)
			}
			switch path {
			case "/proc/10/status", "/proc/20/status":
				return []byte("Name:\ttest\nUid:\t1000\t1000\t1000\t1000\n"), nil
			case "/proc/30/status":
				return []byte("Uid:\t2000\t2000\t2000\t2000\n"), nil
			case "/proc/10/comm":
				return []byte("alpha\n"), nil
			case "/proc/20/comm":
				return []byte("beta\n"), nil
			default:
				return nil, errors.New("unexpected path")
			}
		},
		listPIDs: func(limit int) ([]int, bool, error) {
			if limit != maxProcesses {
				t.Fatalf("process limit = %d", limit)
			}
			return []int{20, 10, 30}, false, nil
		},
		listFDs: func(pid, limit int) ([]string, bool, error) {
			fdPIDs = append(fdPIDs, pid)
			if limit > maxFileDescriptors {
				t.Fatalf("fd limit = %d", limit)
			}
			return []string{"3"}, false, nil
		},
		readLink: func(path string) (string, error) {
			if path != "/proc/10/fd/3" && path != "/proc/20/fd/3" {
				t.Fatalf("unexpected link path %q", path)
			}
			return "socket:[42]", nil
		},
		effectiveUID: func() int { return 1000 },
		now:          time.Now,
	}
	result := dependencies.attribute(context.Background(), []Socket{{inode: 42}})
	owners := result.owners[42]
	if len(owners) != 2 || owners[0].PID != 10 || owners[0].Comm != "alpha" || owners[1].PID != 20 || owners[1].Comm != "beta" {
		t.Fatalf("owners = %#v", owners)
	}
	if !result.restricted {
		t.Fatal("different-UID process did not make the attribution scope explicit")
	}
	if fmt.Sprint(fdPIDs) != "[20 10]" {
		t.Fatalf("fd scans = %v", fdPIDs)
	}
	for _, path := range readPaths {
		if !strings.HasSuffix(path, "/status") && !strings.HasSuffix(path, "/comm") {
			t.Fatalf("unexpected procfs read: %s", path)
		}
	}
}

func TestAttributionCapsOwnersPerSocket(t *testing.T) {
	t.Parallel()
	pids := make([]int, maxOwnersPerSocket+1)
	for index := range pids {
		pids[index] = index + 1
	}
	dependencies := activityDependencies{
		readFile: func(path string, _ int64) ([]byte, error) {
			if strings.HasSuffix(path, "/status") {
				return []byte("Uid:\t1000\t1000\t1000\t1000\n"), nil
			}
			return []byte("shared\n"), nil
		},
		listPIDs:     func(int) ([]int, bool, error) { return pids, false, nil },
		listFDs:      func(int, int) ([]string, bool, error) { return []string{"1"}, false, nil },
		readLink:     func(string) (string, error) { return "socket:[99]", nil },
		effectiveUID: func() int { return 1000 },
		now:          time.Now,
	}
	result := dependencies.attribute(context.Background(), []Socket{{inode: 99}})
	if len(result.owners[99]) != maxOwnersPerSocket || !result.ownersTruncated[99] || !result.truncated {
		t.Fatalf("owner bound = %#v", result)
	}
}

func TestSocketExposureIsAuthoritative(t *testing.T) {
	t.Parallel()
	tests := map[Endpoint]string{
		{Address: "0.0.0.0", Wildcard: true}: "all-interfaces",
		{Address: "::", Wildcard: true}:      "all-interfaces",
		{Address: "127.0.0.1"}:               "loopback-only",
		{Address: "::1"}:                     "loopback-only",
		{Address: "192.168.1.2"}:             "interface-bound",
		{Address: "bad"}:                     "unknown",
	}
	for endpoint, want := range tests {
		if got := socketExposure(endpoint); got != want {
			t.Errorf("socketExposure(%#v) = %q, want %q", endpoint, got, want)
		}
	}
}

func TestNumericFDScanDoesNotSilentlyStopAt4096(t *testing.T) {
	t.Parallel()
	names := make([]string, 5001)
	for index := range names {
		names[index] = strconv.Itoa(index)
	}
	cursor := 0
	read := func(maximum int) ([]string, error) {
		if cursor == len(names) {
			return nil, io.EOF
		}
		end := min(len(names), cursor+maximum)
		page := names[cursor:end]
		cursor = end
		return page, nil
	}
	result, truncated, err := readNumericNames(read, 5000, 5001)
	if err != nil || !truncated || len(result) != 5000 || result[4999] != "4999" {
		t.Fatalf("readNumericNames() len=%d truncated=%v err=%v", len(result), truncated, err)
	}
}

func TestParseEffectiveUIDUsesEffectiveColumn(t *testing.T) {
	t.Parallel()
	uid, err := parseEffectiveUID([]byte("Uid:\t1\t2\t3\t4\n"))
	if err != nil || uid != 2 {
		t.Fatalf("parseEffectiveUID() = %d, %v", uid, err)
	}
}
