package standalone

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
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
	maxScanInputs     = 20
	maxScanCandidates = 24
)

var explicitHostCandidatePorts = []string{"50051", "443"}

// ScanResult describes what was found when probing a single bounded candidate.
type ScanResult struct {
	Address    string   `json:"address"`
	Alive      bool     `json:"alive"`
	GRPC       bool     `json:"grpc"`
	Reflection string   `json:"reflection"`
	Transport  string   `json:"transport,omitempty"`
	Services   []string `json:"services,omitempty"`
	Failure    string   `json:"failure,omitempty"`
	Error      string   `json:"error,omitempty"`
	Details    []string `json:"details,omitempty"`
	LatencyMs  int64    `json:"latencyMs"`
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
	Address   string
	Transport string
}

func validateScanAddress(address string, allowPrivateNetwork, explicit bool) error {
	host, port, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || host == "" || port == "" {
		return fmt.Errorf("expected host:port")
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return fmt.Errorf("invalid port")
	}

	host = strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		if explicit {
			return nil
		}
		return fmt.Errorf("hostnames are only probed when explicitly entered")
	}
	if ip.IsLoopback() {
		return nil
	}
	if ip.IsPrivate() {
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

// probeGRPC attempts a bounded gRPC reflection handshake on the given address.
func probeGRPC(ctx context.Context, candidate scanCandidate) ScanResult {
	start := time.Now()
	result := ScanResult{
		Address:    candidate.Address,
		Reflection: "not-checked",
		Transport:  candidate.Transport,
		Services:   make([]string, 0),
		Details:    make([]string, 0),
	}

	tcpCtx, tcpCancel := context.WithTimeout(ctx, 500*time.Millisecond)
	var dialer net.Dialer
	conn, err := dialer.DialContext(tcpCtx, "tcp", candidate.Address)
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

	transports := []string{candidate.Transport}
	if candidate.Transport == "auto" || candidate.Transport == "" {
		transports = []string{"plaintext", "tls"}
	}
	bestAttempt := ScanResult{}
	for _, transport := range transports {
		attempt := probeGRPCTransport(ctx, candidate.Address, transport)
		if attempt.GRPC {
			attempt.Alive = true
			attempt.LatencyMs = time.Since(start).Milliseconds()
			attempt.Details = append(result.Details, attempt.Details...)
			return attempt
		}
		result.Details = append(result.Details, attempt.Details...)
		if scanFailurePriority(attempt.Failure) > scanFailurePriority(bestAttempt.Failure) {
			bestAttempt = attempt
		}
	}

	result.Failure = bestAttempt.Failure
	result.Error = bestAttempt.Error
	result.Transport = bestAttempt.Transport
	if result.Failure == "" {
		result.Failure = "non-grpc"
		result.Transport = "none"
		result.Error = "port is open, but no verified gRPC transport responded"
	}
	result.LatencyMs = time.Since(start).Milliseconds()
	return result
}

func probeGRPCTransport(ctx context.Context, address, transport string) ScanResult {
	result := ScanResult{
		Address:    address,
		Transport:  transport,
		Reflection: "not-checked",
		Services:   make([]string, 0),
		Details:    make([]string, 0),
	}
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var creds credentials.TransportCredentials
	if transport == "tls" {
		host, _, _ := net.SplitHostPort(address)
		creds = credentials.NewTLS(&tls.Config{ServerName: strings.Trim(host, "[]"), MinVersion: tls.VersionTLS12})
	} else {
		creds = insecure.NewCredentials()
	}
	cc, err := grpc.DialContext(probeCtx, address, grpc.WithTransportCredentials(creds), grpc.WithBlock())
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
			result.Services = append(result.Services, service)
		}
	}
	return result
}

func classifyProbeFailure(ctx context.Context, err error) (string, string) {
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return "cancelled", "probe cancelled"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "timeout", "probe timed out before gRPC could be verified"
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

// ScanHandler returns the bounded POST /api/scan endpoint.
func ScanHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		results := make([]ScanResult, len(candidates))
		var probes sync.WaitGroup
		for i, candidate := range candidates {
			probes.Add(1)
			go func(index int, candidate scanCandidate) {
				defer probes.Done()
				if err := validateScanAddress(candidate.Address, req.AllowPrivateNetwork, req.Explicit); err != nil {
					results[index] = ScanResult{
						Address:    candidate.Address,
						Transport:  candidate.Transport,
						Reflection: "not-checked",
						Failure:    "blocked",
						Error:      err.Error(),
						Services:   make([]string, 0),
						Details:    make([]string, 0),
					}
					return
				}
				results[index] = probeGRPC(r.Context(), candidate)
			}(i, candidate)
		}
		probes.Wait()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(results)
	}
}
