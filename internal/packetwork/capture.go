package packetwork

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Interface struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}
type CaptureRequest struct {
	Interface string `json:"interface"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Seconds   int    `json:"seconds"`
	Packets   int    `json:"packets"`
	Consent   bool   `json:"consent"`
}

func FindCaptureTool() (string, error) {
	if path, err := exec.LookPath("dumpcap"); err == nil {
		return path, nil
	}
	var candidates []string
	if runtime.GOOS == "windows" {
		for _, key := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
			root := os.Getenv(key)
			if filepath.IsAbs(root) {
				candidates = append(candidates, filepath.Join(root, "Wireshark", "dumpcap.exe"))
			}
		}
	}
	if runtime.GOOS == "darwin" {
		candidates = append(candidates, "/Applications/Wireshark.app/Contents/MacOS/dumpcap")
	}
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("live capture needs Wireshark's dumpcap and OS capture permission. Install Wireshark with its capture support, then refresh. Offline file inspection works without it")
}

type boundedOutput struct {
	data   bytes.Buffer
	limit  int
	cancel context.CancelFunc
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.data.Len() {
		b.cancel()
		return 0, errors.New("capture output exceeded its limit")
	}
	return b.data.Write(p)
}

func runCaptureTool(ctx context.Context, path string, args []string, limit int) ([]byte, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	hideCapture(cmd)
	cmd.WaitDelay = time.Second
	out := boundedOutput{limit: limit, cancel: cancel}
	stderr := boundedOutput{limit: 16 << 10, cancel: cancel}
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, fmt.Errorf("capture tool failed: %w. %s", err, cleanLabel(stderr.data.Bytes(), 2048))
	}
	return out.data.Bytes(), nil
}

func CaptureInterfaces(ctx context.Context, path string) ([]Interface, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := runCaptureTool(ctx, path, []string{"-D"}, 64<<10)
	if err != nil {
		return nil, err
	}
	return parseInterfaces(string(raw))
}

func parseInterfaces(raw string) ([]Interface, error) {
	result := []Interface{}
	seen := map[string]bool{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		number, rest, ok := strings.Cut(line, ". ")
		if !ok {
			return nil, errors.New("unrecognized dumpcap interface listing")
		}
		if n, err := strconv.Atoi(number); err != nil || n < 1 {
			return nil, errors.New("invalid dumpcap interface index")
		}
		name, _, _ := strings.Cut(rest, " (")
		if !safeInterface(name) {
			continue
		}
		if seen[name] {
			return nil, errors.New("duplicate capture interface")
		}
		seen[name] = true
		result = append(result, Interface{Name: name, Label: cleanLabel([]byte(rest), 512)})
		if len(result) > 64 {
			return nil, errors.New("capture interface listing exceeds 64 entries")
		}
	}
	return result, nil
}

func safeInterface(name string) bool {
	if name == "" || len(name) > 320 || name == "-" || strings.HasPrefix(name, "-") || strings.ContainsAny(name, "\r\n\x00") {
		return false
	}
	lower := strings.ToLower(name)
	return !strings.Contains(lower, "://") && !strings.HasPrefix(lower, "tcp@") && !strings.Contains(lower, `\pipe\`) && !strings.HasPrefix(name, "/")
}

func PlanCapture(input CaptureRequest) ([]string, error) {
	if !input.Consent {
		return nil, errors.New("confirm permission to capture traffic on this interface")
	}
	if !safeInterface(input.Interface) {
		return nil, errors.New("select a local capture interface")
	}
	if input.Seconds < 1 || input.Seconds > 30 || input.Packets < 1 || input.Packets > 2000 {
		return nil, errors.New("capture is limited to 1–30 seconds and 1–2,000 packets")
	}
	if input.Port < 0 || input.Port > 65535 {
		return nil, errors.New("port must be 1–65535, or empty")
	}
	filter := []string{}
	if input.Host != "" {
		ip, err := netip.ParseAddr(input.Host)
		if err != nil || ip.Zone() != "" || ip.IsUnspecified() || ip.IsMulticast() {
			return nil, errors.New("capture host must be one unscoped unicast IP")
		}
		filter = append(filter, "host "+ip.Unmap().String())
	}
	if input.Port != 0 {
		filter = append(filter, "port "+strconv.Itoa(input.Port))
	}
	if len(filter) == 0 {
		return nil, errors.New("choose an IP or port to limit this capture")
	}
	return []string{"-i", input.Interface, "-p", "-B", "1", "-s", "512", "-c", strconv.Itoa(input.Packets), "-a", "duration:" + strconv.Itoa(input.Seconds), "-P", "-q", "-f", strings.Join(filter, " and "), "-w", "-"}, nil
}

func Capture(ctx context.Context, path string, input CaptureRequest) (Report, error) {
	args, err := PlanCapture(input)
	if err != nil {
		return Report{}, err
	}
	interfaces, err := CaptureInterfaces(ctx, path)
	if err != nil {
		return Report{}, err
	}
	found := false
	for _, iface := range interfaces {
		if iface.Name == input.Interface {
			found = true
			break
		}
	}
	if !found {
		return Report{}, errors.New("selected interface is no longer available; refresh interfaces")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(input.Seconds+3)*time.Second)
	defer cancel()
	raw, err := runCaptureTool(ctx, path, args, 2<<20)
	if err != nil {
		return Report{}, err
	}
	r, err := Analyze(ctx, raw)
	if err == nil {
		r.warning("Captured at most 512 bytes per packet. No stream reassembly or decryption; metadata only is retained.")
	}
	return r, err
}
