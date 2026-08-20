package standalone

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

const (
	maxScanInputs                = 20
	maxScanCandidates            = 24
	maxScanServices              = 64
	maxScanAddressBytes          = 512
	maxScanServiceBytes          = 1 << 10
	maxScanServiceAggregateBytes = 32 << 10
	maxScanDetailsBytes          = 2 << 10
	maxScanErrorBytes            = 2 << 10
	maxScanHTTPProtocolBytes     = 64
	maxScanHTTPStatusBytes       = 512
	maxScanHTTPServerBytes       = 256
	maxScanGRPCResponseBytes     = 64 << 10
	maxScanGRPCHeaderBytes       = 64 << 10
	maxScanResolvedIPs           = 8
	maxScanHTTPHeader            = 64 << 10
	maxConcurrentScans           = 2
	scanRequestTimeout           = 4 * time.Second
	tcpProbeTimeout              = 500 * time.Millisecond
	protocolProbeTimeout         = 1200 * time.Millisecond
)

var explicitHostCandidatePorts = []string{"50051", "443"}

// ScanResult describes what was found when probing a single bounded candidate.
type ScanResult struct {
	Address               string   `json:"address"`
	Alive                 bool     `json:"alive"`
	TCP                   bool     `json:"tcp"`
	GRPC                  bool     `json:"grpc"`
	HTTP                  bool     `json:"http"`
	Protocols             []string `json:"protocols"`
	Reflection            string   `json:"reflection"`
	Transport             string   `json:"transport,omitempty"`
	Services              []string `json:"services,omitempty"`
	HTTPTransport         string   `json:"httpTransport,omitempty"`
	HTTPProtocol          string   `json:"httpProtocol,omitempty"`
	HTTPStatus            string   `json:"httpStatus,omitempty"`
	HTTPStatusCode        int      `json:"httpStatusCode,omitempty"`
	HTTPServer            string   `json:"httpServer,omitempty"`
	HTTPProtocolTruncated bool     `json:"httpProtocolTruncated"`
	HTTPStatusTruncated   bool     `json:"httpStatusTruncated"`
	HTTPServerTruncated   bool     `json:"httpServerTruncated"`
	Failure               string   `json:"failure,omitempty"`
	Error                 string   `json:"error,omitempty"`
	ErrorTruncated        bool     `json:"errorTruncated"`
	Details               []string `json:"details,omitempty"`
	DetailsTruncated      bool     `json:"detailsTruncated"`
	ServicesTruncated     bool     `json:"servicesTruncated"`
	LatencyMs             int64    `json:"latencyMs"`
}

// ScanRequest is the JSON body for the /api/scan endpoint.
type ScanRequest struct {
	// Addresses contains host:port values or one explicitly entered host/URL.
	Addresses []string `json:"addresses"`
	// Private-network probes are opt-in. Loopback probes are always allowed.
	AllowPrivateNetwork bool `json:"allowPrivateNetwork"`
	// Explicit distinguishes a user-entered target from the ambient loopback list.
	Explicit bool `json:"explicit"`
}

type scanCandidate struct {
	Address     string
	DialAddress string
	ServerName  string
	Transport   string
}

type httpProbeResult struct {
	Detected          bool
	Transport         string
	Protocol          string
	Status            string
	StatusCode        int
	Server            string
	ProtocolTruncated bool
	StatusTruncated   bool
	ServerTruncated   bool
	Details           []string
	DetailsTruncated  bool
}

type scanResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

func prepareScanCandidate(
	ctx context.Context,
	resolver scanResolver,
	candidate scanCandidate,
	allowPrivateNetwork bool,
	explicit bool,
) (scanCandidate, error) {
	host, port, err := net.SplitHostPort(strings.TrimSpace(candidate.Address))
	if err != nil || host == "" || port == "" {
		return candidate, fmt.Errorf("expected host:port")
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return candidate, fmt.Errorf("invalid port")
	}
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if address, err := netip.ParseAddr(host); err == nil {
		address = address.Unmap()
		if err := validateScanIP(address, allowPrivateNetwork, explicit); err != nil {
			return candidate, err
		}
		candidate.DialAddress = net.JoinHostPort(address.String(), port)
		return candidate, nil
	}
	if !validRouteHostname(host) {
		return candidate, fmt.Errorf("invalid hostname")
	}
	if !explicit && !strings.EqualFold(host, "localhost") {
		return candidate, fmt.Errorf("hostnames are only probed when explicitly entered")
	}
	resolved, err := resolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return candidate, fmt.Errorf("resolve scan hostname: %w", err)
	}
	if len(resolved) == 0 {
		return candidate, fmt.Errorf("resolve scan hostname: no addresses")
	}
	var selected netip.Addr
	for index, address := range resolved {
		if index == maxScanResolvedIPs {
			break
		}
		address = address.Unmap()
		if err := validateScanIP(address, allowPrivateNetwork, explicit); err != nil {
			return candidate, fmt.Errorf("resolved address %s: %w", address, err)
		}
		if !explicit && !address.IsLoopback() {
			return candidate, fmt.Errorf("localhost resolved outside loopback")
		}
		if !selected.IsValid() {
			selected = address
		}
	}
	if !selected.IsValid() {
		return candidate, fmt.Errorf("resolve scan hostname: no usable addresses")
	}
	candidate.DialAddress = net.JoinHostPort(selected.String(), port)
	candidate.ServerName = host
	return candidate, nil
}

func validateScanIP(address netip.Addr, allowPrivateNetwork, explicit bool) error {
	if !address.IsValid() || address.IsUnspecified() {
		return fmt.Errorf("unspecified addresses are not allowed")
	}
	if address.IsMulticast() {
		return fmt.Errorf("multicast addresses are not allowed")
	}
	if address.Is4() && address == netip.MustParseAddr("255.255.255.255") {
		return fmt.Errorf("broadcast addresses are not allowed")
	}
	if address.IsLoopback() {
		return nil
	}
	if address.IsPrivate() || address.IsLinkLocalUnicast() {
		if allowPrivateNetwork {
			return nil
		}
		return fmt.Errorf("private-network scan requires explicit opt-in")
	}
	if explicit {
		return nil
	}
	return fmt.Errorf("public addresses are only probed when explicitly entered")
}

func expandScanInput(input string) ([]scanCandidate, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil, fmt.Errorf("address is required")
	}
	if !utf8.ValidString(input) || len(input) > maxScanAddressBytes {
		return nil, fmt.Errorf("address must be valid UTF-8 and at most %d bytes", maxScanAddressBytes)
	}

	if strings.Contains(input, "://") {
		parsed, err := url.Parse(input)
		if err != nil || parsed.Hostname() == "" {
			return nil, fmt.Errorf("invalid URL")
		}
		if parsed.User != nil {
			return nil, fmt.Errorf("credentials are not allowed in scan URLs")
		}
		scheme := strings.ToLower(parsed.Scheme)
		if scheme != "http" && scheme != "https" {
			return nil, fmt.Errorf("scan URL scheme must be http or https")
		}
		if parsed.Path != "" && parsed.Path != "/" {
			return nil, fmt.Errorf("scan URL must not include a path")
		}
		if parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("scan URL must not include a query or fragment")
		}
		port := parsed.Port()
		if port == "" {
			if scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
		transport := "plaintext"
		if scheme == "https" {
			transport = "tls"
		}
		return []scanCandidate{{Address: net.JoinHostPort(parsed.Hostname(), port), Transport: transport}}, nil
	}

	if host, port, err := net.SplitHostPort(input); err == nil && host != "" && port != "" {
		return []scanCandidate{{Address: net.JoinHostPort(strings.Trim(host, "[]"), port), Transport: "auto"}}, nil
	}

	host := strings.Trim(input, "[]")
	if strings.Contains(host, ":") && net.ParseIP(host) == nil {
		return nil, fmt.Errorf("invalid host or missing IPv6 brackets")
	}
	if host == "" || strings.ContainsAny(host, "/?# \t\r\n") {
		return nil, fmt.Errorf("invalid host")
	}
	candidates := make([]scanCandidate, 0, len(explicitHostCandidatePorts))
	for _, port := range explicitHostCandidatePorts {
		transport := "plaintext"
		if port == "443" {
			transport = "tls"
		}
		candidates = append(candidates, scanCandidate{Address: net.JoinHostPort(host, port), Transport: transport})
	}
	return candidates, nil
}

func scanCandidates(req ScanRequest) ([]scanCandidate, error) {
	inputs := req.Addresses
	if len(inputs) > maxScanInputs {
		return nil, fmt.Errorf("scan accepts at most %d inputs", maxScanInputs)
	}
	if req.Explicit {
		nonEmpty := 0
		for _, input := range inputs {
			if strings.TrimSpace(input) != "" {
				nonEmpty++
			}
		}
		if nonEmpty != 1 {
			return nil, fmt.Errorf("an explicit scan requires one host or URL")
		}
	}
	result := make([]scanCandidate, 0, len(inputs))
	for index, input := range inputs {
		expanded, err := expandScanInput(input)
		if err != nil {
			return nil, fmt.Errorf("input %d: %w", index+1, err)
		}
		for _, candidate := range expanded {
			if !utf8.ValidString(candidate.Address) || len(candidate.Address) > maxScanAddressBytes {
				return nil, fmt.Errorf("input %d expands beyond the %d-byte address limit", index+1, maxScanAddressBytes)
			}
		}
		result = append(result, expanded...)
		if len(result) > maxScanCandidates {
			return nil, fmt.Errorf("scan expands to more than %d candidates", maxScanCandidates)
		}
	}
	return result, nil
}

// probeCandidate gathers bounded TCP, gRPC, and HTTP evidence for one address.
func probeCandidate(ctx context.Context, candidate scanCandidate) ScanResult {
	start := time.Now()
	result := ScanResult{
		Address:    candidate.Address,
		Reflection: "not-checked",
		Transport:  candidate.Transport,
		Protocols:  make([]string, 0, 3),
		Services:   make([]string, 0),
		Details:    make([]string, 0),
	}

	tcpCtx, tcpCancel := context.WithTimeout(ctx, tcpProbeTimeout)
	var dialer net.Dialer
	conn, err := dialer.DialContext(tcpCtx, "tcp", candidate.targetAddress())
	tcpCancel()
	if err != nil {
		result.Failure, result.Error = classifyProbeFailure(ctx, err)
		if result.Failure == "indeterminate" {
			result.Failure = "unreachable"
			result.Error = "not reachable"
		}
		appendScanDetail(&result, "tcp: "+err.Error())
		result.LatencyMs = time.Since(start).Milliseconds()
		return boundScanResult(result)
	}
	_ = conn.Close()
	result.Alive = true
	result.TCP = true
	result.Protocols = append(result.Protocols, "tcp")

	grpcResult := make(chan ScanResult, 1)
	httpResult := make(chan httpProbeResult, 1)
	go func() {
		grpcResult <- probeGRPCTransports(ctx, candidate)
	}()
	go func() {
		httpResult <- probeHTTP(ctx, candidate)
	}()

	grpcAttempt := <-grpcResult
	httpAttempt := <-httpResult
	mergeScanDetails(&result, grpcAttempt.Details, grpcAttempt.DetailsTruncated)
	mergeScanDetails(&result, httpAttempt.Details, httpAttempt.DetailsTruncated)
	if grpcAttempt.GRPC {
		result.GRPC = true
		result.Reflection = grpcAttempt.Reflection
		result.Transport = grpcAttempt.Transport
		result.Services = grpcAttempt.Services
		result.ServicesTruncated = grpcAttempt.ServicesTruncated
		result.Error = grpcAttempt.Error
		result.ErrorTruncated = grpcAttempt.ErrorTruncated
		result.Protocols = append(result.Protocols, "grpc")
	} else {
		result.Failure = grpcAttempt.Failure
		result.Error = grpcAttempt.Error
		result.ErrorTruncated = grpcAttempt.ErrorTruncated
		result.Transport = grpcAttempt.Transport
	}
	if httpAttempt.Detected {
		result.HTTP = true
		result.HTTPTransport = httpAttempt.Transport
		result.HTTPProtocol = httpAttempt.Protocol
		result.HTTPProtocolTruncated = httpAttempt.ProtocolTruncated
		result.HTTPStatus = httpAttempt.Status
		result.HTTPStatusTruncated = httpAttempt.StatusTruncated
		result.HTTPStatusCode = httpAttempt.StatusCode
		result.HTTPServer = httpAttempt.Server
		result.HTTPServerTruncated = httpAttempt.ServerTruncated
		result.Protocols = append(result.Protocols, "http")
		if !result.GRPC {
			result.Failure = ""
			result.Error = ""
			result.ErrorTruncated = false
		}
	}
	if !result.GRPC && !result.HTTP && result.Failure == "" {
		result.Failure = "non-grpc"
		result.Transport = "none"
		result.Error = "TCP port is open, but no supported application protocol responded"
	}
	result.LatencyMs = time.Since(start).Milliseconds()
	return boundScanResult(result)
}

func (candidate scanCandidate) targetAddress() string {
	if candidate.DialAddress != "" {
		return candidate.DialAddress
	}
	return candidate.Address
}

func (candidate scanCandidate) tlsServerName() string {
	if candidate.ServerName != "" {
		return candidate.ServerName
	}
	host, _, _ := net.SplitHostPort(candidate.Address)
	return strings.Trim(host, "[]")
}

func probeGRPCTransports(ctx context.Context, candidate scanCandidate) ScanResult {
	transports := []string{candidate.Transport}
	if candidate.Transport == "auto" || candidate.Transport == "" {
		transports = []string{"plaintext", "tls"}
	}
	bestAttempt := ScanResult{}
	for _, transport := range transports {
		attempt := probeGRPCResolvedTransport(ctx, candidate, transport)
		if attempt.GRPC {
			return attempt
		}
		mergeScanDetails(&bestAttempt, attempt.Details, attempt.DetailsTruncated)
		if scanFailurePriority(attempt.Failure) > scanFailurePriority(bestAttempt.Failure) {
			details := bestAttempt.Details
			detailsTruncated := bestAttempt.DetailsTruncated
			bestAttempt = attempt
			bestAttempt.Details = details
			bestAttempt.DetailsTruncated = detailsTruncated
		}
	}

	if bestAttempt.Failure == "" {
		bestAttempt.Failure = "non-grpc"
		bestAttempt.Transport = "none"
		bestAttempt.Error = "no verified gRPC transport responded"
	}
	return bestAttempt
}

func probeGRPCTransport(ctx context.Context, address, transport string) ScanResult {
	return probeGRPCResolvedTransport(ctx, scanCandidate{Address: address}, transport)
}

func probeGRPCResolvedTransport(ctx context.Context, candidate scanCandidate, transport string) ScanResult {
	result := ScanResult{
		Address:    candidate.Address,
		Transport:  transport,
		Reflection: "not-checked",
		Services:   make([]string, 0),
		Details:    make([]string, 0),
	}
	probeCtx, cancel := context.WithTimeout(ctx, protocolProbeTimeout)
	defer cancel()

	var creds credentials.TransportCredentials
	if transport == "tls" {
		creds = credentials.NewTLS(&tls.Config{ServerName: candidate.tlsServerName(), MinVersion: tls.VersionTLS12})
	} else {
		creds = insecure.NewCredentials()
	}
	dialOptions := []grpc.DialOption{
		grpc.WithTransportCredentials(creds),
		grpc.WithBlock(),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(maxScanGRPCResponseBytes)),
		grpc.WithMaxHeaderListSize(uint32(maxScanGRPCHeaderBytes)),
	}
	if candidate.ServerName != "" {
		dialOptions = append(dialOptions, grpc.WithAuthority(candidate.Address))
	}
	cc, err := grpc.DialContext(probeCtx, candidate.targetAddress(), dialOptions...)
	if err != nil {
		result.Failure, result.Error = classifyProbeFailure(probeCtx, err)
		if isNonGRPCProbeError(err) {
			result.Failure = "non-grpc"
			result.Error = "no gRPC transport responded"
		}
		appendScanDetail(&result, fmt.Sprintf("%s: %s", transport, err.Error()))
		return result
	}
	defer cc.Close()

	reflectionClient := grpcreflect.NewClientAuto(probeCtx, cc)
	defer reflectionClient.Reset()
	services, err := reflectionClient.ListServices()
	if err != nil {
		if isScanReflectionEvidenceLimit(err) {
			result.GRPC = true
			result.Alive = true
			result.Reflection = "available"
			result.ServicesTruncated = true
			result.Error = "gRPC reflection responded, but its evidence exceeded the scan limit"
			appendScanDetail(&result, "reflection: "+err.Error())
			return result
		}
		result.Failure, result.Error = classifyProbeFailure(probeCtx, err)
		if isVerifiedGRPCStatus(err) {
			result.GRPC = true
			result.Alive = true
			result.Failure = ""
			result.Reflection = "unavailable"
			result.Error = "gRPC responded; reflection is unavailable"
			appendScanDetail(&result, "reflection: "+err.Error())
			return result
		}
		if isNonGRPCProbeError(err) {
			result.Failure = "non-grpc"
			result.Error = "no gRPC transport responded"
			appendScanDetail(&result, fmt.Sprintf("%s: %s", transport, err.Error()))
			return result
		}
		appendScanDetail(&result, "reflection: "+err.Error())
		return result
	}

	result.GRPC = true
	result.Alive = true
	result.Reflection = "available"
	for _, service := range services {
		if !strings.HasPrefix(service, "grpc.reflection.") {
			appendScanService(&result, service)
		}
	}
	if result.ServicesTruncated {
		appendScanDetail(&result, fmt.Sprintf("reflection: service evidence limited to %d entries and %d bytes", maxScanServices, maxScanServiceAggregateBytes))
	}
	return result
}

// probeHTTP sends only a bounded HEAD request to the candidate root. Redirects
// are returned as evidence but are never followed.
func probeHTTP(ctx context.Context, candidate scanCandidate) httpProbeResult {
	transports := []string{candidate.Transport}
	if candidate.Transport == "auto" || candidate.Transport == "" {
		transports = []string{"plaintext", "tls"}
	}
	result := httpProbeResult{Details: make([]string, 0, len(transports))}
	for _, transport := range transports {
		attempt := probeHTTPResolvedTransport(ctx, candidate, transport)
		if mergeHTTPProbeAttempt(&result, attempt) {
			return result
		}
		if ctx.Err() != nil {
			break
		}
	}
	return result
}

func mergeHTTPProbeAttempt(result *httpProbeResult, attempt httpProbeResult) bool {
	mergeHTTPScanDetails(result, attempt.Details, attempt.DetailsTruncated)
	if !attempt.Detected {
		return false
	}
	attempt.Details = result.Details
	attempt.DetailsTruncated = result.DetailsTruncated
	*result = attempt
	return true
}

func probeHTTPResolvedTransport(ctx context.Context, candidate scanCandidate, transport string) httpProbeResult {
	result := httpProbeResult{Transport: transport, Details: make([]string, 0, 1)}
	probeCtx, cancel := context.WithTimeout(ctx, protocolProbeTimeout)
	defer cancel()

	scheme := "http"
	if transport == "tls" {
		scheme = "https"
	}
	dialer := &net.Dialer{Timeout: tcpProbeTimeout}
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return dialer.DialContext(ctx, network, candidate.targetAddress())
			},
			DisableKeepAlives:      true,
			ForceAttemptHTTP2:      true,
			TLSHandshakeTimeout:    protocolProbeTimeout,
			ResponseHeaderTimeout:  protocolProbeTimeout,
			MaxResponseHeaderBytes: maxScanHTTPHeader,
			TLSClientConfig: &tls.Config{
				ServerName: candidate.tlsServerName(),
				MinVersion: tls.VersionTLS12,
			},
		},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(probeCtx, http.MethodHead, scheme+"://"+candidate.Address+"/", nil)
	if err != nil {
		appendHTTPScanDetail(&result, fmt.Sprintf("http %s: %s", transport, err.Error()))
		return result
	}
	req.Header.Set("User-Agent", "ProtoPeek-Scan/1")
	resp, err := client.Do(req)
	if err != nil {
		appendHTTPScanDetail(&result, fmt.Sprintf("http %s: %s", transport, err.Error()))
		return result
	}
	_ = resp.Body.Close()
	result.Detected = true
	result.Protocol, result.ProtocolTruncated = boundedScanString(resp.Proto, maxScanHTTPProtocolBytes)
	result.Status, result.StatusTruncated = boundedScanString(resp.Status, maxScanHTTPStatusBytes)
	result.StatusCode = resp.StatusCode
	result.Server, result.ServerTruncated = boundedScanString(resp.Header.Get("Server"), maxScanHTTPServerBytes)
	appendHTTPScanDetail(&result, fmt.Sprintf("http %s: %s %s", transport, resp.Proto, resp.Status))
	return result
}

func boundedScanString(value string, limit int) (string, bool) {
	truncated := !utf8.ValidString(value)
	if truncated {
		value = strings.ToValidUTF8(value, "\uFFFD")
	}
	if len(value) <= limit {
		return value, truncated
	}
	cut := limit
	for cut > 0 && !utf8.ValidString(value[:cut]) {
		cut--
	}
	return value[:cut], true
}

func appendBoundedScanList(values *[]string, truncated *bool, aggregateLimit int, value string) {
	used := 0
	for _, existing := range *values {
		used += len(existing)
	}
	remaining := aggregateLimit - used
	if remaining < 0 {
		remaining = 0
	}
	bounded, wasTruncated := boundedScanString(value, remaining)
	if bounded != "" {
		*values = append(*values, bounded)
	}
	if wasTruncated || (value != "" && bounded == "") {
		*truncated = true
	}
}

func appendScanDetail(result *ScanResult, detail string) {
	appendBoundedScanList(&result.Details, &result.DetailsTruncated, maxScanDetailsBytes, detail)
}

func mergeScanDetails(result *ScanResult, details []string, truncated bool) {
	if truncated {
		result.DetailsTruncated = true
	}
	for _, detail := range details {
		appendScanDetail(result, detail)
	}
}

func appendHTTPScanDetail(result *httpProbeResult, detail string) {
	appendBoundedScanList(&result.Details, &result.DetailsTruncated, maxScanDetailsBytes, detail)
}

func mergeHTTPScanDetails(result *httpProbeResult, details []string, truncated bool) {
	if truncated {
		result.DetailsTruncated = true
	}
	for _, detail := range details {
		appendHTTPScanDetail(result, detail)
	}
}

func appendScanService(result *ScanResult, service string) {
	serviceBytes := 0
	for _, existing := range result.Services {
		serviceBytes += len(existing)
	}
	if !utf8.ValidString(service) || len(service) > maxScanServiceBytes || len(result.Services) >= maxScanServices || serviceBytes+len(service) > maxScanServiceAggregateBytes {
		result.ServicesTruncated = true
		return
	}
	result.Services = append(result.Services, service)

}

func boundScanResult(result ScanResult) ScanResult {
	var truncated bool
	result.Error, truncated = boundedScanString(result.Error, maxScanErrorBytes)
	result.ErrorTruncated = result.ErrorTruncated || truncated
	result.HTTPProtocol, truncated = boundedScanString(result.HTTPProtocol, maxScanHTTPProtocolBytes)
	result.HTTPProtocolTruncated = result.HTTPProtocolTruncated || truncated
	result.HTTPStatus, truncated = boundedScanString(result.HTTPStatus, maxScanHTTPStatusBytes)
	result.HTTPStatusTruncated = result.HTTPStatusTruncated || truncated
	result.HTTPServer, truncated = boundedScanString(result.HTTPServer, maxScanHTTPServerBytes)
	result.HTTPServerTruncated = result.HTTPServerTruncated || truncated

	details, detailsTruncated := result.Details, result.DetailsTruncated
	result.Details = make([]string, 0, len(details))
	result.DetailsTruncated = detailsTruncated
	for _, detail := range details {
		appendScanDetail(&result, detail)
	}

	services, servicesTruncated := result.Services, result.ServicesTruncated
	result.Services = make([]string, 0, len(services))
	result.ServicesTruncated = servicesTruncated
	for _, service := range services {
		appendScanService(&result, service)
	}
	return result
}

func classifyProbeFailure(ctx context.Context, err error) (string, string) {
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return "cancelled", "probe cancelled"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "timeout", "probe timed out before a protocol could be verified"
	}
	return "indeterminate", "port is open, but gRPC could not be verified"
}

func isVerifiedGRPCStatus(err error) bool {
	code := status.Code(err)
	return code == codes.Unimplemented || code == codes.PermissionDenied || code == codes.Unauthenticated
}

func isScanReflectionEvidenceLimit(err error) bool {
	message := strings.ToLower(status.Convert(err).Message())
	return status.Code(err) == codes.ResourceExhausted && strings.Contains(message, "received message larger than max")
}

func scanFailurePriority(failure string) int {
	switch failure {
	case "cancelled":
		return 4
	case "timeout":
		return 3
	case "indeterminate":
		return 2
	case "non-grpc":
		return 1
	default:
		return 0
	}
}

func isNonGRPCProbeError(err error) bool {
	message := strings.ToLower(err.Error())
	for _, marker := range []string{
		"unexpected http status code",
		"error reading server preface",
		"frame too large",
		"malformed http response",
		"http/1.x transport connection broken",
		"authentication handshake failed",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

// ScanHandler returns the bounded POST /api/scan endpoint. The caller must
// enforce ProtoPeek's local-access and CSRF policy.
func ScanHandler() http.HandlerFunc {
	slots := make(chan struct{}, maxConcurrentScans)
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
			http.Error(w, "Scan capacity is busy; retry shortly", http.StatusServiceUnavailable)
			return
		}

		var req ScanRequest
		if !decodeJSONRequest(w, r, 64<<10, &req) {
			return
		}

		candidates, err := scanCandidates(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		scanCtx, cancel := context.WithTimeout(r.Context(), scanRequestTimeout)
		defer cancel()
		results := make([]ScanResult, len(candidates))
		var probes sync.WaitGroup
		for i, candidate := range candidates {
			probes.Add(1)
			go func(index int, candidate scanCandidate) {
				defer probes.Done()
				prepared, err := prepareScanCandidate(scanCtx, net.DefaultResolver, candidate, req.AllowPrivateNetwork, req.Explicit)
				if err != nil {
					results[index] = boundScanResult(ScanResult{
						Address:    candidate.Address,
						Transport:  candidate.Transport,
						Reflection: "not-checked",
						Failure:    "blocked",
						Error:      err.Error(),
						Protocols:  make([]string, 0),
						Services:   make([]string, 0),
						Details:    make([]string, 0),
					})
					return
				}
				results[index] = boundScanResult(probeCandidate(scanCtx, prepared))
			}(i, candidate)
		}
		probes.Wait()

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(results)
	}
}
