package cloudflared

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type logEvent struct {
	Time     string `json:"time,omitempty"`
	Level    string `json:"level"`
	Category string `json:"category"`
}

func (engine *operations) logSummary(ctx context.Context, request OperationRequest, observed Observation, config ConfigCandidate) (OperationResult, error) {
	result := OperationResult{Operation: request.Operation, Status: "unavailable", ObservedAt: engine.now().UTC()}
	path := observed.Service.LogFile
	if path == "" {
		path = config.LogFile
	}
	if !filepath.IsAbs(path) || noLinksInPath(path) != nil {
		result.Message = "No absolute regular logfile is explicitly configured. Journal and log-directory collection remain manual; no paths were searched."
		return result, nil
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || singleLink(path, info) != nil {
		result.Message = "The configured logfile is unavailable or linked. No other logfile was substituted."
		return result, nil
	}
	file, err := os.Open(path)
	if err != nil {
		result.Status, result.Message = "permission-required", "The configured logfile is not readable by this user."
		return result, nil
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil || !os.SameFile(info, actual) {
		result.Message = "Logfile identity changed while opening."
		return result, nil
	}
	start := max(int64(0), actual.Size()-(64<<10))
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return result, err
	}
	data, err := io.ReadAll(io.LimitReader(file, (64<<10)+1))
	if err != nil {
		return result, err
	}
	truncated := start > 0 || len(data) > 64<<10
	if len(data) > 64<<10 {
		data = data[:64<<10]
	}
	lines := strings.Split(string(data), "\n")
	if start > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	if len(lines) > 200 {
		lines = lines[len(lines)-200:]
		truncated = true
	}
	events := []logEvent{}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		event := logEvent{Level: "unknown", Category: "native-event"}
		var record struct {
			Time  string `json:"time"`
			Level string `json:"level"`
		}
		if json.Unmarshal([]byte(line), &record) == nil {
			if stamp, err := time.Parse(time.RFC3339Nano, record.Time); err == nil {
				event.Time = stamp.UTC().Format(time.RFC3339)
			}
			switch record.Level {
			case "debug", "info", "warn", "error", "fatal":
				event.Level = record.Level
			}
		}
		lower := strings.ToLower(line)
		for _, category := range []struct{ needle, label string }{{"certificate", "tls-certificate"}, {"connection refused", "connection-refused"}, {"timeout", "timeout"}, {"registered tunnel connection", "registered-connection"}, {"reconnect", "reconnecting"}, {"shutdown", "shutdown"}} {
			if strings.Contains(lower, category.needle) {
				event.Category = category.label
				break
			}
		}
		events = append(events, event)
	}
	if err := engine.unchanged(ctx, observed, config); err != nil {
		result.Status, result.Message = "stale", err.Error()
		return result, nil
	}
	result.Status, result.Message = "completed", "Recent configured-log summary: at most 64 KiB and 200 events, with keyword-based categories. Free-form messages, addresses and credential values stay on the host."
	result.Data = map[string]any{"events": events, "truncated": truncated}
	return result, nil
}

var tunnelUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var metricSample = regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^\r\n]*\})?\s+([^\s]+)(?:\s+[^\s]+)?\s*$`)

func (engine *operations) metrics(ctx context.Context, request OperationRequest, observed Observation, config ConfigCandidate) (OperationResult, error) {
	result := OperationResult{Operation: request.Operation, Status: "unavailable", ObservedAt: engine.now().UTC()}
	address := observed.Service.Metrics
	if address == "" {
		address = config.Metrics
	}
	host, port, err := net.SplitHostPort(address)
	ip := net.ParseIP(host)
	number, portErr := strconv.Atoi(port)
	if err != nil || portErr != nil || number < 1 || number > 65535 || ip == nil || !ip.IsLoopback() || !tunnelUUID.MatchString(config.Tunnel) {
		result.Message = "Metrics require an explicitly configured numeric loopback address and canonical tunnel UUID. Default ports, wildcard listeners and remote endpoints are not probed."
		return result, nil
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext, DisableKeepAlives: true, ResponseHeaderTimeout: 3 * time.Second, MaxResponseHeaderBytes: 16 << 10}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects are refused") }}
	get := func(path string, limit int64) ([]byte, error) {
		call, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(ip.String(), port)+path, nil)
		if err != nil {
			return nil, err
		}
		response, err := client.Do(call)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, errors.New("metrics endpoint did not return HTTP 200")
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
		if err != nil || int64(len(data)) > limit {
			return nil, errors.New("metrics response exceeded its safety limit")
		}
		return data, nil
	}
	identity, err := get("/diag/tunnel", 32<<10)
	if err != nil {
		result.Message = "The configured loopback diagnostic endpoint did not provide bounded tunnel identity evidence."
		return result, nil
	}
	var tunnel struct {
		ID string `json:"tunnelID"`
	}
	if json.Unmarshal(identity, &tunnel) != nil || !strings.EqualFold(tunnel.ID, config.Tunnel) {
		result.Message = "The configured endpoint did not identify the canonical tunnel. No metrics were collected."
		return result, nil
	}
	data, err := get("/metrics", 256<<10)
	if err != nil {
		result.Message = "The configured metrics endpoint failed or exceeded its safety limit."
		return result, nil
	}
	allowed := map[string]bool{"cloudflared_tunnel_ha_connections": true, "cloudflared_tunnel_total_requests": true, "cloudflared_tunnel_request_errors": true, "cloudflared_tunnel_response_by_code": true, "cloudflared_tunnel_timer_retries": true, "cloudflared_tunnel_active_streams": true, "cloudflared_tunnel_concurrent_requests_per_tunnel": true}
	sums := map[string]float64{}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	scanner.Buffer(make([]byte, 1024), 64<<10)
	for scanner.Scan() {
		match := metricSample.FindStringSubmatch(scanner.Text())
		if len(match) != 3 || !allowed[match[1]] {
			continue
		}
		value, err := strconv.ParseFloat(match[2], 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		total := sums[match[1]] + value
		if !math.IsNaN(total) && !math.IsInf(total, 0) {
			sums[match[1]] = total
		}
	}
	if scanner.Err() != nil {
		result.Message = "A metrics line exceeded its safety limit. No partial result is presented."
		return result, nil
	}
	if err := engine.unchanged(ctx, observed, config); err != nil {
		result.Status, result.Message = "stale", err.Error()
		return result, nil
	}
	result.Status, result.Message = "completed", "The configured loopback endpoint identified this tunnel UUID. Known metric series are summed without labels; this does not prove process ownership or public reachability."
	result.Data = map[string]any{"samples": sums, "identity": "configured endpoint and matching tunnel UUID"}
	return result, nil
}
