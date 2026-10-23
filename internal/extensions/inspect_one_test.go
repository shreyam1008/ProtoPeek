package extensions

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/extensions/catalogids"
)

func TestInspectOneChecksOnlySelectedCommandAndNeverExecutesFixtures(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	for _, name := range []string{"tailscale", "cloudflared", "netbird", "dumpcap", "nmap", "aria2c", "caddy", "ngrok", "ssh", "docker", "podman", "kubectl", "openssl", "codex", "claude", "gemini", "opencode", "ollama", "lms"} {
		fixtureExecutable(t, dir, name)
	}
	for _, definition := range catalogids.All() {
		t.Run(definition.ID, func(t *testing.T) {
			d := fixtureDetector()
			var looked []string
			captureCalls, bundleCalls := 0, 0
			d.lookPath = func(name string) (string, error) {
				looked = append(looked, name)
				return exec.LookPath(name)
			}
			d.captureTool = func() (string, error) { captureCalls++; return "", exec.ErrNotFound }
			d.bundleInfo = func() bundledaria2.Metadata { bundleCalls++; return bundledaria2.Metadata{} }
			d.stat = func(string) (os.FileInfo, error) {
				t.Fatal("PATH result should not need a fixed-location stat")
				return nil, os.ErrNotExist
			}
			got, err := d.inspectOne(definition.ID, Options{Aria2ConfigKnown: true})
			if err != nil || got.SchemaVersion != 2 || len(got.Extensions) != 1 || got.Extensions[0].ID != definition.ID || got.ObservedAt == "" {
				t.Fatalf("snapshot=%+v err=%v", got, err)
			}
			entry := got.Extensions[0]
			if definition.ID == "chatgpt" {
				if entry.Status != "external" || entry.Path != "" || len(looked) != 0 || captureCalls != 0 || bundleCalls != 0 {
					t.Fatalf("external app performed lookup or implied installed: %+v looked=%v", entry, looked)
				}
				return
			}
			wantCommand := companionCommand(definition.ID)
			if definition.ID == "wireshark" {
				wantCommand = "dumpcap"
			}
			if definition.ID == "aria2" {
				wantCommand = "aria2c"
			}
			wantBundles := 0
			if definition.ID == "aria2" {
				wantBundles = 1
			}
			if entry.Status != "detected" || !reflect.DeepEqual(looked, []string{wantCommand}) || captureCalls != 0 || bundleCalls != wantBundles {
				t.Fatalf("unselected IO or executable was run: entry=%+v looked=%v capture=%d bundle=%d", entry, looked, captureCalls, bundleCalls)
			}
		})
	}
}

func TestInspectOneRejectsUnknownBeforeAnyHostLookup(t *testing.T) {
	d := fixtureDetector()
	d.lookPath = func(string) (string, error) { t.Fatal("unexpected PATH lookup"); return "", nil }
	d.stat = func(string) (os.FileInfo, error) { t.Fatal("unexpected stat"); return nil, nil }
	d.getenv = func(string) string { t.Fatal("unexpected environment read"); return "" }
	d.captureTool = func() (string, error) { t.Fatal("unexpected capture lookup"); return "", nil }
	d.bundleInfo = func() bundledaria2.Metadata { t.Fatal("unexpected cached bundle hash"); return bundledaria2.Metadata{} }
	for _, id := range []string{"", "../caddy", "CADDY", "ssh", "caddy\x00"} {
		if _, err := d.inspectOne(id, Options{}); !errors.Is(err, ErrUnknownID) {
			t.Fatalf("unknown %q: %v", id, err)
		}
	}
}

func TestInspectOneDocumentsLookupScopeWithoutClaimingAppAbsence(t *testing.T) {
	d := fixtureDetector()
	d.lookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	d.stat = func(string) (os.FileInfo, error) { return nil, os.ErrNotExist }
	for _, id := range []string{"caddy", "ollama", "lm-studio", "openssh"} {
		got, err := d.inspectOne(id, Options{})
		if err != nil {
			t.Fatal(err)
		}
		message := got.Extensions[0].Message
		if !strings.Contains(message, "this running process's PATH") || !strings.Contains(message, "restart ProtoPeek") || !strings.Contains(message, "does not establish that the app is absent") || len(message) > 2048 {
			t.Fatalf("untruthful/unbounded missing message: %q", message)
		}
		if id == "lm-studio" && !strings.Contains(message, "Only the lms CLI") {
			t.Fatal("CLI absence was confused with LM Studio installation")
		}
	}
}

func TestInspectOneUsesOnlyDocumentedFixedUserLocations(t *testing.T) {
	dir := t.TempDir()
	d := fixtureDetector()
	d.platform = "windows"
	d.getenv = func(name string) string {
		if name == "LOCALAPPDATA" || name == "USERPROFILE" {
			return dir
		}
		return ""
	}
	d.lookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	for _, test := range []struct{ id, path string }{
		{"ollama", filepath.Join(dir, "Programs", "Ollama", "ollama.exe")},
		{"lm-studio", filepath.Join(dir, ".lmstudio", "bin", "lms.exe")},
	} {
		path := fixtureExecutable(t, filepath.Dir(test.path), filepath.Base(test.path))
		var checked []string
		d.stat = func(candidate string) (os.FileInfo, error) {
			checked = append(checked, candidate)
			return os.Stat(candidate)
		}
		got, err := d.inspectOne(test.id, Options{})
		if err != nil || got.Extensions[0].Path != path || got.Extensions[0].Source != "standard-location" || !reflect.DeepEqual(checked, []string{test.path}) {
			t.Fatalf("%s snapshot=%+v checked=%v err=%v", test.id, got, checked, err)
		}
	}
	if runtime.GOOS != "windows" {
		d.platform = "darwin"
		d.getenv = func(name string) string {
			if name == "HOME" {
				return dir
			}
			return ""
		}
		if got := d.companionPaths("docker", "docker"); !reflect.DeepEqual(got, []string{"/opt/homebrew/bin/docker", "/usr/local/bin/docker", filepath.Join(dir, ".docker", "bin", "docker")}) {
			t.Fatalf("documented macOS paths = %v", got)
		}
	}
}

func TestInspectOnePATHAliasIsLocatedWithoutAnExecutableOrLoginClaim(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	name := "codex"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, nil, 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := fixtureDetector().inspectOne("codex", Options{})
	if err != nil || got.Extensions[0].Status != "detected" || got.Extensions[0].Path != path || !strings.Contains(got.Extensions[0].Message, "No command was executed") {
		t.Fatalf("zero-byte PATH alias metadata = %+v err=%v", got, err)
	}
}

func TestInspectOneNativeMissingScopeMatchesThePlatform(t *testing.T) {
	d := fixtureDetector()
	d.platform = "linux"
	d.lookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	d.stat = func(string) (os.FileInfo, error) {
		t.Fatal("Linux native lookup has no fixed stat candidates")
		return nil, os.ErrNotExist
	}
	for _, id := range []string{"tailscale", "nmap", "netbird", "cloudflared"} {
		value, err := d.inspectOne(id, Options{})
		if err != nil {
			t.Fatal(err)
		}
		message := value.Extensions[0].Message
		if !strings.Contains(message, "was not located using this process's PATH") || strings.Contains(message, "fixed standard locations") || !strings.Contains(message, "restart ProtoPeek") {
			t.Fatalf("unperformed fallback lookup was claimed: %q", message)
		}
	}
}
