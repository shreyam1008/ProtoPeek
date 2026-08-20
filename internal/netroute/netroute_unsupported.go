//go:build !linux && !darwin && !windows

package netroute

import (
	"context"
	"net/netip"
)

const backendName = "unsupported"

func lookupPlatform(_ context.Context, _ netip.Addr, result Result) (Result, error) {
	result.Notes = append(result.Notes, "supported backends are Linux netlink, Darwin routing sockets, and Windows GetBestRoute2")
	return result, errUnsupported
}
