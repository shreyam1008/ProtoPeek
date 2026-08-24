//go:build linux

package thispc

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

const maxProcNetDevBytes = 1 << 20

func platformTrafficCapability() (bool, string) { return true, "" }

func newCounterReader() counterReader {
	return func(ctx context.Context) (map[string]rawCounters, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		file, err := os.Open("/proc/net/dev")
		if err != nil {
			return nil, fmt.Errorf("read Linux interface counters: %w", err)
		}
		defer file.Close()
		return parseProcNetDev(io.LimitReader(file, maxProcNetDevBytes+1))
	}
}

func parseProcNetDev(reader io.Reader) (map[string]rawCounters, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	result := make(map[string]rawCounters)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		if lineNumber <= 2 {
			continue
		}
		line := scanner.Text()
		separator := strings.LastIndexByte(line, ':')
		if separator < 1 {
			return nil, fmt.Errorf("invalid /proc/net/dev line %d", lineNumber)
		}
		name := strings.TrimSpace(line[:separator])
		if name == "" || len(name) > 255 {
			return nil, fmt.Errorf("invalid /proc/net/dev interface on line %d", lineNumber)
		}
		if _, duplicate := result[name]; duplicate {
			return result, fmt.Errorf("duplicate /proc/net/dev interface %q", name)
		}
		if len(result) == maxSnapshotInterfaces {
			return result, fmt.Errorf("/proc/net/dev exceeded %d interfaces", maxSnapshotInterfaces)
		}
		fields := strings.Fields(line[separator+1:])
		if len(fields) < 16 {
			return nil, fmt.Errorf("short /proc/net/dev line %d", lineNumber)
		}
		values := make([]uint64, 16)
		for index := range values {
			value, err := strconv.ParseUint(fields[index], 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid /proc/net/dev counter on line %d: %w", lineNumber, err)
			}
			values[index] = value
		}
		result[name] = rawCounters{
			receivedBytes:      values[0],
			receivedPackets:    values[1],
			receivedErrors:     values[2],
			receivedDropped:    values[3],
			transmittedBytes:   values[8],
			transmittedPackets: values[9],
			transmittedErrors:  values[10],
			transmittedDropped: values[11],
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read /proc/net/dev: %w", err)
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("/proc/net/dev contained no interface counters")
	}
	return result, nil
}
