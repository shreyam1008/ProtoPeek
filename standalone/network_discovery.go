package standalone

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	maxNetworkDiscoveryBodyBytes   = 16 << 10
	minNetworkDiscoveryPrefix      = 24
	maxNetworkDiscoveryPorts       = 18
	maxNetworkDiscoveryAttempts    = 4_572
	maxNetworkDiscoveryWorkers     = 32
	maxNetworkInterfaceSuggestions = 32
	networkDiscoveryDeadline       = 15 * time.Second

	maxNetworkDiscoveryProtocolsPerPort     = 16
	maxNetworkDiscoveryProtocolBytes        = 256
	maxNetworkDiscoveryServicesPerPort      = 16
	maxNetworkDiscoveryServiceBytes         = 512
	maxNetworkDiscoveryReflectionBytes      = 256
	maxNetworkDiscoveryHTTPProtocolBytes    = 256
	maxNetworkDiscoveryHTTPStatusBytes      = 256
	maxNetworkDiscoveryHTTPServerBytes      = 512
	maxNetworkDiscoveryEvidenceNotesPerPort = 32
	maxNetworkDiscoveryEvidenceNoteBytes    = 2 << 10
	maxNetworkDiscoveryEvidenceNotesBytes   = 2 << 10
	maxNetworkDiscoveryVerboseEvidenceBytes = 64 << 10
)

const networkDiscoveryPerPortTruncationNote = "Additional protocol evidence was truncated to the network discovery safety limits."

// Application inspection is deliberately limited to ports used by the web
// and gRPC profiles. Every other selected port receives one TCP connect only.
var networkDiscoveryApplicationInspectionPorts = []uint16{
	80, 443, 3000, 4000, 5000, 6565, 7000, 7443, 8000, 8080, 8443, 9090, 50051,
}

// NetworkDiscoveryRequest describes one explicit, bounded private-network
// service observation. Consent is required because this operation opens TCP
// connections to other devices.
type NetworkDiscoveryRequest struct {
	CIDR    string `json:"cidr"`
	Profile string `json:"profile"`
	Consent bool   `json:"consent"`
}

// NetworkDiscoveryProfile is an exact, visible port plan. Profiles are kept
// small on purpose; broad port scanning remains an external Nmap workflow.
type NetworkDiscoveryProfile struct {
	ID                    string   `json:"id"`
	Label                 string   `json:"label"`
	Description           string   `json:"description"`
	Ports                 []uint16 `json:"ports"`
	ApplicationProbePorts []uint16 `json:"applicationProbePorts"`
}

type NetworkInterfaceSuggestion struct {
	Index         int    `json:"index"`
	Name          string `json:"name"`
	Address       string `json:"address"`
	InterfaceCIDR string `json:"interfaceCidr"`
	SuggestedCIDR string `json:"suggestedCidr"`
}

type NetworkDiscoveryLimits struct {
	MinimumPrefix int `json:"minimumPrefix"`
	MaxPorts      int `json:"maxPorts"`
	MaxAttempts   int `json:"maxAttempts"`
	MaxWorkers    int `json:"maxWorkers"`
	DeadlineMS    int `json:"deadlineMs"`
}

// NetworkDiscoveryCapabilities is a no-probe description of exact profiles
// and locally visible interface suggestions.
type NetworkDiscoveryCapabilities struct {
	Perspective string                       `json:"perspective"`
	ActiveProbe bool                         `json:"activeProbe"`
	Profiles    []NetworkDiscoveryProfile    `json:"profiles"`
	Limits      NetworkDiscoveryLimits       `json:"limits"`
	Interfaces  []NetworkInterfaceSuggestion `json:"interfaces"`
	Warnings    []string                     `json:"warnings"`
}

// NetworkPortEvidence is observed from the ProtoPeek process. An open port is
// not a claim about device identity or reachability from another vantage point.
type NetworkPortEvidence struct {
	Port            uint16   `json:"port"`
	State           string   `json:"state"`
	Provenance      string   `json:"provenance"`
	Protocols       []string `json:"protocols"`
	GRPC            bool     `json:"grpc"`
	HTTP            bool     `json:"http"`
	Reflection      string   `json:"reflection"`
	Services        []string `json:"services"`
	HTTPProtocol    string   `json:"httpProtocol"`
	HTTPStatus      string   `json:"httpStatus"`
	HTTPServer      string   `json:"httpServer"`
	ProbeDurationMs int64    `json:"probeDurationMs"`
	EvidenceNotes   []string `json:"evidenceNotes"`
}

// NetworkHostHint is deliberately probabilistic. A hint is derived from the
// selected ports/protocols and can be overridden by the user in saved topology.
type NetworkHostHint struct {
	Label      string `json:"label"`
	Confidence string `json:"confidence"`
	Provenance string `json:"provenance"`
	Reason     string `json:"reason"`
}

type NetworkDiscoveredHost struct {
	Address string                `json:"address"`
	Ports   []NetworkPortEvidence `json:"ports"`
	Hints   []NetworkHostHint     `json:"hints"`
}

// NetworkDiscoveryResponse retains only positive service evidence. A host not
// present in Hosts was not observed on the selected ports; it is not "offline".
type NetworkDiscoveryResponse struct {
	Perspective     string                  `json:"perspective"`
	ObservedAt      string                  `json:"observedAt"`
	CIDR            string                  `json:"cidr"`
	Profile         NetworkDiscoveryProfile `json:"profile"`
	HostCount       int                     `json:"hostCount"`
	AttemptsPlanned int                     `json:"attemptsPlanned"`
	// AttemptsCompleted counts probe calls that returned, including calls that
	// returned because their context was cancelled. It does not prove that each
	// call opened a connection or reached the selected target.
	AttemptsCompleted int                     `json:"attemptsCompleted"`
	Complete          bool                    `json:"complete"`
	StoppedReason     string                  `json:"stoppedReason,omitempty"`
	Hosts             []NetworkDiscoveredHost `json:"hosts"`
	Warnings          []string                `json:"warnings"`
}

type networkDiscoveryPlan struct {
	CIDR      netip.Prefix
	Profile   NetworkDiscoveryProfile
	Addresses []netip.Addr
	Attempts  int
}

type networkProbeFunc func(context.Context, netip.Addr, uint16) ScanResult
type networkCandidateProbeFunc func(context.Context, scanCandidate) ScanResult

func networkDiscoveryProfiles() []NetworkDiscoveryProfile {
	return []NetworkDiscoveryProfile{
		newNetworkDiscoveryProfile(
			"quick",
			"Quick services",
			"HTTP, HTTPS, gRPC, and a common local API port.",
			[]uint16{80, 443, 50051, 8080},
		),
		newNetworkDiscoveryProfile(
			"grpc",
			"gRPC common",
			"A visible set of ports frequently used by gRPC development services.",
			[]uint16{443, 6565, 7000, 7443, 9090, 50051},
		),
		newNetworkDiscoveryProfile(
			"web",
			"Web and API",
			"Common local HTTP and HTTPS development ports.",
			[]uint16{80, 443, 3000, 4000, 5000, 8000, 8080, 8443},
		),
		newNetworkDiscoveryProfile(
			"expanded",
			"Expanded services",
			"A bounded service inventory; this is still not a full port scan.",
			[]uint16{
				22, 53, 80, 443, 445, 631, 1883, 3000, 3306, 3389, 5432, 6379,
				8000, 8080, 8443, 9090, 9100, 50051,
			},
		),
	}
}

func newNetworkDiscoveryProfile(id, label, description string, ports []uint16) NetworkDiscoveryProfile {
	profile := NetworkDiscoveryProfile{
		ID:                    id,
		Label:                 label,
		Description:           description,
		Ports:                 append([]uint16(nil), ports...),
		ApplicationProbePorts: make([]uint16, 0, len(ports)),
	}
	for _, port := range ports {
		if networkDiscoveryInspectsApplicationPort(port) {
			profile.ApplicationProbePorts = append(profile.ApplicationProbePorts, port)
		}
	}
	return profile
}

func NetworkDiscoveryCapabilitiesHandler() http.HandlerFunc {
	return networkDiscoveryCapabilitiesHandler(listNetworkInterfaceSuggestions)
}

func networkDiscoveryCapabilitiesHandler(
	listInterfaces func() ([]NetworkInterfaceSuggestion, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		interfaces, err := listInterfaces()
		warnings := []string{
			"Loading capabilities does not send network probes.",
			"Interface scopes are suggestions only; review the exact CIDR and attempt count before consenting.",
			"At most 32 unique private IPv4 interface suggestions are returned; configured CIDRs that are not wholly inside RFC 1918 are omitted rather than rewritten.",
			networkDiscoveryInspectionDisclosure(),
			networkDiscoveryEvidenceBudgetDisclosure,
		}
		if err != nil {
			interfaces = make([]NetworkInterfaceSuggestion, 0)
			warnings = append(warnings, "Private interface suggestions are unavailable: "+err.Error())
		} else {
			var stats networkInterfaceSuggestionStats
			interfaces, stats = normalizeNetworkInterfaceSuggestions(interfaces)
			if stats.invalid > 0 {
				warnings = append(warnings, "Some local interface records could not be represented truthfully as bounded RFC 1918 IPv4 suggestions and were omitted.")
			}
			if stats.duplicates > 0 {
				warnings = append(warnings, "Duplicate interface suggestions were collapsed before returning capabilities.")
			}
			if stats.overflow > 0 {
				warnings = append(warnings, fmt.Sprintf("Local interface suggestions were capped at %d entries; %d additional unique records were omitted.", maxNetworkInterfaceSuggestions, stats.overflow))
			}
		}
		response := NetworkDiscoveryCapabilities{
			Perspective: "protopeek-process",
			ActiveProbe: false,
			Profiles:    networkDiscoveryProfiles(),
			Limits: NetworkDiscoveryLimits{
				MinimumPrefix: minNetworkDiscoveryPrefix,
				MaxPorts:      maxNetworkDiscoveryPorts,
				MaxAttempts:   maxNetworkDiscoveryAttempts,
				MaxWorkers:    maxNetworkDiscoveryWorkers,
				DeadlineMS:    int(networkDiscoveryDeadline / time.Millisecond),
			},
			Interfaces: interfaces,
			Warnings:   warnings,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(response)
	}
}

type networkInterfaceSuggestionStats struct {
	invalid    int
	duplicates int
	overflow   int
}

var networkDiscoveryPrivatePrefixes = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
}

func normalizeNetworkInterfaceSuggestions(
	input []NetworkInterfaceSuggestion,
) ([]NetworkInterfaceSuggestion, networkInterfaceSuggestionStats) {
	stats := networkInterfaceSuggestionStats{}
	normalized := make([]NetworkInterfaceSuggestion, 0, min(len(input), maxNetworkInterfaceSuggestions))
	for _, suggestion := range input {
		name := suggestion.Name
		address, addressErr := netip.ParseAddr(suggestion.Address)
		prefix, prefixErr := netip.ParsePrefix(suggestion.InterfaceCIDR)
		if suggestion.Index <= 0 || strings.TrimSpace(name) == "" || len(name) > 256 ||
			!utf8.ValidString(name) || strings.ContainsRune(name, '\x00') || addressErr != nil ||
			prefixErr != nil || !address.Is4() || !prefix.Addr().Is4() {
			stats.invalid++
			continue
		}
		address = address.Unmap()
		prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()).Masked()
		if !address.IsPrivate() || !prefix.Contains(address) || !networkDiscoveryPrefixIsPrivate(prefix) {
			stats.invalid++
			continue
		}
		normalized = append(normalized, NetworkInterfaceSuggestion{
			Index:         suggestion.Index,
			Name:          name,
			Address:       address.String(),
			InterfaceCIDR: prefix.String(),
			SuggestedCIDR: suggestedDiscoveryCIDR(netip.PrefixFrom(address, prefix.Bits())).String(),
		})
	}
	sort.Slice(normalized, func(i, j int) bool {
		if normalized[i].Index != normalized[j].Index {
			return normalized[i].Index < normalized[j].Index
		}
		if normalized[i].Address != normalized[j].Address {
			return normalized[i].Address < normalized[j].Address
		}
		if normalized[i].InterfaceCIDR != normalized[j].InterfaceCIDR {
			return normalized[i].InterfaceCIDR < normalized[j].InterfaceCIDR
		}
		return normalized[i].Name < normalized[j].Name
	})
	type suggestionKey struct {
		index   int
		address string
	}
	seen := make(map[suggestionKey]struct{}, len(normalized))
	unique := normalized[:0]
	for _, suggestion := range normalized {
		key := suggestionKey{
			index:   suggestion.Index,
			address: suggestion.Address,
		}
		if _, exists := seen[key]; exists {
			stats.duplicates++
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, suggestion)
	}
	if len(unique) > maxNetworkInterfaceSuggestions {
		stats.overflow = len(unique) - maxNetworkInterfaceSuggestions
		unique = unique[:maxNetworkInterfaceSuggestions]
	}
	return unique, stats
}

func networkDiscoveryPrefixIsPrivate(prefix netip.Prefix) bool {
	for _, privatePrefix := range networkDiscoveryPrivatePrefixes {
		if prefix.Bits() >= privatePrefix.Bits() && privatePrefix.Contains(prefix.Addr()) {
			return true
		}
	}
	return false
}

func listNetworkInterfaceSuggestions() ([]NetworkInterfaceSuggestion, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list network interfaces: %w", err)
	}
	suggestions := make([]NetworkInterfaceSuggestion, 0)
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, raw := range addresses {
			prefix, err := netip.ParsePrefix(raw.String())
			if err != nil || !prefix.Addr().Is4() || !prefix.Addr().IsPrivate() {
				continue
			}
			address := prefix.Addr().Unmap()
			prefix = netip.PrefixFrom(address, prefix.Bits()).Masked()
			suggestions = append(suggestions, NetworkInterfaceSuggestion{
				Index:         iface.Index,
				Name:          iface.Name,
				Address:       address.String(),
				InterfaceCIDR: prefix.String(),
				SuggestedCIDR: suggestedDiscoveryCIDR(netip.PrefixFrom(address, prefix.Bits())).String(),
			})
		}
	}
	bounded, _ := normalizeNetworkInterfaceSuggestions(suggestions)
	return bounded, nil
}

func suggestedDiscoveryCIDR(prefix netip.Prefix) netip.Prefix {
	bits := max(prefix.Bits(), minNetworkDiscoveryPrefix)
	return netip.PrefixFrom(prefix.Addr().Unmap(), bits).Masked()
}

func buildNetworkDiscoveryPlan(request NetworkDiscoveryRequest) (networkDiscoveryPlan, error) {
	if !request.Consent {
		return networkDiscoveryPlan{}, fmt.Errorf("active private-network discovery requires explicit consent")
	}
	rawCIDR := strings.TrimSpace(request.CIDR)
	if !strings.Contains(rawCIDR, "/") {
		return networkDiscoveryPlan{}, fmt.Errorf("scope must be an explicit IPv4 CIDR")
	}
	prefix, err := netip.ParsePrefix(rawCIDR)
	if err != nil || !prefix.Addr().Is4() {
		return networkDiscoveryPlan{}, fmt.Errorf("scope must be a valid private IPv4 CIDR")
	}
	prefix = prefix.Masked()
	if prefix.Bits() < minNetworkDiscoveryPrefix {
		return networkDiscoveryPlan{}, fmt.Errorf("scope may be no broader than /%d", minNetworkDiscoveryPrefix)
	}
	if !prefix.Addr().IsPrivate() || prefix.Addr().IsLoopback() {
		return networkDiscoveryPlan{}, fmt.Errorf("scope must be a private IPv4 CIDR")
	}

	profileID := strings.ToLower(strings.TrimSpace(request.Profile))
	if profileID == "" {
		profileID = "quick"
	}
	var profile NetworkDiscoveryProfile
	for _, candidate := range networkDiscoveryProfiles() {
		if candidate.ID == profileID {
			profile = candidate
			break
		}
	}
	if profile.ID == "" {
		return networkDiscoveryPlan{}, fmt.Errorf("unknown network discovery profile")
	}

	addresses := addressesInDiscoveryPrefix(prefix)
	attempts := len(addresses) * len(profile.Ports)
	if attempts == 0 || attempts > maxNetworkDiscoveryAttempts {
		return networkDiscoveryPlan{}, fmt.Errorf("network plan exceeds the %d-attempt limit", maxNetworkDiscoveryAttempts)
	}
	return networkDiscoveryPlan{
		CIDR:      prefix,
		Profile:   profile,
		Addresses: addresses,
		Attempts:  attempts,
	}, nil
}

func addressesInDiscoveryPrefix(prefix netip.Prefix) []netip.Addr {
	hosts := 1 << (32 - prefix.Bits())
	addresses := make([]netip.Addr, 0, hosts)
	address := prefix.Addr()
	for index := 0; index < hosts; index++ {
		// Traditional IPv4 network and broadcast addresses are not host
		// candidates. /31 point-to-point and /32 scopes retain every address.
		if prefix.Bits() >= 31 || index != 0 && index != hosts-1 {
			addresses = append(addresses, address)
		}
		address = address.Next()
	}
	return addresses
}

// NetworkDiscoveryHandler returns the bounded active private-network endpoint.
// The caller must enforce ProtoPeek's local-access, CSRF, and process-admission
// policy before invoking this handler.
func NetworkDiscoveryHandler() http.HandlerFunc {
	return networkDiscoveryHandler(probeNetworkService)
}

func networkDiscoveryHandler(probe networkProbeFunc) http.HandlerFunc {
	slots := make(chan struct{}, 1)
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "Network discovery is already running; retry shortly", http.StatusServiceUnavailable)
			return
		}

		var request NetworkDiscoveryRequest
		if !decodeJSONRequest(w, r, maxNetworkDiscoveryBodyBytes, &request) {
			return
		}
		plan, err := buildNetworkDiscoveryPlan(request)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), networkDiscoveryDeadline)
		defer cancel()
		response := executeNetworkDiscovery(ctx, plan, probe)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(response)
	}
}

type networkProbePlan struct {
	address netip.Addr
	port    uint16
}

type networkProbeObservation struct {
	plan              networkProbePlan
	result            ScanResult
	done              bool
	evidenceTruncated bool
}

func executeNetworkDiscovery(ctx context.Context, plan networkDiscoveryPlan, probe networkProbeFunc) NetworkDiscoveryResponse {
	probes := make([]networkProbePlan, 0, plan.Attempts)
	for _, address := range plan.Addresses {
		for _, port := range plan.Profile.Ports {
			probes = append(probes, networkProbePlan{address: address, port: port})
		}
	}
	observations := make([]networkProbeObservation, len(probes))
	jobs := make(chan int)
	workers := min(maxNetworkDiscoveryWorkers, len(probes))
	var completed atomic.Int32
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for index := range jobs {
				item := probes[index]
				result, evidenceTruncated := boundNetworkDiscoveryScanResult(
					probe(ctx, item.address, item.port),
				)
				observations[index] = networkProbeObservation{
					plan:              item,
					result:            result,
					done:              true,
					evidenceTruncated: evidenceTruncated,
				}
				completed.Add(1)
			}
		}()
	}
	dispatchComplete := true
dispatch:
	for index := range probes {
		select {
		case jobs <- index:
		case <-ctx.Done():
			dispatchComplete = false
			break dispatch
		}
	}
	close(jobs)
	group.Wait()

	hosts, evidenceTruncated := hostsFromNetworkObservations(plan.Addresses, observations)
	warnings := []string{
		"Only open selected TCP services are retained; an absent host is not evidence that the device is offline.",
		"attemptsCompleted counts selected endpoint probe calls that returned; a cancellation return does not prove that a connection reached the target.",
		"Device roles are inferred from observed ports and protocols, not operating-system or hardware identification.",
		"No physical links, VLAN membership, or network ownership are inferred by this scan.",
		networkDiscoveryInspectionDisclosure(),
		networkDiscoveryEvidenceBudgetDisclosure,
	}
	if evidenceTruncated {
		warnings = append(warnings, "Verbose discovery evidence was truncated to per-port or aggregate safety limits; every observed open TCP port is retained.")
	}
	response := NetworkDiscoveryResponse{
		Perspective:       "protopeek-process",
		ObservedAt:        time.Now().UTC().Format(time.RFC3339Nano),
		CIDR:              plan.CIDR.String(),
		Profile:           plan.Profile,
		HostCount:         len(plan.Addresses),
		AttemptsPlanned:   plan.Attempts,
		AttemptsCompleted: int(completed.Load()),
		Complete:          dispatchComplete && int(completed.Load()) == plan.Attempts && ctx.Err() == nil,
		Hosts:             hosts,
		Warnings:          warnings,
	}
	if !response.Complete {
		response.StoppedReason = "request-cancelled"
		if ctx.Err() == context.DeadlineExceeded {
			response.StoppedReason = "deadline"
		}
	}
	return response
}

func probeNetworkService(ctx context.Context, address netip.Addr, port uint16) ScanResult {
	return probeNetworkServiceWith(ctx, address, port, probeNetworkTCPService, probeCandidate)
}

const networkDiscoveryEvidenceBudgetDisclosure = "Discovery has a 64 KiB aggregate verbose-evidence budget; if it is reached, every observed open TCP port remains in the result and only additional protocol detail is omitted."

func networkDiscoveryInspectionDisclosure() string {
	ports := make([]string, len(networkDiscoveryApplicationInspectionPorts))
	for index, port := range networkDiscoveryApplicationInspectionPorts {
		ports[index] = fmt.Sprintf("%d", port)
	}
	portList := ports[0]
	if len(ports) > 1 {
		portList = strings.Join(ports[:len(ports)-1], ", ") + ", and " + ports[len(ports)-1]
	}
	return "Application inspection is limited to TCP ports " + portList +
		"; those ports may receive bounded gRPC reflection and HTTP HEAD / probes (redirects are not followed). " +
		"All other selected ports receive TCP connect only."
}

func probeNetworkServiceWith(
	ctx context.Context,
	address netip.Addr,
	port uint16,
	tcpOnlyProbe networkCandidateProbeFunc,
	applicationProbe networkCandidateProbeFunc,
) ScanResult {
	transport := "plaintext"
	if port == 443 || port == 7443 || port == 8443 {
		transport = "tls"
	}
	dialAddress := netip.AddrPortFrom(address, port).String()
	candidate := scanCandidate{
		Address:     dialAddress,
		DialAddress: dialAddress,
		ServerName:  address.String(),
		Transport:   transport,
	}
	if networkDiscoveryInspectsApplicationPort(port) {
		return applicationProbe(ctx, candidate)
	}
	return tcpOnlyProbe(ctx, candidate)
}

func networkDiscoveryInspectsApplicationPort(port uint16) bool {
	for _, inspectionPort := range networkDiscoveryApplicationInspectionPorts {
		if port == inspectionPort {
			return true
		}
	}
	return false
}

func probeNetworkTCPService(ctx context.Context, candidate scanCandidate) ScanResult {
	start := time.Now()
	result := ScanResult{
		Address:    candidate.Address,
		Protocols:  make([]string, 0, 1),
		Reflection: "not-checked",
		Services:   make([]string, 0),
		Details:    make([]string, 0),
	}
	dialer := net.Dialer{Timeout: tcpProbeTimeout}
	connection, err := dialer.DialContext(ctx, "tcp", candidate.DialAddress)
	result.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		return result
	}
	_ = connection.Close()
	result.Alive = true
	result.TCP = true
	result.Protocols = append(result.Protocols, "tcp")
	return result
}

func boundNetworkDiscoveryScanResult(result ScanResult) (ScanResult, bool) {
	truncated := result.ServicesTruncated || result.DetailsTruncated ||
		result.HTTPProtocolTruncated || result.HTTPStatusTruncated || result.HTTPServerTruncated

	var fieldTruncated bool
	result.Protocols, fieldTruncated = boundNetworkDiscoveryIdentifiers(
		result.Protocols,
		maxNetworkDiscoveryProtocolsPerPort,
		maxNetworkDiscoveryProtocolBytes,
	)
	truncated = truncated || fieldTruncated
	result.Services, fieldTruncated = boundNetworkDiscoveryIdentifiers(
		result.Services,
		maxNetworkDiscoveryServicesPerPort,
		maxNetworkDiscoveryServiceBytes,
	)
	truncated = truncated || fieldTruncated
	result.Reflection, fieldTruncated = boundNetworkDiscoveryText(result.Reflection, maxNetworkDiscoveryReflectionBytes)
	truncated = truncated || fieldTruncated
	result.HTTPProtocol, fieldTruncated = boundNetworkDiscoveryText(result.HTTPProtocol, maxNetworkDiscoveryHTTPProtocolBytes)
	truncated = truncated || fieldTruncated
	result.HTTPStatus, fieldTruncated = boundNetworkDiscoveryText(result.HTTPStatus, maxNetworkDiscoveryHTTPStatusBytes)
	truncated = truncated || fieldTruncated
	result.HTTPServer, fieldTruncated = boundNetworkDiscoveryText(result.HTTPServer, maxNetworkDiscoveryHTTPServerBytes)
	truncated = truncated || fieldTruncated

	deadlineMilliseconds := networkDiscoveryDeadline.Milliseconds()
	if result.LatencyMs < 0 {
		result.LatencyMs = 0
		truncated = true
	} else if result.LatencyMs > deadlineMilliseconds {
		result.LatencyMs = deadlineMilliseconds
		truncated = true
	}

	notes, notesTruncated := boundNetworkDiscoveryNotes(result.Details)
	truncated = truncated || notesTruncated
	if truncated {
		notes, _ = boundNetworkDiscoveryNotes(append([]string{networkDiscoveryPerPortTruncationNote}, notes...))
	}
	result.Details = notes
	return result, truncated
}

func boundNetworkDiscoveryIdentifiers(values []string, maximumItems, maximumBytes int) ([]string, bool) {
	bounded := make([]string, 0, min(len(values), maximumItems))
	seen := make(map[string]struct{}, min(len(values), maximumItems))
	truncated := false
	for _, value := range values {
		cleaned := strings.ToValidUTF8(value, "\uFFFD")
		if cleaned != value || strings.ContainsRune(cleaned, '\x00') || cleaned == "" || len(cleaned) > maximumBytes {
			truncated = true
			continue
		}
		if _, exists := seen[cleaned]; exists {
			truncated = true
			continue
		}
		if len(bounded) == maximumItems {
			truncated = true
			continue
		}
		seen[cleaned] = struct{}{}
		bounded = append(bounded, cleaned)
	}
	return bounded, truncated
}

func boundNetworkDiscoveryText(value string, maximumBytes int) (string, bool) {
	cleaned := strings.ToValidUTF8(value, "\uFFFD")
	truncated := cleaned != value
	if strings.ContainsRune(cleaned, '\x00') {
		cleaned = strings.ReplaceAll(cleaned, "\x00", "\uFFFD")
		truncated = true
	}
	bounded, fieldTruncated := boundedScanString(cleaned, maximumBytes)
	return bounded, truncated || fieldTruncated
}

func boundNetworkDiscoveryNotes(values []string) ([]string, bool) {
	bounded := make([]string, 0, min(len(values), maxNetworkDiscoveryEvidenceNotesPerPort))
	seen := make(map[string]struct{}, min(len(values), maxNetworkDiscoveryEvidenceNotesPerPort))
	usedBytes := 0
	truncated := false
	for _, value := range values {
		cleaned, fieldTruncated := boundNetworkDiscoveryText(value, maxNetworkDiscoveryEvidenceNoteBytes)
		truncated = truncated || fieldTruncated
		if cleaned == "" {
			if value != "" {
				truncated = true
			}
			continue
		}
		if _, exists := seen[cleaned]; exists {
			truncated = true
			continue
		}
		if len(bounded) == maxNetworkDiscoveryEvidenceNotesPerPort || usedBytes+len(cleaned) > maxNetworkDiscoveryEvidenceNotesBytes {
			truncated = true
			continue
		}
		seen[cleaned] = struct{}{}
		bounded = append(bounded, cleaned)
		usedBytes += len(cleaned)
	}
	return bounded, truncated
}

type networkDiscoveryEvidenceBudget struct {
	remaining int
	truncated bool
}

func (budget *networkDiscoveryEvidenceBudget) takeString(value string) string {
	if value == "" {
		return ""
	}
	if len(value) > budget.remaining {
		budget.truncated = true
		return ""
	}
	budget.remaining -= len(value)
	return value
}

func (budget *networkDiscoveryEvidenceBudget) takeStrings(values []string) []string {
	bounded := make([]string, 0, len(values))
	for _, value := range values {
		if retained := budget.takeString(value); retained != "" {
			bounded = append(bounded, retained)
		}
	}
	return bounded
}

func hostsFromNetworkObservations(addresses []netip.Addr, observations []networkProbeObservation) ([]NetworkDiscoveredHost, bool) {
	portsByAddress := make(map[netip.Addr][]NetworkPortEvidence)
	evidenceTruncated := false
	verboseEvidence := networkDiscoveryEvidenceBudget{remaining: maxNetworkDiscoveryVerboseEvidenceBytes}
	for _, observation := range observations {
		if !observation.done || !observation.result.Alive || !observation.result.TCP {
			continue
		}
		evidenceTruncated = evidenceTruncated || observation.evidenceTruncated
		result := observation.result
		portsByAddress[observation.plan.address] = append(
			portsByAddress[observation.plan.address],
			NetworkPortEvidence{
				Port:            observation.plan.port,
				State:           "open",
				Provenance:      "observed",
				Protocols:       verboseEvidence.takeStrings(result.Protocols),
				GRPC:            result.GRPC,
				HTTP:            result.HTTP,
				Reflection:      verboseEvidence.takeString(result.Reflection),
				Services:        verboseEvidence.takeStrings(result.Services),
				HTTPProtocol:    verboseEvidence.takeString(result.HTTPProtocol),
				HTTPStatus:      verboseEvidence.takeString(result.HTTPStatus),
				HTTPServer:      verboseEvidence.takeString(result.HTTPServer),
				ProbeDurationMs: result.LatencyMs,
				EvidenceNotes:   verboseEvidence.takeStrings(result.Details),
			},
		)
	}
	hosts := make([]NetworkDiscoveredHost, 0, len(portsByAddress))
	for _, address := range addresses {
		ports := portsByAddress[address]
		if len(ports) == 0 {
			continue
		}
		sort.Slice(ports, func(i, j int) bool { return ports[i].Port < ports[j].Port })
		hosts = append(hosts, NetworkDiscoveredHost{
			Address: address.String(),
			Ports:   ports,
			Hints:   inferNetworkHostHints(ports),
		})
	}
	return hosts, evidenceTruncated || verboseEvidence.truncated
}

func inferNetworkHostHints(ports []NetworkPortEvidence) []NetworkHostHint {
	type hintSpec struct {
		label  string
		reason string
	}
	specs := make([]hintSpec, 0, 4)
	seen := make(map[string]struct{})
	add := func(label, reason string) {
		if _, exists := seen[label]; exists {
			return
		}
		seen[label] = struct{}{}
		specs = append(specs, hintSpec{label: label, reason: reason})
	}
	for _, port := range ports {
		if port.GRPC {
			add("gRPC endpoint", fmt.Sprintf("gRPC responded on TCP %d", port.Port))
		}
		if port.HTTP {
			add("Web/API endpoint", fmt.Sprintf("HTTP responded on TCP %d", port.Port))
		}
	}
	for _, port := range ports {
		switch port.Port {
		case 631, 9100:
			add("Possible print service", fmt.Sprintf("TCP %d is open", port.Port))
		case 22:
			add("Possible managed host", "SSH port 22 is open")
		case 53:
			add("Possible DNS service", "DNS TCP port 53 is open")
		case 445:
			add("Possible file-sharing host", "SMB port 445 is open")
		case 3306, 5432, 6379:
			add("Possible data service", fmt.Sprintf("a common database port (%d) is open", port.Port))
		case 1883:
			add("Possible messaging device", "MQTT port 1883 is open")
		case 3389:
			add("Possible remote desktop host", "RDP port 3389 is open")
		}
	}
	if len(specs) == 0 {
		add("Unknown service host", "one or more selected TCP ports are open")
	}
	hints := make([]NetworkHostHint, len(specs))
	for index, spec := range specs {
		hints[index] = NetworkHostHint{
			Label:      spec.label,
			Confidence: "low",
			Provenance: "inferred",
			Reason:     spec.reason,
		}
	}
	return hints
}
