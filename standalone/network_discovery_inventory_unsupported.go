//go:build !windows && !linux && !darwin

package standalone

import (
	"context"
	"fmt"
)

func readNetworkNeighborRecords(context.Context) ([]networkNeighborRecord, error) {
	return nil, fmt.Errorf("neighbor cache is supported on Windows, Linux, and macOS")
}
