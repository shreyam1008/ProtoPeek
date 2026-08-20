// Package netroute returns read-only kernel route evidence for one destination.
// It never traces hops, mutates the route table, or sends network packets.
package netroute

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
)

// Result is the kernel-selected route as observed by the ProtoPeek process.
// Optional route fields are pointers so an unknown value is not confused with
// a real zero value.
type Result struct {
	Destination    string   `json:"destination"`
	Family         string   `json:"family"`
	Status         string   `json:"status"`
	SourceIP       string   `json:"sourceIp"`
	InterfaceIndex int      `json:"interfaceIndex"`
	InterfaceName  string   `json:"interfaceName"`
	NextHop        string   `json:"nextHop"`
	OnLink         bool     `json:"onLink"`
	Local          bool     `json:"local"`
	Prefix         *int     `json:"prefix"`
	RouteMetric    *int     `json:"routeMetric"`
	Table          *int     `json:"table"`
	Backend        string   `json:"backend"`
	Notes          []string `json:"notes"`
	Error          string   `json:"error"`
}

// Lookup asks the current operating-system kernel for its selected route to
// destination. Errors are represented in Result so callers can preserve
// per-address failures in a multi-address response.
func Lookup(ctx context.Context, destination netip.Addr) Result {
	result := newResult(destination, backendName)
	if !destination.IsValid() {
		return fail(result, errors.New("route destination is invalid"))
	}
	destination = destination.Unmap()
	result = newResult(destination, backendName)
	if err := ctx.Err(); err != nil {
		return fail(result, err)
	}
	result, err := lookupPlatform(ctx, destination, result)
	if err != nil {
		return fail(result, err)
	}
	if result.Notes == nil {
		result.Notes = make([]string, 0)
	}
	result.Status = "ok"
	return result
}

func newResult(destination netip.Addr, backend string) Result {
	family := "ipv6"
	if destination.Is4() {
		family = "ipv4"
	}
	return Result{
		Destination: destination.String(),
		Family:      family,
		Status:      "error",
		Backend:     backend,
		Notes:       make([]string, 0),
	}
}

func fail(result Result, err error) Result {
	if errors.Is(err, errUnsupported) {
		result.Status = "unsupported"
	} else {
		result.Status = "error"
	}
	result.Error = err.Error()
	if result.Notes == nil {
		result.Notes = make([]string, 0)
	}
	return result
}

func interfaceEvidence(result *Result, index int) {
	result.InterfaceIndex = index
	if index <= 0 {
		return
	}
	iface, err := net.InterfaceByIndex(index)
	if err != nil {
		result.Notes = append(result.Notes, fmt.Sprintf("interface name unavailable: %v", err))
		return
	}
	result.InterfaceName = iface.Name
}

var errUnsupported = errors.New("kernel route lookup is unsupported on this operating system")
