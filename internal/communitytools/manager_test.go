package communitytools

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
)

func digest(b []byte) string {
	hash := sha256.Sum256(b)
	return hex.EncodeToString(hash[:])
}

func testManager(t *testing.T, payload []byte, a Asset) *Manager {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	a.Platform = runtime.GOOS + "/" + runtime.GOARCH
	a.URL = server.URL
	a.Size = int64(len(payload))
	a.SHA256 = digest(payload)
	a.Version = "1.2.3"
	return &Manager{cache: t.TempDir(), platform: a.Platform, client: server.Client(), entries: []Entry{{ID: "fixture", Assets: []Asset{a}}}}
}

func TestEmbeddedCatalogValid(t *testing.T) {
	entries, err := parseCatalog(catalogJSON)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 14 || len(IDs()) != len(entries) || !IsKnown("grpcurl") || IsKnown("unknown") {
		t.Fatalf("unexpected community catalog: %d entries", len(entries))
	}
}

func TestCatalogMatchesPublishedSchema(t *testing.T) {
	data, err := os.ReadFile("catalog.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		t.Fatal(err)
	}
	var catalog any
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	if err := resolved.Validate(catalog); err != nil {
		t.Fatalf("catalog does not match its schema: %v", err)
	}
}

func TestDirectLifecycleAndTampering(t *testing.T) {
	data := []byte("a trusted executable fixture")
	m := testManager(t, data, Asset{Format: "binary"})
	first, err := m.Status("fixture")
	if err != nil || first.Status != "available" || !first.CanInstall {
		t.Fatalf("initial status: %+v %v", first, err)
	}
	target := filepath.Join(m.cache, "sentinel")
	if err := os.WriteFile(target, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	installed, err := m.Install(context.Background(), "fixture")
	if err != nil || installed.Status != "installed" || installed.Path == "" {
		t.Fatalf("install: %+v %v", installed, err)
	}
	inventory := m.Inventory()
	if len(inventory) != 1 || inventory[0].Path != "" {
		t.Fatalf("inventory should not publish an unverified path: %+v", inventory)
	}
	path, release, err := m.Acquire("fixture")
	if err != nil || path != installed.Path {
		t.Fatalf("acquire: %q %v", path, err)
	}
	otherPath, otherRelease, err := m.Acquire("fixture")
	if err != nil || otherPath != path {
		t.Fatalf("second concurrent acquire: %q %v", otherPath, err)
	}
	if _, err := m.Remove("fixture"); !errors.Is(err, managedtools.ErrBusy) {
		t.Fatalf("remove while in use: %v", err)
	}
	if _, err := m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrBusy) {
		t.Fatalf("install while in use: %v", err)
	}
	release()
	release()
	if _, err := m.Remove("fixture"); !errors.Is(err, managedtools.ErrBusy) {
		t.Fatalf("remove while second use is active: %v", err)
	}
	otherRelease()
	if _, err := m.Install(context.Background(), "fixture"); err != nil {
		t.Fatalf("retry install: %v", err)
	}
	changed := bytes.Repeat([]byte("x"), len(data))
	if err := os.WriteFile(path, changed, 0700); err != nil {
		t.Fatal(err)
	}
	status, err := m.Status("fixture")
	if err != nil || status.Status != "invalid" || status.Path != "" || status.RecoveryPath != path || !strings.Contains(status.Message, "Preserve it") {
		t.Fatalf("tampered status: %+v %v", status, err)
	}
	if _, err := m.Remove("fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("remove altered file: %v", err)
	}
	if _, err := m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("replace altered file: %v", err)
	}
	preserved := filepath.Join(m.cache, "preserved-fixture")
	if err := os.Rename(path, preserved); err != nil {
		t.Fatal(err)
	}
	available, err := m.Status("fixture")
	if err != nil || available.Status != "available" || !available.CanInstall {
		t.Fatalf("status after preserving modified file: %+v %v", available, err)
	}
	if _, err := m.Install(context.Background(), "fixture"); err != nil {
		t.Fatalf("reinstall: %v", err)
	}
	if content, err := os.ReadFile(preserved); err != nil || !bytes.Equal(content, changed) {
		t.Fatalf("modified file was not preserved: %q %v", content, err)
	}
	removed, err := m.Remove("fixture")
	if err != nil || removed.Status != "available" {
		t.Fatalf("remove: %+v %v", removed, err)
	}
	if content, err := os.ReadFile(target); err != nil || string(content) != "preserve" {
		t.Fatalf("unrelated file changed: %q %v", content, err)
	}
}

func TestHardLinkedOperationLockPreservesUnrelatedFile(t *testing.T) {
	data := []byte("trusted fixture")
	m := testManager(t, data, Asset{Format: "binary"})
	asset := m.entries[0].Assets[0]
	if err := m.directories("fixture", asset, true); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(m.cache, "unrelated.txt")
	const original = "keep this user-owned file"
	if err := os.WriteFile(sentinel, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(m.base(), "fixture", "operation.lock")
	if err := os.Link(sentinel, lockPath); err != nil {
		t.Skipf("filesystem does not support hard links: %v", err)
	}
	if _, err := m.Install(context.Background(), "fixture"); err != nil {
		t.Fatalf("install: %v", err)
	}
	_, release, err := m.Acquire("fixture")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if _, err := m.Remove("fixture"); !errors.Is(err, managedtools.ErrBusy) {
		release()
		t.Fatalf("remove while in use: %v", err)
	}
	release()
	if _, err := m.Remove("fixture"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	got, err := os.ReadFile(sentinel)
	if err != nil || string(got) != original {
		t.Fatalf("unrelated hard-linked file changed: %q %v", got, err)
	}
}

func TestSymlinkOperationLockIsRejected(t *testing.T) {
	m := testManager(t, []byte("fixture"), Asset{Format: "binary"})
	asset := m.entries[0].Assets[0]
	if err := m.directories("fixture", asset, true); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(m.cache, "unrelated.txt")
	const original = "preserve this file"
	if err := os.WriteFile(sentinel, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(m.base(), "fixture", "operation.lock")
	if err := os.Symlink(sentinel, lockPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if file, err := openLockFile(lockPath); err == nil {
		_ = file.Close()
		t.Fatal("lock opener followed a symbolic link")
	}
	if _, err := m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("install with symlinked lock: %v", err)
	}
	if _, _, err := m.Acquire("fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("acquire with symlinked lock: %v", err)
	}
	got, err := os.ReadFile(sentinel)
	if err != nil || string(got) != original {
		t.Fatalf("symlink target changed: %q %v", got, err)
	}
}

func TestInvalidDirectoryRecoveryGuidance(t *testing.T) {
	m := testManager(t, []byte("fixture"), Asset{Format: "binary"})
	if err := os.WriteFile(filepath.Join(m.cache, "protopeek"), []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	status, err := m.Status("fixture")
	if err != nil || status.Status != "invalid" || status.Path != "" || status.RecoveryPath == "" || !strings.Contains(status.Message, "parent directories") {
		t.Fatalf("unsafe directory status: %+v %v", status, err)
	}
	if inventory := m.Inventory(); len(inventory) != 1 || inventory[0].RecoveryPath != "" {
		t.Fatalf("inventory should not expose a recovery path: %+v", inventory)
	}
}

func TestCommunityUseHelper(t *testing.T) {
	if os.Getenv("PROTOPEEK_COMMUNITY_TEST_HELPER") != "1" {
		return
	}
	data := []byte("cross-process executable fixture")
	platform := runtime.GOOS + "/" + runtime.GOARCH
	a := Asset{Platform: platform, Version: "1.2.3", Format: "binary", Size: int64(len(data)), SHA256: digest(data)}
	m := &Manager{cache: os.Getenv("PROTOPEEK_COMMUNITY_TEST_CACHE"), platform: platform, entries: []Entry{{ID: "fixture", Assets: []Asset{a}}}}
	_, release, err := m.Acquire("fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	fmt.Fprintln(os.Stdout, "ready")
	if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
}

func TestUseLockProtectsAcrossProcesses(t *testing.T) {
	data := []byte("cross-process executable fixture")
	m := testManager(t, data, Asset{Format: "binary"})
	if _, err := m.Install(context.Background(), "fixture"); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestCommunityUseHelper$", "-test.timeout=20s")
	cmd.Env = append(os.Environ(), "PROTOPEEK_COMMUNITY_TEST_HELPER=1", "PROTOPEEK_COMMUNITY_TEST_CACHE="+m.cache)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	ready := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(stdout).ReadString('\n')
		ready <- strings.TrimSpace(line)
	}()
	select {
	case line := <-ready:
		if line != "ready" {
			t.Fatalf("helper failed to acquire: %q", line)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("helper did not acquire the lock")
	}
	if _, err := m.Remove("fixture"); !errors.Is(err, managedtools.ErrBusy) {
		t.Fatalf("remove while other process is using the tool: %v", err)
	}
	if _, err := fmt.Fprintln(stdin, "release"); err != nil {
		t.Fatal(err)
	}
	_ = stdin.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatalf("helper failed: %v: %s", err, stderr.String())
	}
	if _, err := m.Remove("fixture"); err != nil {
		t.Fatalf("remove after other process released the tool: %v", err)
	}
}

func TestDownloadRejectsChangedOrExtraBytes(t *testing.T) {
	data := []byte("expected binary")
	m := testManager(t, data, Asset{Format: "binary"})
	m.entries[0].Assets[0].SHA256 = digest([]byte("incorrect"))
	if _, err := m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("wrong digest accepted: %v", err)
	}
	m.entries[0].Assets[0].SHA256 = digest(data[:len(data)-1])
	m.entries[0].Assets[0].Size--
	if _, err := m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("extra bytes accepted: %v", err)
	}
}

func TestCanceledInstallDoesNotCreateOwnedDirectory(t *testing.T) {
	m := testManager(t, []byte("test"), Asset{Format: "binary"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.Install(ctx, "fixture"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled install: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(m.cache, "protopeek")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled install created a directory: %v", err)
	}
}

func archiveBytes(t *testing.T, format string, names []string, data []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	if format == "zip" {
		writer := zip.NewWriter(&out)
		for _, name := range names {
			entry, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = entry.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	} else {
		gz := gzip.NewWriter(&out)
		writer := tar.NewWriter(gz)
		for _, name := range names {
			if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0700, Size: int64(len(data))}); err != nil {
				t.Fatal(err)
			}
			if _, err := writer.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		if err := gz.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return out.Bytes()
}

func TestArchiveLifecycleAndUnsafeEntries(t *testing.T) {
	data := []byte("trusted archive executable")
	for _, format := range []string{"zip", "tar.gz"} {
		for _, test := range []struct {
			name    string
			paths   []string
			success bool
		}{
			{"normal", []string{"README", "dir/tool"}, true},
			{"missing", []string{"README"}, false},
			{"duplicate", []string{"dir/tool", "dir/tool"}, false},
			{"traversal", []string{"dir/tool", "../outside"}, false},
			{"absolute", []string{"dir/tool", "/outside"}, false},
		} {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				payload := archiveBytes(t, format, test.paths, data)
				m := testManager(t, payload, Asset{Format: format, Member: "dir/tool", BinarySize: int64(len(data)), BinarySHA256: digest(data)})
				tool, err := m.Install(context.Background(), "fixture")
				if test.success {
					if err != nil || tool.Path == "" {
						t.Fatalf("install: %+v %v", tool, err)
					}
					actual, err := os.ReadFile(tool.Path)
					if err != nil || !bytes.Equal(actual, data) {
						t.Fatalf("installed bytes: %v", err)
					}
					if _, err = m.Remove("fixture"); err != nil {
						t.Fatal(err)
					}
				} else if !errors.Is(err, managedtools.ErrInvalid) {
					t.Fatalf("invalid archive accepted: %v", err)
				}
			})
		}
	}
}

func TestZIPRejectsSymlink(t *testing.T) {
	data := []byte("target")
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	header := &zip.FileHeader{Name: "dir/tool"}
	header.SetMode(os.ModeSymlink | 0777)
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	m := testManager(t, out.Bytes(), Asset{Format: "zip", Member: "dir/tool", BinarySize: int64(len(data)), BinarySHA256: digest(data)})
	if _, err = m.Install(context.Background(), "fixture"); !errors.Is(err, managedtools.ErrInvalid) {
		t.Fatalf("symlink accepted: %v", err)
	}
}

func TestCatalogValidation(t *testing.T) {
	entry := Entry{ID: "sample", Name: "Sample", Group: "Inspect traffic & services", Description: "Example", License: "MIT", Source: "https://example.test", Assets: []Asset{{Platform: "linux/amd64", Version: "v1", URL: "https://example.test/download", SHA256: strings.Repeat("a", 64), Size: 1, Format: "binary"}}}
	if err := validate([]Entry{entry}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../outside", "a/b", "UPPER", "two--dashes"} {
		bad := entry
		bad.ID = id
		if err := validate([]Entry{bad}); err == nil {
			t.Fatalf("accepted ID %q", id)
		}
	}
	for _, id := range []string{"aria2", "cloudflared", "yt-dlp", "gallery-dl", "deno", "ffmpeg"} {
		reserved := entry
		reserved.ID = id
		if err := validate([]Entry{reserved}); err == nil {
			t.Fatalf("accepted reserved ID %q", id)
		}
	}
	bad := entry
	bad.Assets = append(append([]Asset{}, entry.Assets...), entry.Assets[0])
	if err := validate([]Entry{bad}); err == nil {
		t.Fatal("accepted duplicate platform")
	}
	for _, name := range []string{"../x", "/absolute", "x/../y", `x\y`, "x//y"} {
		if validMember(name) {
			t.Fatalf("accepted member %q", name)
		}
	}
	if _, err := parseCatalog([]byte(`[] {}`)); err == nil {
		t.Fatal("accepted trailing JSON")
	}
}
