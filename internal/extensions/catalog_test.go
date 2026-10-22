package extensions

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
)

func fixtureDetector() detector {
	return detector{
		platform: runtime.GOOS, architecture: runtime.GOARCH,
		lookPath: exec.LookPath, stat: os.Stat, getenv: func(string) string { return "" },
		captureTool: func() (string, error) { return "", exec.ErrNotFound },
		bundleInfo:  func() bundledaria2.Metadata { return bundledaria2.Metadata{} },
		now:         func() time.Time { return time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC) },
	}
}

func fixtureExecutable(t *testing.T, dir, name string) string {
	t.Helper()
	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	// Deliberately not an executable image: inspection must only locate it.
	if err := os.WriteFile(path, []byte("metadata-only fixture; must never execute"), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCatalogLocatesFixedToolsWithoutExecutingFixtures(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	for _, name := range []string{"tailscale", "cloudflared", "dumpcap", "nmap", "aria2c", "netbird"} {
		fixtureExecutable(t, dir, name)
	}
	got := fixtureDetector().inspect(Options{Aria2ConfigKnown: true})
	if got.SchemaVersion != 1 || got.Platform != runtime.GOOS || got.Architecture != runtime.GOARCH || got.ObservedAt != "2026-09-28T10:00:00Z" || len(got.Extensions) != 6 {
		t.Fatalf("snapshot = %#v", got)
	}
	for i, id := range []string{"tailscale", "cloudflared", "wireshark", "nmap", "aria2", "netbird"} {
		entry := got.Extensions[i]
		if entry.ID != id || entry.Status != "detected" || entry.Source != "path" || entry.Path == "" || entry.Bundled || entry.BundledBytes != 0 {
			t.Fatalf("extension %s = %#v", id, entry)
		}
	}
}

func TestCatalogMissingToolsAndStandardLocations(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	d := fixtureDetector()
	got := d.inspect(Options{Aria2ConfigKnown: true})
	for _, entry := range got.Extensions {
		if entry.Status != "missing" || entry.Source != "none" || entry.Path != "" || entry.Message == "" {
			t.Fatalf("missing extension = %#v", entry)
		}
	}
	d.platform = "windows"
	d.getenv = func(name string) string {
		if name == "ProgramFiles" {
			return dir
		}
		return "relative-path-is-not-a-standard-install-root"
	}
	tailPath := fixtureExecutable(t, dir, filepath.Join("Tailscale", "tailscale.exe"))
	nmapPath := fixtureExecutable(t, dir, filepath.Join("Nmap", "nmap.exe"))
	capturePath := fixtureExecutable(t, dir, filepath.Join("Wireshark", "dumpcap.exe"))
	d.captureTool = func() (string, error) { return capturePath, nil }
	got = d.inspect(Options{Aria2ConfigKnown: true})
	for _, want := range []struct {
		index int
		path  string
	}{{0, tailPath}, {2, capturePath}, {3, nmapPath}} {
		if entry := got.Extensions[want.index]; entry.Status != "detected" || entry.Source != "standard-location" || entry.Path != want.path {
			t.Fatalf("standard-location extension = %#v", entry)
		}
	}
	if got.Extensions[1].Status != "missing" || !strings.Contains(got.Extensions[1].Message, "service installation") {
		t.Fatal("cloudflared PATH absence must not claim no service installation")
	}
}

func TestAria2ConfiguredPathHasPriorityWithoutBundleFallback(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	pathEngine := fixtureExecutable(t, dir, "aria2c")
	configuredEngine := fixtureExecutable(t, dir, "configured-engine")
	d := fixtureDetector()
	d.bundleInfo = func() bundledaria2.Metadata { return bundledaria2.Metadata{Included: true, ArchiveBytes: 1234} }
	got := d.aria2(Options{Aria2ConfigKnown: true, Aria2Path: configuredEngine})
	if got.Status != "detected" || got.Source != "configured" || got.Path != configuredEngine || !got.Bundled || got.BundledBytes != 1234 {
		t.Fatalf("configured engine = %#v", got)
	}
	got = d.aria2(Options{Aria2ConfigKnown: true, Aria2Path: filepath.Join(dir, "missing-engine")})
	if got.Status != "unavailable" || got.Source != "configured" || got.Path != "" {
		t.Fatalf("configured missing path fell back: %#v", got)
	}
	got = d.aria2(Options{Aria2ConfigKnown: true})
	if got.Status != "detected" || got.Source != "path" || got.Path != pathEngine {
		t.Fatalf("PATH should take priority over bundle: %#v", got)
	}
}

func TestTailscaleCatalogMatchesWorkbenchInstallLocations(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	fixtureExecutable(t, dir, filepath.Join("Tailscale", "tailscale.exe"))
	d := fixtureDetector()
	d.platform = "windows"
	d.getenv = func(name string) string {
		if name == "ProgramFiles(x86)" {
			return dir
		}
		return ""
	}
	if got := d.inspect(Options{Aria2ConfigKnown: true}).Extensions[0]; got.Status != "missing" {
		t.Fatalf("catalog found a location the workbench does not use: %#v", got)
	}
}

func TestAria2BundleStatesAndUnavailableConfiguration(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	d := fixtureDetector()
	info := bundledaria2.Metadata{Included: true, ArchiveBytes: 1234}
	d.bundleInfo = func() bundledaria2.Metadata { return info }
	got := d.aria2(Options{Aria2ConfigKnown: true})
	if got.Status != "included" || got.Source != "bundled" || got.Path != "" {
		t.Fatalf("included engine = %#v", got)
	}
	info.CachedPath = filepath.Join(t.TempDir(), "aria2c.exe")
	got = d.aria2(Options{Aria2ConfigKnown: true})
	if got.Status != "detected" || got.Source != "cached-bundle" || got.Path != info.CachedPath {
		t.Fatalf("cached engine = %#v", got)
	}
	info.CacheError = "Checksum mismatch."
	got = d.aria2(Options{Aria2ConfigKnown: true})
	if got.Status != "unavailable" || got.Path != "" || got.Message != info.CacheError {
		t.Fatalf("invalid cache = %#v", got)
	}
	for _, options := range []Options{{}, {Aria2ConfigKnown: true, Aria2ConfigError: errors.New("private configuration error")}} {
		got := d.aria2(options)
		if got.Status != "unavailable" || strings.Contains(got.Message, "private") || got.Path != "" {
			t.Fatalf("unknown config = %#v", got)
		}
	}
}

func TestCatalogBoundsAndRejectsUnsafePathMetadata(t *testing.T) {
	d := fixtureDetector()
	for _, path := range []string{strings.Repeat("x", 4097), "unsafe\npath", "\xff"} {
		d.lookPath = func(string) (string, error) { return path, nil }
		d.captureTool = func() (string, error) { return path, nil }
		got := d.inspect(Options{Aria2ConfigKnown: true})
		for _, entry := range got.Extensions {
			if entry.Path != "" || entry.Status == "detected" || len(entry.Message) > 2048 {
				t.Fatalf("unsafe path escaped: %#v", entry)
			}
		}
	}
}
