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

	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

const (
	maxScanInputs        = 20
	maxScanCandidates    = 24
	maxScanServices      = 64
	maxScanResolvedIPs   = 8
	maxScanHTTPHeader    = 64 << 10
	scanRequestTimeout   = 4 * time.Second
	tcpProbeTimeout      = 500 * time.Millisecond
	protocolProbeTimeout = 1200 * time.Millisecond
)

var explicitHostCandidatePorts = []string{"50051", "443"}

// ScanResult describes what was found when probing a single bounded candidate.
type ScanResult struct {
	Address        string   `json:"address"`
	Alive          bool     `json:"alive"`
	TCP            bool     `json:"tcp"`
	GRPC           bool     `json:"grpc"`
	HTTP           bool     `json:"http"`
	Protocols      []string `json:"protocols"`
	Reflection     string   `json:"reflection"`
	Transport      string   `json:"transport,omitempty"`
	Services       []string `json:"services,omitempty"`
	HTTPTransport  string   `json:"httpTransport,omitempty"`
	HTTPProtocol   string   `json:"httpProtocol,omitempty"`
	HTTPStatus     string   `json:"httpStatus,omitempty"`
	HTTPStatusCode int      `json:"httpStatusCode,omitempty"`
	HTTPServer     string   `json:"httpServer,omitempty"`
	Failure        string   `json:"failure,omitempty"`
	Error          string   `json:"error,omitempty"`
	Details        []string `json:"details,omitempty"`
	LatencyMs      int64    `json:"latencyMs"`
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
	Detected   bool
	Transport  string
	Protocol   string
	Status     string
	StatusCode int
	Server     string
	Details    []string
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
	for _, input := range inputs {
		expanded, err := expandScanInput(input)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", strings.TrimSpace(input), err)
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
		result.Details = append(result.Details, "tcp: "+err.Error())
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
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
	result.Details = append(result.Details, grpcAttempt.Details...)
	result.Details = append(result.Details, httpAttempt.Details...)
	if grpcAttempt.GRPC {
		result.GRPC = true
		result.Reflection = grpcAttempt.Reflection
		result.Transport = grpcAttempt.Transport
		result.Services = grpcAttempt.Services
		result.Error = grpcAttempt.Error
		result.Protocols = append(result.Protocols, "grpc")
	} else {
		result.Failure = grpcAttempt.Failure
		result.Error = grpcAttempt.Error
		result.Transport = grpcAttempt.Transport
	}
	if httpAttempt.Detected {
		result.HTTP = true
		result.HTTPTransport = httpAttempt.Transport
		result.HTTPProtocol = httpAttempt.Protocol
		result.HTTPStatus = httpAttempt.Status
		result.HTTPStatusCode = httpAttempt.StatusCode
		result.HTTPServer = httpAttempt.Server
		result.Protocols = append(result.Protocols, "http")
		if !result.GRPC {
			result.Failure = ""
			result.Error = ""
		}
	}
	if !result.GRPC && !result.HTTP && result.Failure == "" {
		result.Failure = "non-grpc"
		result.Transport = "none"
		result.Error = "TCP port is open, but no supported application protocol responded"
	}
	result.LatencyMs = time.Since(start).Milliseconds()
	return result
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
		bestAttempt.Details = append(bestAttempt.Details, attempt.Details...)
		if scanFailurePriority(attempt.Failure) > scanFailurePriority(bestAttempt.Failure) {
			details := bestAttempt.Details
			bestAttempt = attempt
			bestAttempt.Details = details
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
	dialOptions := []grpc.DialOption{grpc.WithTransportCredentials(creds), grpc.WithBlock()}
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
		result.Details = append(result.Details, fmt.Sprintf("%s: %s", transport, err.Error()))
		return result
	}
	defer cc.Close()

	reflectionClient := grpcreflect.NewClientAuto(probeCtx, cc)
	defer reflectionClient.Reset()
	services, err := reflectionClient.ListServices()
	if err != nil {
		result.Failure, result.Error = classifyProbeFailure(probeCtx, err)
		if isVerifiedGRPCStatus(err) {
			result.GRPC = true
			result.Alive = true
			result.Failure = ""
			result.Reflection = "unavailable"
			result.Error = "gRPC responded; reflection is unavailable"
			result.Details = append(result.Details, "reflection: "+err.Error())
			return result
		}
		if isNonGRPCProbeError(err) {
			result.Failure = "non-grpc"
			result.Error = "no gRPC transport responded"
			result.Details = append(result.Details, fmt.Sprintf("%s: %s", transport, err.Error()))
			return result
		}
		result.Details = append(result.Details, "reflection: "+err.Error())
		return result
	}

	result.GRPC = true
	result.Alive = true
	result.Reflection = "available"
	for _, service := range services {
		if !strings.HasPrefix(service, "grpc.reflection.") {
			if len(result.Services) == maxScanServices {
				result.Details = append(result.Details, fmt.Sprintf("reflection: service list limited to %d entries", maxScanServices))
				break
			}
			result.Services = append(result.Services, service)
		}
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
		result.Details = append(result.Details, attempt.Details...)
		if attempt.Detected {
			attempt.Details = result.Details
			return attempt
		}
		if ctx.Err() != nil {
			break
		}
	}
	return result
}

func probeHTTPTransport(ctx context.Context, address, transport string) httpProbeResult {
	return probeHTTPResolvedTransport(ctx, scanCandidate{Address: address}, transport)
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
		result.Details = append(result.Details, fmt.Sprintf("http %s: %s", transport, err.Error()))
		return result
	}
	req.Header.Set("User-Agent", "ProtoPeek-Scan/1")
	resp, err := client.Do(req)
	if err != nil {
		result.Details = append(result.Details, fmt.Sprintf("http %s: %s", transport, err.Error()))
		return result
	}
	_ = resp.Body.Close()
	result.Detected = true
	result.Protocol = resp.Proto
	result.Status = resp.Status
	result.StatusCode = resp.StatusCode
	result.Server = boundedEvidence(resp.Header.Get("Server"), 256)
	result.Details = append(result.Details, fmt.Sprintf("http %s: %s %s", transport, resp.Proto, resp.Status))
	return result
}

func boundedEvidence(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
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
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
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
					results[index] = ScanResult{
						Address:    candidate.Address,
						Transport:  candidate.Transport,
						Reflection: "not-checked",
						Failure:    "blocked",
						Error:      err.Error(),
						Protocols:  make([]string, 0),
						Services:   make([]string, 0),
						Details:    make([]string, 0),
					}
					return
				}
				results[index] = probeCandidate(scanCtx, prepared)
			}(i, candidate)
		}
		probes.Wait()

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(results)
	}
}
