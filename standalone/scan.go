package standalone

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ScanResult describes what was found when probing a single address.
type ScanResult struct {
	Address   string   `json:"address"`
	Alive     bool     `json:"alive"`
	GRPC      bool     `json:"grpc"`
	Services  []string `json:"services,omitempty"`
	Error     string   `json:"error,omitempty"`
	LatencyMs int64    `json:"latencyMs"`
}

// ScanRequest is the JSON body for the /api/scan endpoint.
type ScanRequest struct {
	// Addresses to probe, e.g. ["localhost:50051", "10.0.0.5:9090"]
	Addresses []string `json:"addresses"`
	// Private-network probes are opt-in. Loopback probes are always allowed.
	AllowPrivateNetwork bool `json:"allowPrivateNetwork"`
}

func validateScanAddress(address string, allowPrivateNetwork bool) error {
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
		return fmt.Errorf("hostnames are not auto-scanned; enter a loopback or private IP")
	}
	if ip.IsLoopback() {
		return nil
	}
	if allowPrivateNetwork && ip.IsPrivate() {
		return nil
	}
	if ip.IsPrivate() {
		return fmt.Errorf("private-network scan requires explicit opt-in")
	}
	return fmt.Errorf("public addresses are not scanned")
}

// probeGRPC attempts a gRPC reflection handshake on the given address.
// It uses a short timeout to keep scanning fast.
func probeGRPC(ctx context.Context, address string) ScanResult {
	start := time.Now()
	result := ScanResult{Address: address}

	// Quick TCP check first (500ms)
	tcpCtx, tcpCancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer tcpCancel()
	var d net.Dialer
	conn, err := d.DialContext(tcpCtx, "tcp", address)
	if err != nil {
		result.Error = fmt.Sprintf("tcp: %s", err.Error())
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
	}
	conn.Close()
	result.Alive = true

	// Try gRPC reflection (2s timeout)
	grpcCtx, grpcCancel := context.WithTimeout(ctx, 2*time.Second)
	defer grpcCancel()
	cc, err := grpc.DialContext(grpcCtx, address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		result.Error = fmt.Sprintf("grpc dial: %s", err.Error())
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
	}
	defer cc.Close()
	result.GRPC = true

	// Try reflection to list services
	refClient := grpcreflect.NewClientAuto(grpcCtx, cc)
	defer refClient.Reset()
	svcs, err := refClient.ListServices()
	if err != nil {
		// gRPC is alive but reflection is off
		result.Error = "reflection unavailable"
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
	}

	// Filter out the reflection service itself
	for _, svc := range svcs {
		if !strings.HasPrefix(svc, "grpc.reflection.") {
			result.Services = append(result.Services, svc)
		}
	}
	result.LatencyMs = time.Since(start).Milliseconds()
	return result
}

// ScanHandler returns an HTTP handler for POST /api/scan.
// Accepts JSON with {"addresses": ["host:port", ...]} and returns scan results.
// Capped at 20 addresses per request to keep it lightweight.
func ScanHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var req ScanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		// Cap at 20 addresses
		if len(req.Addresses) > 20 {
			req.Addresses = req.Addresses[:20]
		}

		ctx := r.Context()
		results := make([]ScanResult, len(req.Addresses))

		// Probe sequentially to avoid slamming the network
		for i, addr := range req.Addresses {
			addr = strings.TrimSpace(addr)
			if err := validateScanAddress(addr, req.AllowPrivateNetwork); err != nil {
				results[i] = ScanResult{Address: addr, Error: err.Error()}
				continue
			}
			results[i] = probeGRPC(ctx, addr)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(results)
	}
}
