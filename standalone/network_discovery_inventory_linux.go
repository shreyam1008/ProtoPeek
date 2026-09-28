//go:build linux

package standalone

import (
	"context"
	"fmt"
	"io"
	"os"
)

func readNetworkNeighborRecords(ctx context.Context) ([]networkNeighborRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open("/proc/net/arp")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (128<<10)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 128<<10 {
		return nil, fmt.Errorf("neighbor cache exceeds 128 KiB")
	}
	return parseLinuxNetworkNeighbors(string(raw)), nil
}
