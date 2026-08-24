//go:build linux

package thispc

import (
	"bufio"
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	maxKernelReleaseBytes = 4 << 10
	maxUptimeBytes        = 4 << 10
	maxMeminfoBytes       = 128 << 10
)

func newSystemReader() systemReader {
	return func(ctx context.Context) (*LinuxSystemSnapshot, []string) {
		result := &LinuxSystemSnapshot{}
		notes := make([]string, 0)
		if err := ctx.Err(); err != nil {
			return result, []string{"Linux system details unavailable: " + boundedError(err)}
		}

		if contents, err := readBoundedFile("/proc/sys/kernel/osrelease", maxKernelReleaseBytes); err != nil {
			notes = append(notes, "Linux kernel release unavailable: "+boundedError(err))
		} else if value := boundedText(string(contents), 255); value == "" {
			notes = append(notes, "Linux kernel release was empty")
		} else {
			result.KernelRelease = value
		}

		if contents, err := readBoundedFile("/proc/uptime", maxUptimeBytes); err != nil {
			notes = append(notes, "Linux uptime unavailable: "+boundedError(err))
		} else if value, parseErr := parseProcUptime(string(contents)); parseErr != nil {
			notes = append(notes, "Linux uptime malformed: "+boundedError(parseErr))
		} else {
			result.UptimeSeconds = value
		}

		if contents, err := readBoundedFile("/proc/meminfo", maxMeminfoBytes); err != nil {
			notes = append(notes, "Linux memory information unavailable: "+boundedError(err))
		} else {
			total, available, parseNotes := parseProcMeminfo(string(contents))
			result.TotalMemoryBytes = total
			result.AvailableMemoryBytes = available
			notes = append(notes, parseNotes...)
		}
		return result, notes
	}
}

func parseProcUptime(input string) (string, error) {
	fields := strings.Fields(input)
	if len(fields) != 2 {
		return "", fmt.Errorf("expected uptime and idle-time fields")
	}
	whole, err := parseProcDecimalWhole(fields[0])
	if err != nil {
		return "", fmt.Errorf("uptime is malformed: %w", err)
	}
	if _, err := parseProcDecimalWhole(fields[1]); err != nil {
		return "", fmt.Errorf("idle time is malformed: %w", err)
	}
	return strconv.FormatUint(whole, 10), nil
}

func parseProcDecimalWhole(value string) (uint64, error) {
	if len(value) > 64 {
		return 0, fmt.Errorf("decimal value is too long")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" || !decimalDigits(parts[0]) {
		return 0, fmt.Errorf("value is not a non-negative decimal")
	}
	if len(parts) == 2 && (parts[1] == "" || !decimalDigits(parts[1])) {
		return 0, fmt.Errorf("decimal fraction is invalid")
	}
	whole, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("whole seconds overflow uint64")
	}
	return whole, nil
}

func parseProcMeminfo(input string) (string, string, []string) {
	var total string
	var available string
	seen := make(map[string]bool, 2)
	invalid := make(map[string]bool, 2)
	scanner := bufio.NewScanner(strings.NewReader(input))
	scanner.Buffer(make([]byte, 4096), 64<<10)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 {
			continue
		}
		var destination *string
		key := ""
		switch fields[0] {
		case "MemTotal:":
			destination = &total
			key = fields[0]
		case "MemAvailable:":
			destination = &available
			key = fields[0]
		default:
			continue
		}
		if seen[key] {
			invalid[key] = true
			*destination = ""
			continue
		}
		seen[key] = true
		if len(fields) != 3 || fields[2] != "kB" {
			invalid[key] = true
			*destination = ""
			continue
		}
		kilobytes, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || kilobytes > math.MaxUint64/1024 {
			invalid[key] = true
			*destination = ""
			continue
		}
		*destination = strconv.FormatUint(kilobytes*1024, 10)
	}
	if invalid["MemTotal:"] {
		total = ""
	}
	if invalid["MemAvailable:"] {
		available = ""
	}
	notes := make([]string, 0, 2)
	if err := scanner.Err(); err != nil {
		notes = append(notes, "Linux memory information malformed: "+boundedError(err))
	}
	if total == "" {
		notes = append(notes, "Linux total memory was missing or malformed")
	}
	if available == "" {
		notes = append(notes, "Linux available memory was missing or malformed")
	}
	return total, available, notes
}

func decimalDigits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != ""
}
