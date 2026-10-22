package netdiag

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"time"
)

func (engine Engine) Run(parent context.Context, input Request) (Result, error) {
	if err := validateRequest(input); err != nil {
		return Result{}, err
	}
	started := time.Now()
	now := time.Now
	if engine.Now != nil {
		now = engine.Now
	}
	result := Result{Mode: input.Mode, ObservedAt: now().UTC().Format(time.RFC3339Nano), Complete: true,
		Outcome: "success", Addresses: []string{}, Checks: []Check{}, DNS: []DNSObservation{}, Samples: []Check{}, Warnings: []string{}}
	ctx, cancel := context.WithTimeout(parent, MaxDuration)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if input.Mode == "subnet" {
		value, err := planSubnet(input.Target)
		if err != nil {
			return Result{}, err
		}
		result.Target, result.Subnet = value.Prefix, value
		result.Summary = "Calculated locally. No addresses were contacted."
		return result, nil
	}
	if input.Mode == "dns" || input.Mode == "dns-compare" {
		if err := engine.runDNS(ctx, input, &result); err != nil {
			return Result{}, err
		}
		return finish(result, parent, ctx, started)
	}
	defaultPort := 443
	if input.Mode == "http2" {
		defaultPort = 80
	}
	if input.Mode == "tcp-exchange" || input.Mode == "udp-exchange" {
		defaultPort = 0
	}
	target, err := parseEndpoint(input.Target, defaultPort)
	if err != nil {
		return Result{}, err
	}
	result.Target = target.authority()
	resolveStarted := time.Now()
	addresses, err := engine.resolve(ctx, target.host)
	if err != nil {
		result.Checks = append(result.Checks, Check{Stage: "resolution", Address: target.host, Outcome: "failed", DurationMS: elapsed(resolveStarted), Detail: err.Error()})
		result.Outcome, result.Summary = "failed", "No connection attempted: target resolution failed."
		return finish(result, parent, ctx, started)
	}
	for _, address := range addresses {
		result.Addresses = append(result.Addresses, address.String())
	}
	if input.Mode == "diagnose" {
		result.Checks = append(result.Checks, Check{Stage: "resolution", Address: target.host, Outcome: "resolved", DurationMS: elapsed(resolveStarted), Detail: "This operation uses this observed, pinned address set."})
	}
	if input.Mode == "http-proxy" || input.Mode == "socks5-proxy" {
		if err := engine.proxy(ctx, input, target, addresses[0], &result); err != nil {
			return Result{}, err
		}
		return finish(result, parent, ctx, started)
	}
	if input.Mode == "availability" {
		engine.sample(ctx, input, target, addresses[0], &result)
		return finish(result, parent, ctx, started)
	}
	if input.Mode == "tcp-exchange" || input.Mode == "udp-exchange" {
		engine.exchange(ctx, input, target, addresses[0], &result)
		return finish(result, parent, ctx, started)
	}
	if input.Mode == "http2" {
		engine.http2(ctx, input, target, addresses[0], &result)
		return finish(result, parent, ctx, started)
	}
	if input.Mode == "http3" {
		engine.http3(ctx, input, target, addresses[0], &result)
		return finish(result, parent, ctx, started)
	}
	selected := addresses[:1]
	if input.Mode == "ip-compare" || input.Mode == "diagnose" {
		selected = addresses
	}
	for _, address := range selected {
		if ctx.Err() != nil {
			break
		}
		conn, check, closeConn := engine.connect(ctx, input.TimeoutMS, "tcp", target, address)
		result.Checks = append(result.Checks, check)
		if conn == nil {
			continue
		}
		if input.Mode == "tls" || (input.Mode == "diagnose" && input.TestTLS) {
			result.TLS, err = engine.inspectTLS(ctx, conn, input, target, address)
			closeConn()
			if err != nil {
				return Result{}, err
			}
			if !result.TLS.Verified {
				result.Outcome = "failed"
			}
		} else {
			closeConn()
		}
		if input.Mode == "diagnose" {
			break
		}
	}
	connected := slices.ContainsFunc(result.Checks, func(check Check) bool { return check.Outcome == "connected" })
	if !connected {
		result.Outcome, result.Summary = "failed", "No TCP connection was established."
	} else if result.TLS != nil {
		if result.TLS.Verified {
			result.Summary = "TLS verified with the displayed trust roots. No application request was sent."
		} else {
			result.Summary = "A TCP connection was established; TLS was not verified."
		}
	} else {
		result.Summary = "TCP evidence only. A connected port does not prove an HTTP or RPC service."
		if slices.ContainsFunc(result.Checks, func(check Check) bool { return check.Outcome != "connected" && check.Stage == "tcp" }) {
			result.Outcome = "partial"
		}
	}
	return finish(result, parent, ctx, started)
}

func finish(result Result, parent, ctx context.Context, started time.Time) (Result, error) {
	result.DurationMS = elapsed(started)
	if parent.Err() != nil {
		return result, parent.Err()
	}
	if ctx.Err() != nil {
		result.Complete, result.Outcome = false, "partial"
		result.Warnings = append(result.Warnings, "Stopped at the 15-second local safety limit; remaining work was not performed.")
	}
	return result, nil
}

func elapsed(started time.Time) float64 { return float64(time.Since(started).Microseconds()) / 1000 }

func (engine Engine) resolve(parent context.Context, hostname string) ([]netip.Addr, error) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	var addresses []netip.Addr
	if address, err := netip.ParseAddr(hostname); err == nil {
		addresses = []netip.Addr{address.Unmap()}
	} else {
		resolver := engine.Resolver
		if resolver == nil {
			resolver = net.DefaultResolver
		}
		var err error
		addresses, err = resolver.LookupNetIP(ctx, "ip", hostname)
		if err != nil {
			return nil, fmt.Errorf("ProtoPeek resolver: %w", err)
		}
	}
	if len(addresses) > 32 {
		return nil, fmt.Errorf("target resolved to more than 32 addresses; use an explicit IP")
	}
	broadcasts := localBroadcasts()
	unique := make(map[netip.Addr]bool)
	var v4, v6 []netip.Addr
	for _, address := range addresses {
		address = address.Unmap()
		if !usableAddress(address, broadcasts) {
			return nil, fmt.Errorf("target includes an unspecified, multicast, reserved or broadcast address")
		}
		if unique[address] {
			continue
		}
		unique[address] = true
		if address.Is4() {
			v4 = append(v4, address)
		} else {
			v6 = append(v6, address)
		}
	}
	slices.SortFunc(v4, netip.Addr.Compare)
	slices.SortFunc(v6, netip.Addr.Compare)
	// Require an explicit address rather than silently omit members of a family.
	if len(v4) > 4 {
		return nil, fmt.Errorf("target resolved to more than 4 IPv4 addresses; use an explicit IP")
	}
	if len(v6) > 4 {
		return nil, fmt.Errorf("target resolved to more than 4 IPv6 addresses; use an explicit IP")
	}
	selected := append(v4, v6...)
	if len(selected) == 0 {
		return nil, fmt.Errorf("no usable unicast address was returned")
	}
	return selected, nil
}

func usableAddress(address netip.Addr, broadcasts map[netip.Addr]bool) bool {
	if !address.IsValid() || address.IsUnspecified() || address.IsMulticast() || broadcasts[address.WithZone("")] {
		return false
	}
	if address.Is4() {
		value := address.As4()
		if value[0] == 0 || value[0] >= 224 || address == netip.MustParseAddr("255.255.255.255") {
			return false
		}
	}
	if address.IsLinkLocalUnicast() && address.Is6() && address.Zone() == "" {
		return false
	}
	return address.IsGlobalUnicast() || address.IsLoopback() || address.IsLinkLocalUnicast()
}

func localBroadcasts() map[netip.Addr]bool {
	result := make(map[netip.Addr]bool)
	addresses, _ := net.InterfaceAddrs()
	for _, entry := range addresses {
		prefix, err := netip.ParsePrefix(entry.String())
		if err != nil || !prefix.Addr().Is4() || prefix.Bits() < 1 || prefix.Bits() > 30 {
			continue
		}
		bytes := prefix.Masked().Addr().As4()
		for bit := prefix.Bits(); bit < 32; bit++ {
			bytes[bit/8] |= 1 << (7 - bit%8)
		}
		result[netip.AddrFrom4(bytes)] = true
	}
	return result
}
