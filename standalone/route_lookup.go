package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

const (
	maxRouteLookupBodyBytes = 16 << 10
	maxRouteDestination     = 253
	maxRouteAddresses       = 8
	maxConcurrentRoutes     = 4
	routeLookupDeadline     = 2 * time.Second
)

// RouteLookupRequest is the JSON body for POST /api/route/lookup.
type RouteLookupRequest struct {
	Destination string `json:"destination"`
	Family      string `json:"family"`
}

// RouteLookupResponse describes one bounded observation from the running
// ProtoPeek process. Results remain ordered as returned by the resolver.
type RouteLookupResponse struct {
	Perspective string            `json:"perspective"`
	ObservedAt  string            `json:"observedAt"`
	Results     []netroute.Result `json:"results"`
}

type routeResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type routeLookupFunc func(context.Context, netip.Addr) netroute.Result

// RouteLookupHandler returns the bounded POST /api/route/lookup endpoint. The
// caller must enforce ProtoPeek's local-access and CSRF policy.
func RouteLookupHandler() http.HandlerFunc {
	return routeLookupHandler(net.DefaultResolver, netroute.Lookup)
}

func routeLookupHandler(resolver routeResolver, lookup routeLookupFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), routeLookupDeadline)
		defer cancel()
		r = r.WithContext(ctx)
		if r.ContentLength > maxRouteLookupBodyBytes {
			http.Error(w, "Request body is too large", http.StatusRequestEntityTooLarge)
			return
		}

		var request RouteLookupRequest
		if !decodeJSONRequest(w, r, maxRouteLookupBodyBytes, &request) {
			return
		}
		destination := strings.TrimSpace(request.Destination)
		if destination == "" {
			http.Error(w, "destination is required", http.StatusBadRequest)
			return
		}
		if len(destination) > maxRouteDestination {
			http.Error(w, fmt.Sprintf("destination exceeds %d bytes", maxRouteDestination), http.StatusBadRequest)
			return
		}
		family := strings.ToLower(strings.TrimSpace(request.Family))
		if family == "" {
			family = "auto"
		}
		if family != "auto" && family != "ipv4" && family != "ipv6" {
			http.Error(w, "family must be auto, ipv4, or ipv6", http.StatusBadRequest)
			return
		}

		addresses, err := resolveRouteDestination(ctx, resolver, destination, family)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, context.Canceled) {
				status = 499
			} else if errors.Is(err, context.DeadlineExceeded) {
				status = http.StatusGatewayTimeout
			} else if !errors.Is(err, errInvalidRouteDestination) {
				status = http.StatusBadGateway
			}
			http.Error(w, err.Error(), status)
			return
		}

		results := lookupRoutes(ctx, addresses, lookup)
		if err := ctx.Err(); err != nil {
			writeRouteContextError(w, err)
			return
		}
		response := RouteLookupResponse{
			Perspective: "protopeek-process",
			ObservedAt:  time.Now().UTC().Format(time.RFC3339Nano),
			Results:     results,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(response)
	}
}

var errInvalidRouteDestination = errors.New("invalid route destination")

func resolveRouteDestination(ctx context.Context, resolver routeResolver, destination, family string) ([]netip.Addr, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if address, err := netip.ParseAddr(destination); err == nil {
		address = address.Unmap()
		if family == "ipv4" && !address.Is4() || family == "ipv6" && !address.Is6() {
			return nil, fmt.Errorf("%w: destination does not match requested family", errInvalidRouteDestination)
		}
		if err := validateRouteAddress(address); err != nil {
			return nil, err
		}
		return []netip.Addr{address}, nil
	}
	if !validRouteHostname(destination) {
		return nil, fmt.Errorf("%w: destination must be an IP address or hostname", errInvalidRouteDestination)
	}

	network := "ip"
	if family == "ipv4" {
		network = "ip4"
	} else if family == "ipv6" {
		network = "ip6"
	}
	resolved, err := resolver.LookupNetIP(ctx, network, destination)
	if err != nil {
		return nil, fmt.Errorf("resolve destination: %w", err)
	}
	addresses := make([]netip.Addr, 0, min(len(resolved), maxRouteAddresses))
	seen := make(map[netip.Addr]struct{}, len(resolved))
	for _, address := range resolved {
		address = address.Unmap()
		if family == "ipv4" && !address.Is4() || family == "ipv6" && !address.Is6() {
			continue
		}
		if err := validateRouteAddress(address); err != nil {
			return nil, err
		}
		if _, exists := seen[address]; exists {
			continue
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
		if len(addresses) == maxRouteAddresses {
			break
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("resolve destination: no %s addresses", family)
	}
	return addresses, nil
}

func writeRouteContextError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, context.Canceled) {
		status = 499
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	}
	http.Error(w, err.Error(), status)
}

func validateRouteAddress(address netip.Addr) error {
	if !address.IsValid() || address.IsUnspecified() {
		return fmt.Errorf("%w: unspecified addresses are not allowed", errInvalidRouteDestination)
	}
	if address.IsMulticast() {
		return fmt.Errorf("%w: multicast addresses are not allowed", errInvalidRouteDestination)
	}
	if address.Is4() && address == netip.MustParseAddr("255.255.255.255") {
		return fmt.Errorf("%w: broadcast addresses are not allowed", errInvalidRouteDestination)
	}
	if address.Is6() && address.IsLinkLocalUnicast() && address.Zone() == "" {
		return fmt.Errorf("%w: IPv6 link-local destinations require a zone", errInvalidRouteDestination)
	}
	return nil
}

func validRouteHostname(hostname string) bool {
	if hostname == "" || strings.ContainsAny(hostname, ":/[]%?#@ 	\n") {
		return false
	}
	trimmed := strings.TrimSuffix(hostname, ".")
	if trimmed == "" {
		return false
	}
	for _, label := range strings.Split(trimmed, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' {
				continue
			}
			return false
		}
	}
	return true
}

func lookupRoutes(ctx context.Context, addresses []netip.Addr, lookup routeLookupFunc) []netroute.Result {
	results := make([]netroute.Result, len(addresses))
	jobs := make(chan int)
	workers := min(maxConcurrentRoutes, len(addresses))
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for index := range jobs {
				if err := ctx.Err(); err != nil {
					results[index] = cancelledRouteResult(addresses[index], err)
					continue
				}
				results[index] = lookup(ctx, addresses[index])
			}
		}()
	}
	for index := range addresses {
		if ctx.Err() != nil {
			break
		}
		select {
		case jobs <- index:
		case <-ctx.Done():
			break
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(jobs)
	group.Wait()
	for index := range results {
		if results[index].Status == "" {
			results[index] = cancelledRouteResult(addresses[index], ctx.Err())
		}
	}
	return results
}

func cancelledRouteResult(address netip.Addr, err error) netroute.Result {
	if err == nil {
		err = context.Canceled
	}
	family := "ipv6"
	if address.Is4() {
		family = "ipv4"
	}
	return netroute.Result{
		Destination: address.String(),
		Family:      family,
		Status:      "error",
		Backend:     "not-dispatched",
		Notes:       make([]string, 0),
		Error:       err.Error(),
	}
}
