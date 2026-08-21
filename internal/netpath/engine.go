// Package netpath performs bounded, active network-path observations.
//
// A hop RTT is measured from the ProtoPeek process to one responder. It is not
// the latency of the link between adjacent hops.
package netpath

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/netip"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

const (
	maxDestinationBytes     = 253
	maxResolvedAddresses    = 8
	maxResolutionCandidates = 32
	defaultMaxHops          = 24
	maxHops                 = 32
	defaultProbesPerHop     = 3
	maxProbesPerHop         = 4
	maxTotalProbes          = 96
	defaultProbeTimeout     = 750 * time.Millisecond
	minProbeTimeout         = 100 * time.Millisecond
	maxProbeTimeout         = 2 * time.Second
	defaultWallTimeout      = 20 * time.Second
	maxWallTimeout          = 30 * time.Second
	resolutionTimeout       = 2 * time.Second
	defaultUDPPort          = 33434
)

var (
	ErrInvalidRequest         = errors.New("invalid path trace request")
	ErrConsentRequired        = errors.New("path trace consent is required")
	ErrUnsupported            = errors.New("path trace method is unsupported")
	ErrResolve                = errors.New("resolve path trace destination")
	ErrInvalidBackendEvidence = errors.New("invalid path trace backend evidence")
)

// Resolver is the DNS boundary used by Engine.
type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

// RouteLookup obtains the kernel-selected route for a pinned destination.
type RouteLookup func(context.Context, netip.Addr) netroute.Result

// Backend is one native hop-discovery implementation.
type Backend interface {
	Capabilities(context.Context) []Capability
	Trace(context.Context, Target, TraceConfig) (BackendResult, error)
}

// Capability truthfully describes one probe method on the running platform.
type Capability struct {
	Backend     string   `json:"backend"`
	Method      string   `json:"method"`
	Families    []string `json:"families"`
	Available   bool     `json:"available"`
	Privilege   string   `json:"privilege"`
	Install     string   `json:"install"`
	Reason      string   `json:"reason,omitempty"`
	Limitations []string `json:"limitations"`
}

// Limits are fixed process resource limits, returned by the capabilities API.
type Limits struct {
	MaxDestinationBytes   int `json:"maxDestinationBytes"`
	MaxResolvedAddresses  int `json:"maxResolvedAddresses"`
	DefaultMaxHops        int `json:"defaultMaxHops"`
	MaxHops               int `json:"maxHops"`
	DefaultProbesPerHop   int `json:"defaultProbesPerHop"`
	MaxProbesPerHop       int `json:"maxProbesPerHop"`
	MaxTotalProbes        int `json:"maxTotalProbes"`
	DefaultProbeTimeoutMS int `json:"defaultProbeTimeoutMs"`
	MinProbeTimeoutMS     int `json:"minProbeTimeoutMs"`
	MaxProbeTimeoutMS     int `json:"maxProbeTimeoutMs"`
	DefaultWallTimeoutMS  int `json:"defaultWallTimeoutMs"`
	MaxWallTimeoutMS      int `json:"maxWallTimeoutMs"`
	MaxProbesPerSecond    int `json:"maxProbesPerSecond"`
	DefaultUDPPort        int `json:"defaultUdpPort"`
}

// FixedLimits returns a copy of ProtoPeek's path-trace resource limits.
func FixedLimits() Limits {
	return Limits{
		MaxDestinationBytes:   maxDestinationBytes,
		MaxResolvedAddresses:  maxResolvedAddresses,
		DefaultMaxHops:        defaultMaxHops,
		MaxHops:               maxHops,
		DefaultProbesPerHop:   defaultProbesPerHop,
		MaxProbesPerHop:       maxProbesPerHop,
		MaxTotalProbes:        maxTotalProbes,
		DefaultProbeTimeoutMS: int(defaultProbeTimeout / time.Millisecond),
		MinProbeTimeoutMS:     int(minProbeTimeout / time.Millisecond),
		MaxProbeTimeoutMS:     int(maxProbeTimeout / time.Millisecond),
		DefaultWallTimeoutMS:  int(defaultWallTimeout / time.Millisecond),
		MaxWallTimeoutMS:      int(maxWallTimeout / time.Millisecond),
		MaxProbesPerSecond:    20,
		DefaultUDPPort:        defaultUDPPort,
	}
}

// Consent records the explicit user action authorizing active probes.
type Consent struct {
	ActiveProbe  bool `json:"activeProbe"`
	PublicTarget bool `json:"publicTarget"`
}

// Request is the bounded input to Engine.Trace.
type Request struct {
	Destination       string  `json:"destination"`
	Family            string  `json:"family"`
	Method            string  `json:"method"`
	DestinationPort   int     `json:"destinationPort"`
	MaxHops           int     `json:"maxHops"`
	ProbesPerHop      int     `json:"probesPerHop"`
	PerProbeTimeoutMS int     `json:"perProbeTimeoutMs"`
	WallTimeoutMS     int     `json:"wallTimeoutMs"`
	Consent           Consent `json:"consent"`
}

// TraceConfig is the normalized, bounded input passed to a native backend.
type TraceConfig struct {
	Method          string
	DestinationPort int
	MaxHops         int
	ProbesPerHop    int
	PerProbeTimeout time.Duration
	WallTimeout     time.Duration
}

// Parameters are the normalized values returned to the caller.
type Parameters struct {
	Family            string `json:"family"`
	Method            string `json:"method"`
	DestinationPort   int    `json:"destinationPort"`
	MaxHops           int    `json:"maxHops"`
	ProbesPerHop      int    `json:"probesPerHop"`
	PerProbeTimeoutMS int    `json:"perProbeTimeoutMs"`
	WallTimeoutMS     int    `json:"wallTimeoutMs"`
}

// Target is a destination pinned for the entire trace after one resolution.
type Target struct {
	Address netip.Addr
	Port    int
}

// Sample is one probe at a TTL. A nil RTT means no matching reply was seen.
type Sample struct {
	Sequence  int      `json:"sequence"`
	Status    string   `json:"status"`
	Responder string   `json:"responder,omitempty"`
	RTTMillis *float64 `json:"rttMs"`
	ICMPType  *int     `json:"icmpType,omitempty"`
	ICMPCode  *int     `json:"icmpCode,omitempty"`
	Detail    string   `json:"detail,omitempty"`
}

// Hop preserves every sample and every distinct responder observed at one TTL.
type Hop struct {
	TTL        int      `json:"ttl"`
	Responders []string `json:"responders"`
	Samples    []Sample `json:"samples"`
}

// BackendResult is the evidence returned by a native backend.
type BackendResult struct {
	Backend     string
	Method      string
	Hops        []Hop
	Reached     bool
	Termination string
	Warnings    []string
}

// ResolvedAddress is one bounded answer from the system resolver.
type ResolvedAddress struct {
	Address string `json:"address"`
	Family  string `json:"family"`
}

// Resolution records the query, all retained answers, and the one pinned IP.
type Resolution struct {
	Input         string            `json:"input"`
	Source        string            `json:"source"`
	Network       string            `json:"network"`
	DurationMS    float64           `json:"durationMs"`
	Answers       []ResolvedAddress `json:"answers"`
	PinnedAddress string            `json:"pinnedAddress"`
	PinnedFamily  string            `json:"pinnedFamily"`
}

// Response is one complete or partial path observation.
type Response struct {
	Perspective string          `json:"perspective"`
	ObservedAt  string          `json:"observedAt"`
	Status      string          `json:"status"`
	Termination string          `json:"termination"`
	Reached     bool            `json:"reached"`
	Resolution  Resolution      `json:"resolution"`
	Route       netroute.Result `json:"route"`
	Backend     string          `json:"backend"`
	Method      string          `json:"method"`
	Parameters  Parameters      `json:"parameters"`
	Hops        []Hop           `json:"hops"`
	Warnings    []string        `json:"warnings"`
	DurationMS  float64         `json:"durationMs"`
}

// CapabilitiesResponse contains no probe results and sends no network packets.
type CapabilitiesResponse struct {
	Perspective  string       `json:"perspective"`
	OS           string       `json:"os"`
	Capabilities []Capability `json:"capabilities"`
	Limits       Limits       `json:"limits"`
	Warnings     []string     `json:"warnings"`
}

// Engine composes system resolution, kernel route evidence, and one backend.
type Engine struct {
	resolver Resolver
	lookup   RouteLookup
	backend  Backend
}

// NewEngine constructs a trace engine from explicit system boundaries.
func NewEngine(resolver Resolver, lookup RouteLookup, backend Backend) *Engine {
	return &Engine{resolver: resolver, lookup: lookup, backend: backend}
}

// Capabilities reports current-platform support without sending probes.
func (engine *Engine) Capabilities(ctx context.Context) CapabilitiesResponse {
	capabilities := engine.backend.Capabilities(ctx)
	if capabilities == nil {
		capabilities = make([]Capability, 0)
	}
	return CapabilitiesResponse{
		Perspective:  "protopeek-process",
		OS:           runtime.GOOS,
		Capabilities: capabilities,
		Limits:       FixedLimits(),
		Warnings: []string{
			"Capability checks do not send path probes.",
			"ProtoPeek never installs tools or requests elevation for path tracing.",
		},
	}
}

// Trace resolves once, pins one numeric destination, records the selected
// kernel route, and invokes exactly one bounded native backend.
func (engine *Engine) Trace(ctx context.Context, request Request) (Response, error) {
	started := time.Now()
	config, family, destination, err := normalizeRequest(request)
	if err != nil {
		return Response{}, err
	}
	if err := ctx.Err(); err != nil {
		return Response{}, err
	}

	traceCtx, cancel := context.WithTimeout(ctx, config.WallTimeout)
	defer cancel()
	resolution, address, err := engine.resolve(traceCtx, destination, family)
	if err != nil {
		return Response{}, err
	}
	if err := traceCtx.Err(); err != nil {
		return Response{}, err
	}
	if isPublicAddress(address) && !request.Consent.PublicTarget {
		return Response{}, fmt.Errorf("%w: public destinations require consent.publicTarget", ErrConsentRequired)
	}

	method, capability, err := selectCapability(engine.backend.Capabilities(traceCtx), config.Method, familyForAddress(address))
	if err != nil {
		return Response{}, err
	}
	config.Method = method
	parameters := parametersFor(config, familyForAddress(address))

	route := engine.lookup(traceCtx, address)
	if err := traceCtx.Err(); err != nil {
		return Response{}, err
	}
	result, err := engine.backend.Trace(traceCtx, Target{Address: address, Port: config.DestinationPort}, config)
	if err != nil {
		return Response{}, fmt.Errorf("trace with %s: %w", capability.Backend, err)
	}
	if err := validateBackendResult(result, capability, config); err != nil {
		return Response{}, err
	}
	if result.Hops == nil {
		result.Hops = make([]Hop, 0)
	}
	status := "partial"
	if result.Reached {
		status = "complete"
	} else if result.Termination == "cancelled" {
		status = "cancelled"
	}
	warnings := []string{
		"Each hop RTT is measured from the ProtoPeek process to that responder; it is not per-link latency.",
		"A timeout does not prove that a router or destination is down.",
		"Routing and load balancing can produce different responders for the same TTL.",
	}
	if resolution.Source == "system-dns" {
		warnings = append(warnings, "The system resolver does not expose which cache or upstream recursive resolver produced each answer.")
	}
	warnings = append(warnings, result.Warnings...)
	if route.Status != "ok" {
		warnings = append(warnings, "Kernel route evidence was unavailable; hop evidence is still preserved independently.")
	}
	return Response{
		Perspective: "protopeek-process",
		ObservedAt:  started.UTC().Format(time.RFC3339Nano),
		Status:      status,
		Termination: result.Termination,
		Reached:     result.Reached,
		Resolution:  resolution,
		Route:       route,
		Backend:     result.Backend,
		Method:      result.Method,
		Parameters:  parameters,
		Hops:        result.Hops,
		Warnings:    warnings,
		DurationMS:  millisecondsSince(started),
	}, nil
}

func normalizeRequest(request Request) (TraceConfig, string, string, error) {
	destination := strings.TrimSpace(request.Destination)
	if destination == "" {
		return TraceConfig{}, "", "", fmt.Errorf("%w: destination is required", ErrInvalidRequest)
	}
	if len(destination) > maxDestinationBytes {
		return TraceConfig{}, "", "", fmt.Errorf("%w: destination exceeds %d bytes", ErrInvalidRequest, maxDestinationBytes)
	}
	if !request.Consent.ActiveProbe {
		return TraceConfig{}, "", "", fmt.Errorf("%w: consent.activeProbe must be true", ErrConsentRequired)
	}

	family := strings.ToLower(strings.TrimSpace(request.Family))
	if family == "" {
		family = "auto"
	}
	if family != "auto" && family != "ipv4" && family != "ipv6" {
		return TraceConfig{}, "", "", fmt.Errorf("%w: family must be auto, ipv4, or ipv6", ErrInvalidRequest)
	}
	method := strings.ToLower(strings.TrimSpace(request.Method))
	if method == "" {
		method = "auto"
	}
	if method != "auto" && method != "udp" && method != "icmp" && method != "tcp" {
		return TraceConfig{}, "", "", fmt.Errorf("%w: method must be auto, udp, icmp, or tcp", ErrInvalidRequest)
	}

	config := TraceConfig{Method: method, DestinationPort: request.DestinationPort, MaxHops: request.MaxHops, ProbesPerHop: request.ProbesPerHop}
	if config.DestinationPort == 0 {
		config.DestinationPort = defaultUDPPort
	}
	if config.DestinationPort < 1 || config.DestinationPort > 65535 {
		return TraceConfig{}, "", "", fmt.Errorf("%w: destinationPort must be between 1 and 65535", ErrInvalidRequest)
	}
	if config.MaxHops == 0 {
		config.MaxHops = defaultMaxHops
	}
	if config.MaxHops < 1 || config.MaxHops > maxHops {
		return TraceConfig{}, "", "", fmt.Errorf("%w: maxHops must be between 1 and %d", ErrInvalidRequest, maxHops)
	}
	if config.ProbesPerHop == 0 {
		config.ProbesPerHop = defaultProbesPerHop
	}
	if config.ProbesPerHop < 1 || config.ProbesPerHop > maxProbesPerHop {
		return TraceConfig{}, "", "", fmt.Errorf("%w: probesPerHop must be between 1 and %d", ErrInvalidRequest, maxProbesPerHop)
	}
	if config.MaxHops*config.ProbesPerHop > maxTotalProbes {
		return TraceConfig{}, "", "", fmt.Errorf("%w: maxHops multiplied by probesPerHop exceeds %d", ErrInvalidRequest, maxTotalProbes)
	}
	if request.PerProbeTimeoutMS == 0 {
		config.PerProbeTimeout = defaultProbeTimeout
	} else if request.PerProbeTimeoutMS < int(minProbeTimeout/time.Millisecond) || request.PerProbeTimeoutMS > int(maxProbeTimeout/time.Millisecond) {
		return TraceConfig{}, "", "", fmt.Errorf("%w: perProbeTimeoutMs must be between %d and %d", ErrInvalidRequest, minProbeTimeout/time.Millisecond, maxProbeTimeout/time.Millisecond)
	} else {
		config.PerProbeTimeout = time.Duration(request.PerProbeTimeoutMS) * time.Millisecond
	}
	if request.WallTimeoutMS == 0 {
		config.WallTimeout = defaultWallTimeout
	} else if request.WallTimeoutMS < int(time.Second/time.Millisecond) || request.WallTimeoutMS > int(maxWallTimeout/time.Millisecond) {
		return TraceConfig{}, "", "", fmt.Errorf("%w: wallTimeoutMs must be between 1000 and %d", ErrInvalidRequest, maxWallTimeout/time.Millisecond)
	} else {
		config.WallTimeout = time.Duration(request.WallTimeoutMS) * time.Millisecond
	}
	return config, family, destination, nil
}

func parametersFor(config TraceConfig, family string) Parameters {
	return Parameters{
		Family:            family,
		Method:            config.Method,
		DestinationPort:   config.DestinationPort,
		MaxHops:           config.MaxHops,
		ProbesPerHop:      config.ProbesPerHop,
		PerProbeTimeoutMS: int(config.PerProbeTimeout / time.Millisecond),
		WallTimeoutMS:     int(config.WallTimeout / time.Millisecond),
	}
}

func (engine *Engine) resolve(ctx context.Context, destination, family string) (Resolution, netip.Addr, error) {
	started := time.Now()
	if address, err := netip.ParseAddr(destination); err == nil {
		address = address.Unmap()
		if err := validateAddress(address, family); err != nil {
			return Resolution{}, netip.Addr{}, err
		}
		resolved := ResolvedAddress{Address: address.String(), Family: familyForAddress(address)}
		return Resolution{
			Input:         destination,
			Source:        "literal",
			Network:       resolved.Family,
			DurationMS:    millisecondsSince(started),
			Answers:       []ResolvedAddress{resolved},
			PinnedAddress: resolved.Address,
			PinnedFamily:  resolved.Family,
		}, address, nil
	}
	if !validHostname(destination) {
		return Resolution{}, netip.Addr{}, fmt.Errorf("%w: destination must be an IP address or hostname", ErrInvalidRequest)
	}

	network := "ip"
	if family == "ipv4" {
		network = "ip4"
	} else if family == "ipv6" {
		network = "ip6"
	}
	resolveCtx, cancel := context.WithTimeout(ctx, resolutionTimeout)
	defer cancel()
	addresses, err := engine.resolver.LookupNetIP(resolveCtx, network, destination)
	if err != nil {
		return Resolution{}, netip.Addr{}, fmt.Errorf("%w: %w", ErrResolve, err)
	}
	answers := make([]ResolvedAddress, 0, min(len(addresses), maxResolvedAddresses))
	seen := make(map[netip.Addr]struct{}, min(len(addresses), maxResolvedAddresses))
	var pinned netip.Addr
	for index, address := range addresses {
		if index == maxResolutionCandidates {
			break
		}
		address = address.Unmap()
		if err := validateAddress(address, family); err != nil {
			return Resolution{}, netip.Addr{}, err
		}
		if _, duplicate := seen[address]; duplicate {
			continue
		}
		seen[address] = struct{}{}
		if !pinned.IsValid() {
			pinned = address
		}
		answers = append(answers, ResolvedAddress{Address: address.String(), Family: familyForAddress(address)})
		if len(answers) == maxResolvedAddresses {
			break
		}
	}
	if !pinned.IsValid() {
		return Resolution{}, netip.Addr{}, fmt.Errorf("%w: no %s addresses", ErrResolve, family)
	}
	return Resolution{
		Input:         destination,
		Source:        "system-dns",
		Network:       network,
		DurationMS:    millisecondsSince(started),
		Answers:       answers,
		PinnedAddress: pinned.String(),
		PinnedFamily:  familyForAddress(pinned),
	}, pinned, nil
}

func validateAddress(address netip.Addr, family string) error {
	if !address.IsValid() || address.IsUnspecified() {
		return fmt.Errorf("%w: unspecified addresses are not allowed", ErrInvalidRequest)
	}
	if family == "ipv4" && !address.Is4() || family == "ipv6" && !address.Is6() {
		return fmt.Errorf("%w: destination does not match requested family", ErrInvalidRequest)
	}
	if address.IsMulticast() {
		return fmt.Errorf("%w: multicast addresses are not allowed", ErrInvalidRequest)
	}
	if address.Is4() && address == netip.MustParseAddr("255.255.255.255") {
		return fmt.Errorf("%w: broadcast addresses are not allowed", ErrInvalidRequest)
	}
	if address.Is6() && address.IsLinkLocalUnicast() && address.Zone() == "" {
		return fmt.Errorf("%w: IPv6 link-local destinations require a zone", ErrInvalidRequest)
	}
	return nil
}

func validHostname(hostname string) bool {
	if hostname == "" || strings.ContainsAny(hostname, ":/[]%?#@ \t\r\n") {
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

func selectCapability(capabilities []Capability, requested, family string) (string, Capability, error) {
	method := requested
	if method == "auto" {
		method = "udp"
	}
	for _, capability := range capabilities {
		if capability.Available && capability.Method == method && slices.Contains(capability.Families, family) {
			return method, capability, nil
		}
	}
	return "", Capability{}, fmt.Errorf("%w: %s tracing for %s is unavailable", ErrUnsupported, method, family)
}

func familyForAddress(address netip.Addr) string {
	if address.Is4() {
		return "ipv4"
	}
	return "ipv6"
}

func isPublicAddress(address netip.Addr) bool {
	return address.IsGlobalUnicast() && !address.IsPrivate() && !address.IsLoopback() && !address.IsLinkLocalUnicast()
}

func millisecondsSince(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}

func validateBackendResult(result BackendResult, capability Capability, config TraceConfig) error {
	fail := func(format string, arguments ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidBackendEvidence, fmt.Sprintf(format, arguments...))
	}
	if result.Backend == "" || len(result.Backend) > 64 || result.Backend != capability.Backend {
		return fail("backend identity does not match the selected capability")
	}
	if result.Method != config.Method {
		return fail("method does not match the normalized request")
	}
	if !slices.Contains([]string{"reached", "max-hops", "unreachable", "deadline", "cancelled"}, result.Termination) {
		return fail("unknown termination %q", result.Termination)
	}
	if result.Reached != (result.Termination == "reached") {
		return fail("reached flag and termination disagree")
	}
	if len(result.Hops) > config.MaxHops {
		return fail("backend returned %d hops above the %d-hop request", len(result.Hops), config.MaxHops)
	}
	if len(result.Warnings) > 8 {
		return fail("backend returned too many warnings")
	}
	for _, warning := range result.Warnings {
		if len(warning) > 512 {
			return fail("backend warning exceeds 512 bytes")
		}
	}

	lastTTL := 0
	totalSamples := 0
	for _, hop := range result.Hops {
		if hop.TTL <= lastTTL || hop.TTL < 1 || hop.TTL > config.MaxHops {
			return fail("hop TTL %d is outside the requested ordered range", hop.TTL)
		}
		lastTTL = hop.TTL
		if len(hop.Samples) > config.ProbesPerHop || len(hop.Responders) > config.ProbesPerHop {
			return fail("hop %d exceeds its sample or responder cap", hop.TTL)
		}
		totalSamples += len(hop.Samples)
		if totalSamples > maxTotalProbes {
			return fail("backend returned more than %d samples", maxTotalProbes)
		}
		observedResponders := make([]string, 0, len(hop.Responders))
		seenSequences := make(map[int]struct{}, config.ProbesPerHop)
		for _, sample := range hop.Samples {
			if sample.Sequence < 1 || sample.Sequence > config.ProbesPerHop {
				return fail("sample sequence %d is outside the per-hop range", sample.Sequence)
			}
			if _, duplicate := seenSequences[sample.Sequence]; duplicate {
				return fail("sample sequence %d is duplicated", sample.Sequence)
			}
			seenSequences[sample.Sequence] = struct{}{}
			if !slices.Contains([]string{"reply", "timeout", "unreachable", "error"}, sample.Status) {
				return fail("sample %d has unknown status %q", sample.Sequence, sample.Status)
			}
			if len(sample.Detail) > 256 {
				return fail("sample %d detail exceeds 256 bytes", sample.Sequence)
			}
			if sample.RTTMillis != nil && (*sample.RTTMillis < 0 || math.IsNaN(*sample.RTTMillis) || math.IsInf(*sample.RTTMillis, 0)) {
				return fail("sample %d has an invalid RTT", sample.Sequence)
			}
			for _, value := range []*int{sample.ICMPType, sample.ICMPCode} {
				if value != nil && (*value < 0 || *value > 255) {
					return fail("sample %d has invalid ICMP evidence", sample.Sequence)
				}
			}
			if sample.Status == "timeout" {
				if sample.Responder != "" || sample.RTTMillis != nil || sample.ICMPType != nil || sample.ICMPCode != nil {
					return fail("timeout sample %d contains reply evidence", sample.Sequence)
				}
				continue
			}
			if sample.Status != "error" && sample.RTTMillis == nil {
				return fail("reply sample %d omits its RTT", sample.Sequence)
			}
			if sample.Responder != "" {
				if _, err := netip.ParseAddr(sample.Responder); err != nil {
					return fail("sample %d has invalid responder address", sample.Sequence)
				}
				if !slices.Contains(observedResponders, sample.Responder) {
					observedResponders = append(observedResponders, sample.Responder)
				}
			} else if sample.Status != "error" {
				return fail("reply sample %d omits its responder", sample.Sequence)
			}
		}
		if !slices.Equal(hop.Responders, observedResponders) {
			return fail("hop %d responder summary does not match its samples", hop.TTL)
		}
	}
	return nil
}
