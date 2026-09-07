package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/portscan"
)

type nmapScanRequest struct {
	Target         string `json:"target"`
	Ports          string `json:"ports"`
	DetectServices bool   `json:"detectServices"`
	Consent        bool   `json:"consent"`
}
type nmapScanPlan struct {
	Target         string   `json:"target"`
	Ports          []int    `json:"ports"`
	Hosts          int      `json:"hosts"`
	DetectServices bool     `json:"detectServices"`
	Arguments      []string `json:"arguments"`
}
type nmapScanResult struct {
	Plan       nmapScanPlan       `json:"plan"`
	ObservedAt string             `json:"observedAt"`
	Inventory  NmapImportResponse `json:"inventory"`
	Warning    string             `json:"warning,omitempty"`
}

func planNmapScan(input nmapScanRequest) (nmapScanPlan, error) {
	plan := nmapScanPlan{Hosts: 1, DetectServices: input.DetectServices}
	target := strings.TrimSpace(input.Target)
	address, err := netip.ParseAddr(target)
	if err == nil {
		address = address.Unmap()
		if address.Zone() != "" || address.IsUnspecified() || address.IsMulticast() || address.IsLinkLocalUnicast() {
			return plan, errors.New("choose an unscoped unicast IP address")
		}
		plan.Target = address.String()
	} else {
		prefix, prefixErr := netip.ParsePrefix(target)
		if prefixErr != nil || !prefix.Addr().Is4() || prefix.Bits() < 24 || !networkDiscoveryPrefixIsPrivate(prefix.Masked()) {
			return plan, errors.New("choose one literal IP or a private IPv4 /24-or-smaller subnet")
		}
		prefix = prefix.Masked()
		plan.Target = prefix.String()
		// Nmap -Pn scans every address in the explicit CIDR, including endpoints.
		plan.Hosts = 1 << (32 - prefix.Bits())
	}
	plan.Ports, err = portscan.ParsePorts(input.Ports)
	if err != nil {
		return plan, err
	}
	if plan.Hosts*len(plan.Ports) > 4096 {
		return plan, errors.New("limit the plan to 4,096 host-port pairs; choose a smaller subnet or fewer ports")
	}
	ports := make([]string, len(plan.Ports))
	for i, port := range plan.Ports {
		ports[i] = strconv.Itoa(port)
	}
	plan.Arguments = []string{"-sT", "-Pn", "-n", "--unprivileged", "--max-parallelism", "32", "--max-retries", "1", "--host-timeout", "15s", "--initial-rtt-timeout", "500ms", "--max-rtt-timeout", "1s", "-p", strings.Join(ports, ","), "-oX", "-"}
	if address.Is6() {
		plan.Arguments = append(plan.Arguments, "-6")
	}
	if plan.DetectServices {
		plan.Arguments = append(plan.Arguments, "-sV", "--version-light")
	}
	plan.Arguments = append(plan.Arguments, plan.Target)
	return plan, nil
}

func findNmap() (string, error) {
	if path, err := exec.LookPath("nmap"); err == nil {
		return path, nil
	}
	if runtime.GOOS == "windows" {
		for _, key := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
			root := os.Getenv(key)
			if !filepath.IsAbs(root) {
				continue
			}
			path := filepath.Join(root, "Nmap", "nmap.exe")
			if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
				return path, nil
			}
		}
	}
	return "", errors.New("nmap was not found. Install it from nmap.org, then refresh. The built-in port scanner works without Nmap")
}

type nmapOutput struct {
	buffer   bytes.Buffer
	limit    int
	cancel   context.CancelFunc
	exceeded bool
}

func (out *nmapOutput) Len() int       { return out.buffer.Len() }
func (out *nmapOutput) Bytes() []byte  { return out.buffer.Bytes() }
func (out *nmapOutput) String() string { return out.buffer.String() }

func (out *nmapOutput) Write(p []byte) (int, error) {
	if len(p) > out.limit-out.Len() {
		out.exceeded = true
		out.cancel()
		return 0, errors.New("nmap output limit exceeded")
	}
	return out.buffer.Write(p)
}

func executeNmap(parent context.Context, path string, plan nmapScanPlan) (nmapScanResult, error) {
	result := nmapScanResult{Plan: plan, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, plan.Arguments...)
	configureNmapProcess(command)
	command.WaitDelay = time.Second
	output := &nmapOutput{limit: maxNmapXMLBytes, cancel: cancel}
	stderr := &nmapOutput{limit: 16 << 10, cancel: cancel}
	command.Stdout = output
	command.Stderr = stderr
	runErr := command.Run()
	result.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if parent.Err() != nil {
		return result, parent.Err()
	}
	if output.exceeded || stderr.exceeded {
		return result, errors.New("nmap output exceeded its limit; the process was stopped")
	}
	// Parse complete host elements even when the time limit interrupted the XML.
	inventory, parseErr := parseNmapXML(context.Background(), bytes.NewReader(output.Bytes()))
	if parseErr != nil {
		if runErr == nil || !(errors.Is(parseErr, io.ErrUnexpectedEOF) || strings.Contains(parseErr.Error(), "unexpected EOF")) || len(inventory.Hosts) == 0 {
			if ctx.Err() != nil {
				return result, errors.New("nmap reached its 30-second limit before returning complete host evidence; choose a smaller plan")
			}
			if runErr != nil {
				detail := strings.TrimSpace(stderr.String())
				if detail == "" {
					detail = runErr.Error()
				}
				return result, fmt.Errorf("nmap failed: %s", detail)
			}
			return result, errors.New("nmap returned invalid XML")
		}
	}
	if runErr != nil || parseErr != nil {
		inventory.Complete = false
		inventory.Completion = "interrupted"
		result.Warning = "Nmap stopped before finishing. Only complete host records returned before the stop are shown."
	}
	result.Inventory = inventory
	return result, nil
}

func registerNmapScanner(mux *http.ServeMux) {
	limiter := newAdmissionLimiter(1)
	mux.HandleFunc("/api/nmap/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		path, err := findNmap()
		message := "Installed Nmap is available for explicit scans."
		if err != nil {
			message = err.Error()
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"available": err == nil, "path": path, "message": message, "maxHostPorts": 4096, "maxPorts": 1024, "deadlineMs": 30000})
	})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input nmapScanRequest
		if !decodeStrictTransferJSON(w, r, 16<<10, &input) {
			return
		}
		plan, err := planNmapScan(input)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if !input.Consent {
			http.Error(w, "Authorize the selected Nmap plan before starting.", 400)
			return
		}
		path, err := findNmap()
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		result, err := executeNmap(r.Context(), path, plan)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	})
	mux.HandleFunc("/api/nmap/scan", func(w http.ResponseWriter, r *http.Request) {
		if validateAdmittedPOST(w, r) {
			limiter.serveHTTP("Nmap scan", w, r, handler)
		}
	})
}
