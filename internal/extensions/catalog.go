// Package extensions locates optional companions without executing them.
package extensions

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
)

type Extension struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Source       string `json:"source"`
	Path         string `json:"path"`
	Message      string `json:"message"`
	Bundled      bool   `json:"bundled"`
	BundledBytes int    `json:"bundledBytes"`
}

type Snapshot struct {
	SchemaVersion int         `json:"schemaVersion"`
	Platform      string      `json:"platform"`
	Architecture  string      `json:"architecture"`
	ObservedAt    string      `json:"observedAt"`
	Extensions    []Extension `json:"extensions"`
}

type Options struct {
	Aria2Path        string
	Aria2ConfigKnown bool
	Aria2ConfigError error
}

type detector struct {
	platform, architecture string
	lookPath               func(string) (string, error)
	stat                   func(string) (os.FileInfo, error)
	getenv                 func(string) string
	captureTool            func() (string, error)
	bundleInfo             func() bundledaria2.Metadata
	now                    func() time.Time
}

func Inspect(options Options) Snapshot {
	return detector{
		platform: runtime.GOOS, architecture: runtime.GOARCH,
		lookPath: exec.LookPath, stat: os.Stat, getenv: os.Getenv,
		captureTool: packetwork.FindCaptureTool, bundleInfo: bundledaria2.Inspect,
		now: time.Now,
	}.inspect(options)
}

func (d detector) inspect(options Options) Snapshot {
	tailscale := d.locate("tailscale", "tailscale", d.tailscalePaths())
	tailscale.Message = detectionMessage(tailscale, "Open Tailscale to inspect its existing login, daemon, and devices.", "Install the official Tailscale client, then refresh.")
	cloudflared := d.locate("cloudflared", "cloudflared", nil)
	cloudflared.Message = detectionMessage(cloudflared, "Open Cloudflare Tunnel to inspect its service and configuration.", "cloudflared was not found on PATH. Open Cloudflare Tunnel to check a service installation or see setup guidance.")
	capture := d.locate("wireshark", "dumpcap", nil)
	if capture.Status == "missing" {
		if path, err := d.captureTool(); err == nil && validPath(path) {
			capture.Status, capture.Source, capture.Path = "detected", "standard-location", path
		}
	}
	capture.Message = detectionMessage(capture, "dumpcap was found. Capture permissions and interfaces are checked when you open live capture.", "Install Wireshark with capture support, then refresh. Offline capture-file inspection works without it.")
	nmap := d.locate("nmap", "nmap", d.windowsPaths("Nmap", "nmap.exe"))
	nmap.Message = detectionMessage(nmap, "Open Nmap to review an explicit scan. No scan has started.", "Install Nmap, then refresh. The built-in port scanner works without it.")
	netbird := d.locate("netbird", "netbird", d.windowsPaths("NetBird", "netbird.exe"))
	netbird.Message = detectionMessage(netbird, "Open NetBird to inspect its existing client, daemon and peer evidence.", "Install the official NetBird client, then refresh. Installation does not join a network.")
	return Snapshot{
		SchemaVersion: 1, Platform: d.platform, Architecture: d.architecture,
		ObservedAt: d.now().UTC().Format(time.RFC3339Nano),
		Extensions: []Extension{tailscale, cloudflared, capture, nmap, d.aria2(options), netbird},
	}
}

func (d detector) locate(id, name string, candidates []string) Extension {
	result := Extension{ID: id, Status: "missing", Source: "none"}
	if path, err := d.lookPath(name); err == nil && validPath(path) {
		result.Status, result.Source, result.Path = "detected", "path", path
		return result
	}
	for _, path := range candidates {
		if !filepath.IsAbs(path) || !validPath(path) {
			continue
		}
		if info, err := d.stat(path); err == nil && info.Mode().IsRegular() {
			result.Status, result.Source, result.Path = "detected", "standard-location", path
			return result
		}
	}
	return result
}

func (d detector) windowsPaths(parts ...string) []string {
	if d.platform != "windows" {
		return nil
	}
	paths := []string{}
	for _, variable := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		root := d.getenv(variable)
		if filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(append([]string{root}, parts...)...))
		}
	}
	return paths
}

func (d detector) tailscalePaths() []string {
	if d.platform == "darwin" {
		return []string{"/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"}
	}
	if root := d.getenv("ProgramFiles"); d.platform == "windows" && filepath.IsAbs(root) {
		return []string{filepath.Join(root, "Tailscale", "tailscale.exe")}
	}
	return nil
}

func (d detector) aria2(options Options) Extension {
	info := d.bundleInfo()
	result := Extension{ID: "aria2", Status: "missing", Source: "none", Bundled: info.Included, BundledBytes: info.ArchiveBytes}
	if !options.Aria2ConfigKnown || options.Aria2ConfigError != nil {
		result.Status = "unavailable"
		result.Message = "Downloader host settings could not be read. Open Files to review its configuration."
		return result
	}
	if configured := strings.TrimSpace(options.Aria2Path); configured != "" {
		result.Source = "configured"
		if path, err := d.lookPath(configured); err == nil && validPath(path) {
			result.Status, result.Path = "detected", path
			result.Message = "The configured aria2 executable was found. Downloader starts only when requested."
		} else {
			result.Status = "unavailable"
			result.Message = "The configured aria2 executable was not found. Review its path in Files; a configured path takes priority over other engines."
		}
		return result
	}
	if path, err := d.lookPath("aria2c"); err == nil && validPath(path) {
		result.Status, result.Source, result.Path = "detected", "path", path
		result.Message = "aria2 was found on PATH. Downloader starts only when requested."
		return result
	}
	if info.Included {
		result.Status, result.Source = "included", "bundled"
		result.Message = "This build includes an aria2 companion. It is prepared only when you start Downloader."
		if info.CacheError != "" {
			result.Status = "unavailable"
			result.Message = info.CacheError
		} else if info.CachedPath != "" && validPath(info.CachedPath) {
			result.Status, result.Source, result.Path = "detected", "cached-bundle", info.CachedPath
			result.Message = "The included aria2 companion is already cached and its checksum matches. Downloader is not started by this check."
		}
		return result
	}
	result.Message = "Install aria2 or set its executable path in Files. This build has no bundled download engine."
	return result
}

func detectionMessage(extension Extension, found, missing string) string {
	if extension.Status == "detected" {
		return found
	}
	return missing
}

func validPath(path string) bool {
	return path != "" && len(path) <= 4096 && utf8.ValidString(path) && strings.IndexFunc(path, unicode.IsControl) < 0
}
