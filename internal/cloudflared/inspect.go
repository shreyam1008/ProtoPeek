package cloudflared

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const (
	maxConfigBytes = 256 << 10
	maxToolOutput  = 16 << 10
	maxRoutes      = 256
)

// Inspector performs no work until an explicit inspection, release check, or
// confirmed service action is requested.
type Inspector struct {
	releaseClient *http.Client
	now           func() time.Time
}

func NewInspector() *Inspector { return NewInspectorWithHTTPClient(http.DefaultClient) }

// NewInspectorWithHTTPClient supports an injection-safe release transport for
// tests. Timeout and redirect policy are always replaced with ProtoPeek's fixed
// safety policy while the supplied Transport is retained.
func NewInspectorWithHTTPClient(client *http.Client) *Inspector {
	return &Inspector{releaseClient: safeReleaseClient(client), now: time.Now}
}

// Inspect reads only documented config candidates and the canonical service definition.
// It never searches recursively, reads credential contents, or connects to a Docker daemon.
func (inspector *Inspector) Inspect(ctx context.Context) (Observation, error) {
	result := Observation{Configs: []ConfigCandidate{}, Notes: []string{}}
	if err := ctx.Err(); err != nil {
		return result, err
	}

	serviceCtx, cancelService := context.WithTimeout(ctx, 4*time.Second)
	service, serviceErr := observeCanonicalService(serviceCtx)
	cancelService()
	if serviceErr != nil {
		result.Notes = append(result.Notes, "Canonical service observation was incomplete: "+boundedText(serviceErr.Error(), 240))
	}
	result.Service = service
	result.Cloudflared = inspectTool(ctx, "cloudflared", service.ExecutablePath)
	if !result.Cloudflared.Found {
		result.Cloudflared.Note = "cloudflared was not found on PATH or in the canonical service definition."
	}
	result.Wrangler = inspectTool(ctx, "wrangler", "")
	result.Docker = inspectPathOnly("docker")
	if result.Docker.Found {
		result.Docker.Note = "CLI detected; ProtoPeek did not contact the Docker daemon."
	}

	candidates := configCandidatePaths(service)
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		result.Configs = append(result.Configs, inspectConfig(candidate.path, candidate.source))
	}
	markConfigAssociations(result.Configs, service)
	return result, nil
}

type configPathCandidate struct {
	path   string
	source string
}

func configCandidatePaths(service ServiceObservation) []configPathCandidate {
	values := make([]configPathCandidate, 0, 8)
	explicit := service.ConfigPath
	if strings.TrimSpace(explicit) != "" {
		values = append(values, configPathCandidate{path: explicit, source: "service-argument"})
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		source := "user-default"
		if runtime.GOOS == "darwin" && strings.HasPrefix(service.actionTarget, "gui/") {
			source = "launch-agent-default"
		}
		values = append(values,
			configPathCandidate{path: filepath.Join(home, ".cloudflared", "config.yml"), source: source},
			configPathCandidate{path: filepath.Join(home, ".cloudflared", "config.yaml"), source: source},
		)
	}
	values = append(values, platformServiceConfigCandidates(service)...)
	seen := map[string]struct{}{}
	result := make([]configPathCandidate, 0, len(values))
	for _, value := range values {
		cleaned := filepath.Clean(strings.TrimSpace(value.path))
		key := strings.ToLower(cleaned)
		if cleaned == "." || cleaned == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		value.path = cleaned
		result = append(result, value)
	}
	return result
}

func inspectTool(ctx context.Context, name, preferred string) ToolObservation {
	path := strings.TrimSpace(preferred)
	if path == "" {
		resolved, err := exec.LookPath(name)
		if err != nil {
			return ToolObservation{Note: name + " was not found on PATH."}
		}
		path = resolved
	} else if filepath.IsAbs(path) {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return ToolObservation{Path: filepath.Clean(path), Note: "The canonical service references an executable that is unavailable."}
		}
	} else {
		resolved, err := exec.LookPath(path)
		if err != nil {
			return ToolObservation{Path: filepath.Clean(path), Note: "The canonical service references an executable that is unavailable."}
		}
		path = resolved
	}
	path = filepath.Clean(path)
	result := ToolObservation{Found: true, Path: path}
	commandCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	output, err := runBounded(commandCtx, path, "--version")
	if err != nil {
		if errors.Is(commandCtx.Err(), context.DeadlineExceeded) {
			result.Note = "Version check timed out."
		} else {
			result.Note = "Version could not be read."
		}
		return result
	}
	result.Version = boundedText(firstLine(string(output)), 160)
	return result
}

func inspectPathOnly(name string) ToolObservation {
	path, err := exec.LookPath(name)
	if err != nil {
		return ToolObservation{Note: name + " was not found on PATH."}
	}
	return ToolObservation{Found: true, Path: filepath.Clean(path)}
}

func inspectConfig(path, source string) ConfigCandidate {
	result := ConfigCandidate{Path: path, Source: source, Routes: []IngressRoute{}, Warnings: []string{}}
	info, err := os.Lstat(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			result.Warnings = append(result.Warnings, "Metadata unavailable: "+boundedText(err.Error(), 160))
		}
		return result
	}
	result.Exists = true
	result.Symlink = info.Mode()&os.ModeSymlink != 0
	result.Regular = info.Mode().IsRegular()
	if result.Symlink {
		result.Warnings = append(result.Warnings, "Symlink not followed; adopt an exact regular-file path before mutation.")
		return result
	}
	if !result.Regular {
		result.Warnings = append(result.Warnings, "Candidate is not a regular file.")
		return result
	}
	if info.Size() > maxConfigBytes {
		result.Warnings = append(result.Warnings, "Config exceeds the 256 KiB inspection limit.")
		return result
	}
	file, err := os.Open(path)
	if err != nil {
		result.Warnings = append(result.Warnings, "Config is not readable: "+boundedText(err.Error(), 160))
		return result
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		result.Warnings = append(result.Warnings, "Config changed while it was being inspected; refresh to retry safely.")
		return result
	}
	contents, err := io.ReadAll(io.LimitReader(file, maxConfigBytes+1))
	if err != nil {
		result.Warnings = append(result.Warnings, "Config is not readable: "+boundedText(err.Error(), 160))
		return result
	}
	if len(contents) > maxConfigBytes {
		result.Warnings = append(result.Warnings, "Config exceeds the 256 KiB inspection limit.")
		return result
	}
	result.Readable = true
	hash := sha256.Sum256(contents)
	result.Revision = hex.EncodeToString(hash[:])
	parseConfig(contents, &result)
	return result
}

type rawConfig struct {
	Tunnel          yaml.Node  `yaml:"tunnel"`
	CredentialsFile string     `yaml:"credentials-file"`
	Ingress         []rawRoute `yaml:"ingress"`
}

type rawRoute struct {
	Hostname string `yaml:"hostname"`
	Path     string `yaml:"path"`
	Service  string `yaml:"service"`
}

func parseConfig(contents []byte, result *ConfigCandidate) {
	var document rawConfig
	if err := yaml.Unmarshal(contents, &document); err != nil {
		result.Warnings = append(result.Warnings, "YAML parse failed: "+boundedText(err.Error(), 200))
		return
	}
	result.Valid = true
	result.ManagementMode = "local"
	if document.Tunnel.Kind == yaml.ScalarNode {
		result.Tunnel = boundedText(document.Tunnel.Value, 160)
	}
	result.CredentialsPath = boundedText(document.CredentialsFile, 1024)
	if len(document.Ingress) > maxRoutes {
		document.Ingress = document.Ingress[:maxRoutes]
		result.Warnings = append(result.Warnings, "Ingress list was truncated at 256 rules.")
	}
	for index, raw := range document.Ingress {
		route := IngressRoute{
			Hostname: boundedText(raw.Hostname, 253),
			Path:     boundedText(raw.Path, 1024),
			Service:  redactService(raw.Service),
			Protocol: serviceProtocol(raw.Service),
			CatchAll: strings.TrimSpace(raw.Hostname) == "" && strings.TrimSpace(raw.Path) == "",
		}
		if route.Service == "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("Ingress rule %d has no service.", index+1))
		}
		result.Routes = append(result.Routes, route)
	}
	if len(result.Routes) > 0 && result.Routes[len(result.Routes)-1].CatchAll {
		result.CatchAllPresent = true
	} else if len(result.Routes) > 0 {
		result.Warnings = append(result.Warnings, "The final ingress rule is not a catch-all.")
	}
}

// markConfigAssociations separates a locally preferred config from stronger
// evidence that the canonical OS service actually uses that config.
func markConfigAssociations(configs []ConfigCandidate, service ServiceObservation) {
	if len(configs) == 0 {
		return
	}
	explicit := strings.TrimSpace(service.ConfigPath)
	if explicit != "" {
		cleaned := filepath.Clean(explicit)
		for index := range configs {
			if samePath(configs[index].Path, cleaned) {
				configs[index].Effective = true
				if service.Present && !serviceUsesRemoteToken(service) {
					configs[index].BoundToCanonicalService = true
					configs[index].ServiceBinding = "service-argument"
				}
				return
			}
		}
		return
	}
	if service.Present {
		if serviceUsesRemoteToken(service) {
			return
		}
		wantedSource := canonicalDefaultSource(service)
		if wantedSource == "" {
			return
		}
		for index := range configs {
			if configs[index].Source == wantedSource && configs[index].Exists {
				configs[index].Effective = true
				configs[index].BoundToCanonicalService = true
				configs[index].ServiceBinding = "canonical-service-default"
				return
			}
		}
		return
	}
	for index := range configs {
		if configs[index].Readable {
			configs[index].Effective = true
			return
		}
	}
}

func serviceUsesRemoteToken(service ServiceObservation) bool {
	return strings.Contains(strings.ToLower(service.CredentialSource), "token")
}

func canonicalDefaultSource(service ServiceObservation) string {
	if !service.argumentsObserved {
		return ""
	}
	switch service.Manager {
	case "Windows SCM":
		return "system-service-default"
	case "systemd":
		return "system-default"
	case "launchd":
		if strings.HasPrefix(service.actionTarget, "gui/") {
			return "launch-agent-default"
		}
		if strings.HasPrefix(service.actionTarget, "system/") {
			return "launch-daemon-default"
		}
	}
	return ""
}

func samePath(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

func serviceProtocol(raw string) string {
	value := strings.TrimSpace(raw)
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" {
		return strings.ToLower(boundedText(parsed.Scheme, 24))
	}
	if prefix, _, found := strings.Cut(value, ":"); found {
		return strings.ToLower(boundedText(prefix, 24))
	}
	return "unknown"
}

func redactService(raw string) string {
	value := boundedText(raw, 2048)
	parsed, err := url.Parse(value)
	if err == nil {
		if parsed.User != nil {
			parsed.User = url.User("redacted")
		}
		if parsed.RawQuery != "" {
			query := parsed.Query()
			for key := range query {
				query.Set(key, "redacted")
			}
			parsed.RawQuery = query.Encode()
		}
		if parsed.Fragment != "" {
			parsed.Fragment = "redacted"
		}
		value = parsed.String()
	} else {
		// Even malformed service strings must not reflect query/fragment data.
		if prefix, _, found := strings.Cut(value, "?"); found {
			value = prefix + "?redacted"
		} else if prefix, _, found := strings.Cut(value, "#"); found {
			value = prefix + "#redacted"
		}
	}
	return value
}

func runBounded(ctx context.Context, executable string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	var output boundedBuffer
	command.Stdout = &output
	command.Stderr = &output
	err := command.Run()
	return output.Bytes(), err
}

type boundedBuffer struct{ bytes.Buffer }

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	remaining := maxToolOutput - buffer.Len()
	if remaining <= 0 {
		return len(value), nil
	}
	if len(value) > remaining {
		_, _ = buffer.Buffer.Write(value[:remaining])
		return len(value), nil
	}
	return buffer.Buffer.Write(value)
}

var _ io.Writer = (*boundedBuffer)(nil)

func firstLine(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	line, _, _ := strings.Cut(value, "\n")
	return strings.TrimSpace(line)
}

func boundedText(value string, maximum int) string {
	value = strings.ToValidUTF8(value, "")
	value = strings.TrimSpace(value)
	value = strings.Map(func(character rune) rune {
		if character == '\n' || character == '\r' || character == '\t' || character >= 0x20 {
			return character
		}
		return -1
	}, value)
	if len(value) > maximum {
		value = value[:maximum]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}

func sortedUnique(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = boundedText(value, 240)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
