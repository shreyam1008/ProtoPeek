//go:build darwin

package netpath

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"slices"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

const darwinBackendName = "darwin-icmp-datagram"

type darwinBackend struct{}

func newPlatformBackend() Backend { return darwinBackend{} }

func openDarwinEcho(ipv6 bool) (*icmp.PacketConn, error) {
	network, bind := "udp4", "0.0.0.0"
	if ipv6 {
		network, bind = "udp6", "::"
	}
	connection, err := icmp.ListenPacket(network, bind)
	if err != nil {
		return nil, err
	}
	if err := setDarwinHopLimit(connection, ipv6, 1); err != nil {
		connection.Close()
		return nil, err
	}
	return connection, nil
}

func setDarwinHopLimit(connection *icmp.PacketConn, ipv6 bool, ttl int) error {
	if ipv6 {
		return connection.IPv6PacketConn().SetHopLimit(ttl)
	}
	return connection.IPv4PacketConn().SetTTL(ttl)
}

func (darwinBackend) Capabilities(ctx context.Context) []Capability {
	capabilities := []Capability{}
	for _, family := range []string{"ipv4", "ipv6"} {
		capability := Capability{Backend: darwinBackendName, Method: "icmp", Families: []string{family}, Privilege: "none", Install: "built-in", Limitations: []string{
			"Native unprivileged ICMP datagrams; routers can suppress or rate-limit echo and hop-expiry replies.",
			"RTT measures this process to a matching responder, not delay between routers. ICMP is not authenticated.",
			"Capability checks only open a socket and set its hop limit; they send no probes.",
		}}
		if err := ctx.Err(); err != nil {
			capability.Reason = err.Error()
		} else if connection, err := openDarwinEcho(family == "ipv6"); err != nil {
			capability.Reason = fmt.Sprintf("Native ICMP socket unavailable: %v", err)
		} else {
			capability.Available = true
			connection.Close()
		}
		capabilities = append(capabilities, capability)
	}
	for _, method := range []string{"udp", "tcp"} {
		capabilities = append(capabilities, Capability{Backend: darwinBackendName, Method: method, Families: []string{}, Privilege: "none", Install: "not-offered", Reason: "The native macOS path backend offers ICMP echo only.", Limitations: []string{}})
	}
	return capabilities
}

func validateDarwinTrace(target Target, config TraceConfig) error {
	address := target.Address.Unmap()
	if !address.IsValid() || address.IsUnspecified() || address.IsMulticast() || address == netip.MustParseAddr("255.255.255.255") {
		return fmt.Errorf("%w: invalid ICMP trace destination", ErrInvalidRequest)
	}
	if config.Method != "icmp" {
		return fmt.Errorf("%w: macOS path backend offers ICMP echo only", ErrUnsupported)
	}
	if config.MaxHops < 1 || config.MaxHops > maxHops || config.ProbesPerHop < 1 || config.ProbesPerHop > maxProbesPerHop || config.MaxHops*config.ProbesPerHop > maxTotalProbes {
		return fmt.Errorf("%w: probe count exceeds fixed limits", ErrInvalidRequest)
	}
	if config.PerProbeTimeout < minProbeTimeout || config.PerProbeTimeout > maxProbeTimeout || config.WallTimeout < time.Second || config.WallTimeout > maxWallTimeout {
		return fmt.Errorf("%w: probe timeout exceeds fixed limits", ErrInvalidRequest)
	}
	return nil
}

func (darwinBackend) Trace(parent context.Context, target Target, config TraceConfig) (BackendResult, error) {
	result := BackendResult{Backend: darwinBackendName, Method: "icmp", Hops: []Hop{}, Termination: "max-hops", Warnings: []string{"Unprivileged macOS ICMP echo; no external traceroute, elevation, DNS enrichment or background monitoring is used."}}
	if err := validateDarwinTrace(target, config); err != nil {
		return result, err
	}
	if err := parent.Err(); err != nil {
		return result, err
	}
	target.Address = target.Address.Unmap()
	ctx, cancel := context.WithTimeout(parent, config.WallTimeout)
	defer cancel()
	connection, err := openDarwinEcho(target.Address.Is6())
	if err != nil {
		return result, fmt.Errorf("open native ICMP socket: %w", err)
	}
	defer connection.Close()
	stop := context.AfterFunc(ctx, func() { connection.Close() })
	defer stop()
	var random [18]byte
	if _, err := rand.Read(random[:]); err != nil {
		return result, err
	}
	identifier, nonce := binary.BigEndian.Uint16(random[:2]), random[2:]
	sequence := uint16(0)
	var lastSent time.Time
	finish := func(hop Hop) {
		if len(hop.Samples) > 0 {
			result.Hops = append(result.Hops, hop)
		}
		result.Termination = "deadline"
		if errors.Is(parent.Err(), context.Canceled) {
			result.Termination = "cancelled"
		}
	}
	for ttl := 1; ttl <= config.MaxHops; ttl++ {
		hop := Hop{TTL: ttl, Responders: []string{}, Samples: []Sample{}}
		terminal := ""
		for sampleIndex := 1; sampleIndex <= config.ProbesPerHop; sampleIndex++ {
			if !lastSent.IsZero() {
				wait := time.Until(lastSent.Add(50 * time.Millisecond))
				if wait > 0 {
					timer := time.NewTimer(wait)
					select {
					case <-timer.C:
					case <-ctx.Done():
					}
					timer.Stop()
				}
			}
			if ctx.Err() != nil {
				finish(hop)
				return result, nil
			}
			if err := setDarwinHopLimit(connection, target.Address.Is6(), ttl); err != nil {
				if ctx.Err() != nil {
					finish(hop)
					return result, nil
				}
				return result, fmt.Errorf("set ICMP hop limit: %w", err)
			}
			sequence++
			lastSent = time.Now()
			sample, end, err := probeDarwinEcho(ctx, connection, target.Address, identifier, sequence, nonce, sampleIndex, config.PerProbeTimeout)
			if ctx.Err() != nil {
				finish(hop)
				return result, nil
			}
			if err != nil {
				return result, err
			}
			hop.Samples = append(hop.Samples, sample)
			if sample.Responder != "" && !slices.Contains(hop.Responders, sample.Responder) {
				hop.Responders = append(hop.Responders, sample.Responder)
			}
			if end == "reached" || terminal == "" {
				terminal = end
			}
		}
		result.Hops = append(result.Hops, hop)
		if terminal != "" {
			result.Termination, result.Reached = terminal, terminal == "reached"
			return result, nil
		}
	}
	return result, nil
}

func probeDarwinEcho(ctx context.Context, connection *icmp.PacketConn, target netip.Addr, identifier, sequence uint16, nonce []byte, sampleIndex int, timeout time.Duration) (Sample, string, error) {
	var messageType icmp.Type = ipv4.ICMPTypeEcho
	if target.Is6() {
		messageType = ipv6.ICMPTypeEchoRequest
	}
	message := icmp.Message{Type: messageType, Body: &icmp.Echo{ID: int(identifier), Seq: int(sequence), Data: nonce}}
	raw, err := message.Marshal(nil)
	if err != nil {
		return Sample{}, "", err
	}
	deadline := time.Now().Add(timeout)
	if wall, ok := ctx.Deadline(); ok && wall.Before(deadline) {
		deadline = wall
	}
	if err := connection.SetDeadline(deadline); err != nil {
		return Sample{}, "", err
	}
	sent := time.Now()
	n, err := connection.WriteTo(raw, &net.UDPAddr{IP: net.IP(target.AsSlice()), Zone: target.Zone()})
	if err != nil {
		return Sample{}, "", fmt.Errorf("send native ICMP echo: %w", err)
	}
	if n != len(raw) {
		return Sample{}, "", fmt.Errorf("send native ICMP echo: %w", io.ErrShortWrite)
	}
	buffer := make([]byte, 2048)
	for range 256 {
		n, peer, err := connection.ReadFrom(buffer)
		if err != nil {
			var failure net.Error
			if errors.As(err, &failure) && failure.Timeout() {
				return Sample{Sequence: sampleIndex, Status: "timeout"}, "", nil
			}
			return Sample{}, "", fmt.Errorf("read native ICMP evidence: %w", err)
		}
		if n == len(buffer) {
			continue
		}
		address, ok := darwinPeerAddress(peer)
		if !ok || address.IsUnspecified() || address.IsMulticast() {
			continue
		}
		evidence, matched := matchEchoEvidence(buffer[:n], target, identifier, sequence, nonce)
		if !matched || (evidence.kind == "echo" && address.WithZone("") != target.WithZone("")) {
			continue
		}
		rtt := float64(time.Since(sent)) / float64(time.Millisecond)
		sample := Sample{Sequence: sampleIndex, Status: "reply", Responder: address.String(), RTTMillis: &rtt, ICMPType: &evidence.messageType, ICMPCode: &evidence.code}
		switch evidence.kind {
		case "echo":
			sample.Detail = "Matching ICMP echo reply"
			return sample, "reached", nil
		case "unreachable":
			sample.Status, sample.Detail = "unreachable", "Matching destination-unreachable quote"
			return sample, "unreachable", nil
		default:
			sample.Detail = "Matching hop-limit-expired quote"
			return sample, "", nil
		}
	}
	return Sample{Sequence: sampleIndex, Status: "error", Detail: "Reply inspection reached 256 datagrams without matching this probe."}, "", nil
}

func darwinPeerAddress(peer net.Addr) (netip.Addr, bool) {
	var ip net.IP
	var zone string
	switch peer := peer.(type) {
	case *net.UDPAddr:
		ip, zone = peer.IP, peer.Zone
	case *net.IPAddr:
		ip, zone = peer.IP, peer.Zone
	default:
		return netip.Addr{}, false
	}
	address, ok := netip.AddrFromSlice(ip)
	if ok {
		address = address.Unmap()
		if address.Is6() {
			address = address.WithZone(zone)
		}
	}
	return address, ok
}
