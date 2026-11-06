package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
)

// Runs only against an explicitly staged CoreOnly package. The normal unit
// suite never installs a companion or needs a release download.
func TestStagedCoreDownloadsWithManagedAria2(t *testing.T) {
	staged := os.Getenv("PROTOPEEK_STAGED_CORE")
	if staged == "" {
		t.Skip("requires a staged Windows amd64 CoreOnly package")
	}
	if !filepath.IsAbs(staged) {
		t.Fatal("staged package must be an absolute path")
	}
	if _, err := os.Lstat(filepath.Join(staged, bundledaria2.CompanionFilename)); !os.IsNotExist(err) {
		t.Fatalf("CoreOnly package contains a sidecar or is unreadable: %v", err)
	}
	gitOutput := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("git", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("git: %v: %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	revision := gitOutput("rev-parse", "HEAD")
	version := "source-" + gitOutput("describe", "--always", "--long", "--dirty")
	t.Logf("testing checkout %s, version %s", revision, version)
	root := t.TempDir()
	profile := filepath.Join(root, "user")
	cache := filepath.Join(root, "cache")
	temp := filepath.Join(root, "temp")
	dir := filepath.Join(root, "empty-path")
	for _, path := range []string{profile, cache, temp, dir} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("LOCALAPPDATA", cache)
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("USERPROFILE", profile)
	t.Setenv("HOME", profile)
	t.Setenv("PATH", dir)
	t.Setenv("TEMP", temp)
	t.Setenv("TMP", temp)
	run := func(command string, args ...string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, filepath.Join(staged, command+".exe"), args...)
		cmd.Dir = root
		var diagnostics bytes.Buffer
		cmd.Stderr = &diagnostics
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("%s %v: %v: %s", command, args, err, diagnostics.String())
		}
		if len(args) == 1 && args[0] == "--version" && len(out) == 0 {
			return strings.TrimSpace(diagnostics.String())
		}
		return strings.TrimSpace(string(out))
	}
	for _, cmd := range []string{"protopeek", "pp"} {
		line := run(cmd, "--version")
		if !strings.HasSuffix(line, " "+version) {
			t.Fatalf("%s version does not match checkout: %q", cmd, line)
		}
		t.Log(line)
	}
	observe := func(command, action string) managedtools.Tool {
		t.Helper()
		raw := run(command, "extensions", action, "aria2", "--json")
		var tool managedtools.Tool
		if err := json.Unmarshal([]byte(raw), &tool); err != nil || tool.ID != "aria2" || tool.Version != bundledaria2.EngineVersion {
			t.Fatalf("invalid %s result: %v %s", action, err, raw)
		}
		return tool
	}
	available := observe("protopeek", "status")
	url, size, ok := bundledaria2.ManagedDownload()
	if !ok || available.Status != "available" || !available.CanInstall || available.CanRemove || available.SourceURL != url || available.InstallBytes != size {
		t.Fatalf("unexpected empty profile: %+v", available)
	}
	if ready := observe("pp", "install"); ready.Status != "installed" || !ready.CanRemove {
		t.Fatalf("installation: %+v", ready)
	}
	// Compare the actual fetched archive with the authoritative source copy; no
	// checked-in archive is passed to either staged executable.
	archive := filepath.Join(cache, "protopeek", "engines", "aria2", bundledaria2.CompanionFilename)
	fetched, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := os.ReadFile(filepath.Join("..", "..", "internal", "bundledaria2", "assets", strings.TrimPrefix(bundledaria2.CompanionFilename, "protopeek-")))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fetched, pinned) || int64(len(fetched)) != size {
		t.Fatal("downloaded companion differs from the pinned archive")
	}
	t.Logf("downloaded %s (%d bytes, SHA-256 %x)", available.SourceURL, len(fetched), sha256.Sum256(fetched))
	data := bytes.Repeat([]byte("ProtoPeek CoreOnly loopback acceptance\n"), 2048)
	expected := sha256.Sum256(data)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "fixture.bin", time.Time{}, bytes.NewReader(data))
	}))
	defer fixture.Close()
	file := run("pp", "download", "--output", "fixture.bin", "--sha256", fmt.Sprintf("%x", expected), fixture.URL+"/fixture.bin")
	relative, err := filepath.Rel(profile, filepath.FromSlash(file))
	if err != nil || !filepath.IsLocal(relative) {
		t.Fatalf("unexpected download location %q", file)
	}
	if state := observe("protopeek", "remove"); state.Status != "available" || state.CanRemove {
		t.Fatalf("remove: %+v", state)
	}
	if _, err = os.Lstat(archive); !os.IsNotExist(err) {
		t.Fatalf("managed archive remains after removal: %v", err)
	}
	remaining, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(remaining, data) {
		t.Fatalf("download changed after removal: %v", err)
	}
	t.Logf("verified transfer survived removal (%d bytes, SHA-256 %x)", len(remaining), expected)
}
