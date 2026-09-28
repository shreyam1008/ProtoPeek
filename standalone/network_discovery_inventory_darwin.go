//go:build darwin

package standalone

import (
	"context"
	"os/exec"
)

func readNetworkNeighborRecords(ctx context.Context) ([]networkNeighborRecord, error) {
	// -n prevents reverse DNS; -a reads existing entries without probing.
	raw, err := runNetworkNeighborCommand(exec.CommandContext(ctx, "/usr/sbin/arp", "-an"))
	if err != nil {
		return nil, err
	}
	return parseDarwinNetworkNeighbors(string(raw)), nil
}
