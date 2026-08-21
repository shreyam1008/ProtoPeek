package standalone

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

func TestBuildNetworkDiscoveryPlanIsPrivateBoundedAndDeterministic(t *testing.T) {
	t.Parallel()
	plan, err := buildNetworkDiscoveryPlan(NetworkDiscoveryRequest{
		CIDR:    "192.168.50.0/30",
		Profile: "quick",
		Consent: true,
	})
	if err != nil {
		t.Fatalf("build plan: %v", err)
	}
	wantAddresses := []netip.Addr{
		netip.MustParseAddr("192.168.50.1"),
		netip.MustParseAddr("192.168.50.2"),
	}
	if len(plan.Addresses) != len(wantAddresses) {
		t.Fatalf("addresses = %v, want %v", plan.Addresses, wantAddresses)
	}
	for index := range wantAddresses {
		if plan.Addresses[index] != wantAddresses[index] {
			t.Fatalf("address %d = %v, want %v", index, plan.Addresses[index], wantAddresses[index])
		}
	}
	wantPorts := []uint16{80, 443, 50051, 8080}
	if len(plan.Profile.Ports) != len(wantPorts) {
		t.Fatalf("ports = %v, want %v", plan.Profile.Ports, wantPorts)
	}
	for index := range wantPorts {
		if plan.Profile.Ports[index] != wantPorts[index] {
			t.Fatalf("port %d = %d, want %d", index, plan.Profile.Ports[index], wantPorts[index])
		}
	}
	if plan.Attempts != 8 {
		t.Fatalf("attempts = %d, want 8", plan.Attempts)
	}
}

func TestBuildNetworkDiscoveryPlanRejectsUnsafeOrHiddenExpansion(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		request NetworkDiscoveryRequest
		want    string
	}{
		{name: "consent", request: NetworkDiscoveryRequest{CIDR: "192.168.1.0/24", Profile: "quick"}, want: "consent"},
		{name: "public", request: NetworkDiscoveryRequest{CIDR: "8.8.8.0/24", Profile: "quick", Consent: true}, want: "private IPv4"},
		{name: "broad", request: NetworkDiscoveryRequest{CIDR: "10.0.0.0/23", Profile: "quick", Consent: true}, want: "/24"},
		{name: "ipv6", request: NetworkDiscoveryRequest{CIDR: "fd00::/120", Profile: "quick", Consent: true}, want: "IPv4"},
		{name: "unknown profile", request: NetworkDiscoveryRequest{CIDR: "192.168.1.0/24", Profile: "everything", Consent: true}, want: "profile"},
		{name: "host instead of prefix", request: NetworkDiscoveryRequest{CIDR: "192.168.1.9", Profile: "quick", Consent: true}, want: "CIDR"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := buildNetworkDiscoveryPlan(test.request)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestProbeNetworkServiceInspectsOnlyExplicitApplicationPorts(t *testing.T) {
	t.Parallel()
	wantInspectionPorts := []uint16{80, 443, 3000, 4000, 5000, 6565, 7000, 7443, 8000, 8080, 8443, 9090, 50051}
	if len(networkDiscoveryApplicationInspectionPorts) != len(wantInspectionPorts) {
		t.Fatalf("inspection ports = %v, want %v", networkDiscoveryApplicationInspectionPorts, wantInspectionPorts)
	}
	for index := range wantInspectionPorts {
		if networkDiscoveryApplicationInspectionPorts[index] != wantInspectionPorts[index] {
			t.Fatalf("inspection port %d = %d, want %d", index, networkDiscoveryApplicationInspectionPorts[index], wantInspectionPorts[index])
		}
	}

	applicationCalls := make(map[uint16]int)
	tcpOnlyCalls := make(map[uint16]int)
	applicationProbe := func(_ context.Context, candidate scanCandidate) ScanResult {
		port := netip.MustParseAddrPort(candidate.DialAddress).Port()
		applicationCalls[port]++
		return ScanResult{Alive: true, TCP: true}
	}
	tcpOnlyProbe := func(_ context.Context, candidate scanCandidate) ScanResult {
		port := netip.MustParseAddrPort(candidate.DialAddress).Port()
		tcpOnlyCalls[port]++
		return ScanResult{Alive: true, TCP: true}
	}
	address := netip.MustParseAddr("192.168.1.9")
	for _, profile := range networkDiscoveryProfiles() {
		for _, port := range profile.Ports {
			probeNetworkServiceWith(context.Background(), address, port, tcpOnlyProbe, applicationProbe)
		}
	}

	for _, port := range wantInspectionPorts {
		if applicationCalls[port] == 0 || tcpOnlyCalls[port] != 0 {
			t.Fatalf("application port %d calls: application=%d tcp-only=%d", port, applicationCalls[port], tcpOnlyCalls[port])
		}
	}
	for _, port := range []uint16{22, 53, 445, 631, 1883, 3306, 3389, 5432, 6379, 9100} {
		if tcpOnlyCalls[port] == 0 || applicationCalls[port] != 0 {
			t.Fatalf("raw port %d calls: application=%d tcp-only=%d", port, applicationCalls[port], tcpOnlyCalls[port])
		}
	}
}

func TestNetworkDiscoveryHandlerGroupsOnlyObservedOpenPortsAndLabelsHints(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	probe := func(_ context.Context, address netip.Addr, port uint16) ScanResult {
		calls.Add(1)
		result := ScanResult{
			Address:    netip.AddrPortFrom(address, port).String(),
			Reflection: "not-checked",
			Protocols:  []string{},
			Services:   []string{},
			Details:    []string{},
		}
		if address.String() == "192.168.1.1" && port == 80 {
			result.Alive = true
			result.TCP = true
			result.HTTP = true
			result.LatencyMs = 7
			result.Protocols = []string{"tcp", "http"}
			result.HTTPProtocol = "HTTP/1.1"
			result.HTTPStatus = "200 OK"
		}
		if address.String() == "192.168.1.2" && port == 50051 {
			result.Alive = true
			result.TCP = true
			result.GRPC = true
			result.Protocols = []string{"tcp", "grpc"}
			result.Reflection = "available"
			result.Services = []string{"catalog.v1.Catalog"}
		}
		return result
	}
	handler := networkDiscoveryHandler(probe)
	response := performNetworkDiscovery(t, handler, `{"cidr":"192.168.1.0/30","profile":"quick","consent":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if calls.Load() != 8 || payload.AttemptsPlanned != 8 || payload.AttemptsCompleted != 8 {
		t.Fatalf("attempts calls=%d planned=%d completed=%d", calls.Load(), payload.AttemptsPlanned, payload.AttemptsCompleted)
	}
	if len(payload.Hosts) != 2 {
		t.Fatalf("hosts = %#v", payload.Hosts)
	}
	if payload.Hosts[0].Address != "192.168.1.1" || payload.Hosts[0].Ports[0].Port != 80 {
		t.Fatalf("first host = %#v", payload.Hosts[0])
	}
	if payload.Hosts[0].Ports[0].ProbeDurationMs != 7 {
		t.Fatalf("probe duration = %d, want 7", payload.Hosts[0].Ports[0].ProbeDurationMs)
	}
	if strings.Contains(response.Body.String(), `"latencyMs"`) || !strings.Contains(response.Body.String(), `"probeDurationMs":7`) {
		t.Fatalf("discovery timing contract = %s", response.Body.String())
	}
	if payload.Hosts[0].Hints[0].Label != "Web/API endpoint" || payload.Hosts[0].Hints[0].Provenance != "inferred" {
		t.Fatalf("web hints = %#v", payload.Hosts[0].Hints)
	}
	if payload.Hosts[1].Hints[0].Label != "gRPC endpoint" || payload.Hosts[1].Ports[0].Reflection != "available" {
		t.Fatalf("grpc host = %#v", payload.Hosts[1])
	}
	if payload.Perspective != "protopeek-process" || payload.ObservedAt == "" {
		t.Fatalf("observation boundary = %#v", payload)
	}
	assertNetworkDiscoveryInspectionDisclosure(t, payload.Warnings)
}

func TestNetworkDiscoveryBoundsPerPortEvidenceAtWorkerBoundary(t *testing.T) {
	t.Parallel()
	probe := func(_ context.Context, _ netip.Addr, port uint16) ScanResult {
		if port != 80 {
			return ScanResult{}
		}
		protocols := []string{"tcp", "tcp", strings.Repeat("p", 257), "bad\x00protocol"}
		services := []string{"example.Service", "example.Service", strings.Repeat("s", 513), "bad\x00service"}
		details := []string{"initial detail", "initial detail", strings.Repeat("d", 2_049), "bad\x00detail"}
		for index := 0; index < 20; index++ {
			protocols = append(protocols, fmt.Sprintf("protocol-%02d", index))
			services = append(services, fmt.Sprintf("service-%02d", index))
		}
		for index := 0; index < 36; index++ {
			details = append(details, fmt.Sprintf("detail-%02d", index))
		}
		return ScanResult{
			Alive:        true,
			TCP:          true,
			GRPC:         true,
			HTTP:         true,
			Protocols:    protocols,
			Reflection:   strings.Repeat("r", 257),
			Services:     services,
			HTTPProtocol: strings.Repeat("p", 257),
			HTTPStatus:   strings.Repeat("s", 257),
			HTTPServer:   strings.Repeat("h", 513),
			Details:      details,
			LatencyMs:    99_000,
		}
	}
	response := performNetworkDiscovery(t, networkDiscoveryHandler(probe), `{"cidr":"192.168.1.9/32","profile":"quick","consent":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Hosts) != 1 || len(payload.Hosts[0].Ports) != 1 {
		t.Fatalf("hosts = %#v", payload.Hosts)
	}
	port := payload.Hosts[0].Ports[0]
	if len(port.Protocols) > 16 || len(port.Services) > 16 || len(port.EvidenceNotes) > 32 {
		t.Fatalf("per-port list bounds: protocols=%d services=%d notes=%d", len(port.Protocols), len(port.Services), len(port.EvidenceNotes))
	}
	assertBoundedUniqueStrings(t, "protocols", port.Protocols, 256)
	assertBoundedUniqueStrings(t, "services", port.Services, 512)
	assertBoundedUniqueStrings(t, "evidence notes", port.EvidenceNotes, 2<<10)
	for label, value := range map[string]string{
		"reflection":    port.Reflection,
		"HTTP protocol": port.HTTPProtocol,
		"HTTP status":   port.HTTPStatus,
		"HTTP server":   port.HTTPServer,
	} {
		limit := 256
		if label == "HTTP server" {
			limit = 512
		}
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || len(value) > limit {
			t.Fatalf("%s = %q (%d bytes), want valid bounded evidence", label, value, len(value))
		}
	}
	if port.ProbeDurationMs != 15_000 {
		t.Fatalf("probe duration = %d, want deadline cap", port.ProbeDurationMs)
	}
	if !strings.Contains(strings.Join(port.EvidenceNotes, "\n"), "truncated") {
		t.Fatalf("evidence notes do not disclose per-port truncation: %v", port.EvidenceNotes)
	}
	if !strings.Contains(strings.Join(payload.Warnings, "\n"), "truncated") {
		t.Fatalf("warnings do not disclose truncation: %v", payload.Warnings)
	}
}

func TestNetworkDiscoveryCapsAggregateVerboseEvidenceWithoutDroppingOpenPorts(t *testing.T) {
	t.Parallel()
	probe := func(_ context.Context, _ netip.Addr, _ uint16) ScanResult {
		return ScanResult{
			Alive:        true,
			TCP:          true,
			GRPC:         true,
			HTTP:         true,
			Protocols:    []string{"tcp", "grpc", "http"},
			Reflection:   strings.Repeat("r", 256),
			Services:     []string{strings.Repeat("s", 512)},
			HTTPProtocol: strings.Repeat("p", 256),
			HTTPStatus:   strings.Repeat("t", 256),
			HTTPServer:   strings.Repeat("h", 512),
			Details:      []string{strings.Repeat("d", 2<<10)},
			LatencyMs:    4,
		}
	}
	response := performNetworkDiscovery(t, networkDiscoveryHandler(probe), `{"cidr":"192.168.77.0/24","profile":"quick","consent":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	portCount := 0
	verboseBytes := 0
	for _, host := range payload.Hosts {
		portCount += len(host.Ports)
		for _, port := range host.Ports {
			for _, value := range port.Protocols {
				verboseBytes += len(value)
			}
			for _, value := range port.Services {
				verboseBytes += len(value)
			}
			verboseBytes += len(port.Reflection) + len(port.HTTPProtocol) + len(port.HTTPStatus) + len(port.HTTPServer)
			for _, value := range port.EvidenceNotes {
				verboseBytes += len(value)
			}
		}
	}
	if portCount != 254*4 {
		t.Fatalf("open ports retained = %d, want %d", portCount, 254*4)
	}
	if verboseBytes > maxNetworkDiscoveryVerboseEvidenceBytes {
		t.Fatalf("verbose evidence = %d bytes, limit %d", verboseBytes, maxNetworkDiscoveryVerboseEvidenceBytes)
	}
	warnings := strings.Join(payload.Warnings, "\n")
	if !strings.Contains(warnings, "aggregate") || !strings.Contains(warnings, "every observed open TCP port is retained") {
		t.Fatalf("warnings do not disclose aggregate truncation: %v", payload.Warnings)
	}
}

func assertBoundedUniqueStrings(t *testing.T, label string, values []string, maximumBytes int) {
	t.Helper()
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || len(value) > maximumBytes {
			t.Fatalf("%s contains invalid value %q (%d bytes)", label, value, len(value))
		}
		if _, exists := seen[value]; exists {
			t.Fatalf("%s contains duplicate %q", label, value)
		}
		seen[value] = struct{}{}
	}
}

func TestNetworkDiscoveryHandlerMethodBodyAndCapacityBoundaries(t *testing.T) {
	t.Parallel()
	handler := networkDiscoveryHandler(func(_ context.Context, _ netip.Addr, _ uint16) ScanResult {
		return ScanResult{}
	})
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/network/discover", nil))
	if get.Code != http.StatusMethodNotAllowed || get.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("GET response = %d allow=%q", get.Code, get.Header().Get("Allow"))
	}
	bad := performNetworkDiscovery(t, handler, `{}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("bad request status = %d, body = %s", bad.Code, bad.Body.String())
	}
	large := performNetworkDiscovery(t, handler, `{"cidr":"`+strings.Repeat("x", maxNetworkDiscoveryBodyBytes)+`"}`)
	if large.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large request status = %d", large.Code)
	}
}

func TestNetworkDiscoveryProfilesExposeExactAttemptPlans(t *testing.T) {
	t.Parallel()
	profiles := networkDiscoveryProfiles()
	if len(profiles) != 4 {
		t.Fatalf("profiles = %#v", profiles)
	}
	if profiles[0].ID != "quick" || profiles[0].Label != "Quick services" {
		t.Fatalf("first profile = %#v", profiles[0])
	}
	wantApplicationPorts := map[string][]uint16{
		"quick":    {80, 443, 50051, 8080},
		"grpc":     {443, 6565, 7000, 7443, 9090, 50051},
		"web":      {80, 443, 3000, 4000, 5000, 8000, 8080, 8443},
		"expanded": {80, 443, 3000, 8000, 8080, 8443, 9090, 50051},
	}
	for _, profile := range profiles {
		if len(profile.Ports) == 0 || len(profile.Ports) > maxNetworkDiscoveryPorts {
			t.Fatalf("profile %q ports = %v", profile.ID, profile.Ports)
		}
		want := wantApplicationPorts[profile.ID]
		if len(profile.ApplicationProbePorts) != len(want) {
			t.Fatalf("profile %q application probe ports = %v, want %v", profile.ID, profile.ApplicationProbePorts, want)
		}
		portIndexes := make(map[uint16]int, len(profile.Ports))
		for index, port := range profile.Ports {
			portIndexes[port] = index
		}
		previousIndex := -1
		for index, port := range profile.ApplicationProbePorts {
			if port != want[index] {
				t.Fatalf("profile %q application probe port %d = %d, want %d", profile.ID, index, port, want[index])
			}
			profileIndex, exists := portIndexes[port]
			if !exists || profileIndex <= previousIndex {
				t.Fatalf("profile %q application probe ports are not an ordered subset: ports=%v application=%v", profile.ID, profile.Ports, profile.ApplicationProbePorts)
			}
			previousIndex = profileIndex
		}
	}
}

func TestNetworkDiscoveryCapabilitiesExposeSafeInterfaceSuggestionsWithoutProbing(t *testing.T) {
	t.Parallel()
	listCalls := 0
	handler := networkDiscoveryCapabilitiesHandler(func() ([]NetworkInterfaceSuggestion, error) {
		listCalls++
		return []NetworkInterfaceSuggestion{{
			Index:         4,
			Name:          "en0",
			Address:       "192.168.44.19",
			InterfaceCIDR: "192.168.0.0/16",
			SuggestedCIDR: "192.168.44.0/24",
		}}, nil
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/network/capabilities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if listCalls != 1 || len(payload.Interfaces) != 1 ||
		payload.Interfaces[0].InterfaceCIDR != "192.168.0.0/16" ||
		payload.Interfaces[0].SuggestedCIDR != "192.168.44.0/24" {
		t.Fatalf("capabilities = %#v, list calls = %d", payload, listCalls)
	}
	if payload.Limits.MaxAttempts != maxNetworkDiscoveryAttempts || len(payload.Profiles) != 4 {
		t.Fatalf("limits/profiles = %#v / %#v", payload.Limits, payload.Profiles)
	}
	if payload.ActiveProbe || payload.Perspective != "protopeek-process" {
		t.Fatalf("no-probe boundary = %#v", payload)
	}
	assertNetworkDiscoveryInspectionDisclosure(t, payload.Warnings)

	post := httptest.NewRecorder()
	handler.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/api/network/capabilities", nil))
	if post.Code != http.StatusMethodNotAllowed || post.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("POST response = %d allow=%q", post.Code, post.Header().Get("Allow"))
	}
}

func TestNetworkDiscoveryCapabilitiesDeduplicateBoundAndRejectUnrepresentableInterfaces(t *testing.T) {
	t.Parallel()
	interfaces := make([]NetworkInterfaceSuggestion, 0, 36)
	for index := 33; index >= 1; index-- {
		interfaces = append(interfaces, NetworkInterfaceSuggestion{
			Index:         index,
			Name:          fmt.Sprintf("eth%d", index),
			Address:       fmt.Sprintf("10.0.%d.9", index),
			InterfaceCIDR: fmt.Sprintf("10.0.%d.0/24", index),
			SuggestedCIDR: "untrusted-input-is-recomputed",
		})
	}
	duplicateAddress := interfaces[len(interfaces)-1]
	duplicateAddress.InterfaceCIDR = "10.0.1.0/25"
	interfaces = append(
		interfaces,
		duplicateAddress,
		NetworkInterfaceSuggestion{
			Index:         100,
			Name:          "broad0",
			Address:       "192.168.44.19",
			InterfaceCIDR: "192.0.0.0/8",
			SuggestedCIDR: "192.168.44.0/24",
		},
	)

	handler := networkDiscoveryCapabilitiesHandler(func() ([]NetworkInterfaceSuggestion, error) {
		return interfaces, nil
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/network/capabilities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Interfaces) != 32 {
		t.Fatalf("interfaces = %d, want frontend contract cap 32: %#v", len(payload.Interfaces), payload.Interfaces)
	}
	for index, suggestion := range payload.Interfaces {
		wantIndex := index + 1
		if suggestion.Index != wantIndex || suggestion.SuggestedCIDR != fmt.Sprintf("10.0.%d.0/24", wantIndex) {
			t.Fatalf("interface %d = %#v, want sorted index %d with recomputed /24", index, suggestion, wantIndex)
		}
		if suggestion.Name == "broad0" {
			t.Fatalf("unrepresentable broad interface was emitted: %#v", suggestion)
		}
	}
	warnings := strings.ToLower(strings.Join(payload.Warnings, "\n"))
	for _, expected := range []string{"duplicate interface", "could not be represented", "capped at 32"} {
		if !strings.Contains(warnings, expected) {
			t.Fatalf("capability warnings %q do not contain %q", warnings, expected)
		}
	}
}

func assertNetworkDiscoveryInspectionDisclosure(t *testing.T, warnings []string) {
	t.Helper()
	disclosure := strings.Join(warnings, "\n")
	for _, expected := range []string{
		"80, 443, 3000, 4000, 5000, 6565, 7000, 7443, 8000, 8080, 8443, 9090, and 50051",
		"gRPC reflection",
		"HTTP HEAD /",
		"redirects are not followed",
		"All other selected ports receive TCP connect only",
		"64 KiB aggregate verbose-evidence budget",
		"every observed open TCP port remains in the result",
	} {
		if !strings.Contains(disclosure, expected) {
			t.Fatalf("inspection disclosure %q does not contain %q", disclosure, expected)
		}
	}
}

func TestSuggestedDiscoveryCIDRNeverExpandsBeyondSlash24(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		input string
		want  string
	}{
		{input: "10.24.8.19/16", want: "10.24.8.0/24"},
		{input: "192.168.1.140/25", want: "192.168.1.128/25"},
		{input: "172.16.4.9/32", want: "172.16.4.9/32"},
	} {
		prefix := netip.MustParsePrefix(test.input)
		if got := suggestedDiscoveryCIDR(prefix).String(); got != test.want {
			t.Fatalf("suggestedDiscoveryCIDR(%s) = %s, want %s", test.input, got, test.want)
		}
	}
}

func TestNetworkDiscoveryCancellationCountsProbeCallsThatReturned(t *testing.T) {
	t.Parallel()
	plan, err := buildNetworkDiscoveryPlan(NetworkDiscoveryRequest{
		CIDR:    "192.168.55.0/24",
		Profile: "quick",
		Consent: true,
	})
	if err != nil {
		t.Fatalf("build plan: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{}, 1)
	var calls atomic.Int32
	var returned atomic.Int32
	probe := func(ctx context.Context, _ netip.Addr, _ uint16) ScanResult {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		returned.Add(1)
		return ScanResult{}
	}
	resultChannel := make(chan NetworkDiscoveryResponse, 1)
	go func() {
		resultChannel <- executeNetworkDiscovery(ctx, plan, probe)
	}()

	select {
	case <-started:
		cancel()
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("probe did not start")
	}

	var result NetworkDiscoveryResponse
	select {
	case result = <-resultChannel:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled discovery did not return")
	}
	if result.Complete || result.StoppedReason != "request-cancelled" {
		t.Fatalf("cancellation state = complete %t, stopped %q", result.Complete, result.StoppedReason)
	}
	if result.AttemptsCompleted != int(returned.Load()) || result.AttemptsCompleted != int(calls.Load()) {
		t.Fatalf(
			"attempts completed = %d, calls = %d, returned = %d",
			result.AttemptsCompleted,
			calls.Load(),
			returned.Load(),
		)
	}
	if result.AttemptsCompleted == 0 || result.AttemptsCompleted >= result.AttemptsPlanned {
		t.Fatalf("cancelled attempts = %d of %d", result.AttemptsCompleted, result.AttemptsPlanned)
	}
	if warnings := strings.Join(result.Warnings, "\n"); !strings.Contains(warnings, "probe calls that returned") {
		t.Fatalf("warnings do not define attemptsCompleted semantics: %q", warnings)
	}
}

func performNetworkDiscovery(t *testing.T, handler http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/network/discover", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
