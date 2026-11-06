package managedtools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureManager(t *testing.T, payload []byte, handler http.Handler) (*Manager, asset, *atomic.Int64) {
	t.Helper()
	count := new(atomic.Int64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { count.Add(1); handler.ServeHTTP(w, r) }))
	t.Cleanup(server.Close)
	digest := sha256.Sum256(payload)
	a := asset{platform: runtime.GOOS + "/" + runtime.GOARCH, version: "fixture", url: server.URL, sha: hex.EncodeToString(digest[:]), size: int64(len(payload))}
	return &Manager{root: filepath.Join(t.TempDir(), "protopeek", "managed"), platform: a.platform, client: server.Client(), assets: []asset{a}}, a, count
}

func TestCloudflaredExplicitLifecycleAndOwnership(t *testing.T) {
	payload := []byte("verified network companion")
	m, a, requests := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
	t.Setenv("PATH", t.TempDir())
	before, err := m.Status("cloudflared")
	if err != nil || before.Status != "available" || !before.CanInstall || requests.Load() != 0 {
		t.Fatalf("initial: %#v %v", before, err)
	}
	if _, err := os.Lstat(m.root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("status created files: %v", err)
	}
	installed, err := m.Install(context.Background(), "cloudflared")
	if err != nil || installed.Status != "installed" || !installed.CanRemove || requests.Load() != 1 {
		t.Fatalf("install: %#v %v", installed, err)
	}
	path := m.binary(a)
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("wrong bytes: %v", err)
	}
	lease, err := m.lock(a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrBusy) {
		t.Fatalf("removed while in use: %v", err)
	}
	_ = lease.Release()
	other := filepath.Join(filepath.Dir(path), "user-file")
	if err := os.WriteFile(other, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	removed, err := m.Remove("cloudflared")
	if err != nil || removed.Status != "available" {
		t.Fatalf("remove: %#v %v", removed, err)
	}
	if b, err := os.ReadFile(other); err != nil || string(b) != "keep" {
		t.Fatalf("unrelated file touched: %q %v", b, err)
	}
}

func TestConcurrentUsesShareLeaseAndBlockMutation(t *testing.T) {
	payload := []byte("verified network companion")
	m, a, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
	if _, err := m.Install(context.Background(), "cloudflared"); err != nil {
		t.Fatal(err)
	}
	exclusive, err := m.lock(a)
	if err != nil {
		t.Fatal(err)
	}
	if use, err := m.shared(a); !errors.Is(err, ErrBusy) {
		if use != nil {
			_ = use.Release()
		}
		t.Fatalf("use during install: %v", err)
	}
	if err := exclusive.Release(); err != nil {
		t.Fatal(err)
	}
	first, err := m.shared(a)
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.shared(a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrBusy) {
		t.Fatalf("mutation while in use: %v", err)
	}
	if err := first.Release(); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrBusy) {
		t.Fatalf("mutation while second use active: %v", err)
	}
	if err := second.Release(); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Remove("cloudflared"); err != nil {
		t.Fatal(err)
	}
}

func TestCloudflaredRejectsBadDownloadAndChangedOwnedFile(t *testing.T) {
	payload := []byte("verified fixture")
	m, a, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("different bytes!")) }))
	if _, err := m.Install(context.Background(), "cloudflared"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad download: %v", err)
	}
	if _, err := os.Lstat(m.binary(a)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("bad file promoted: %v", err)
	}
	if err := os.WriteFile(m.binary(a), []byte("changed payload!"), 0700); err != nil {
		t.Fatal(err)
	}
	if got, err := m.Status("cloudflared"); err != nil || got.Status != "invalid" || got.CanRemove || got.CanInstall {
		t.Fatalf("changed file: %#v %v", got, err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("changed file removed: %v", err)
	}
	if _, err := os.Lstat(m.binary(a)); err != nil {
		t.Fatalf("changed file lost: %v", err)
	}
}

func TestCloudflaredNonExecutableDoesNotReportReady(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not represent Unix execute bits")
	}
	payload := []byte("verified fixture")
	m, a, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
	if _, err := m.Install(context.Background(), "cloudflared"); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(m.binary(a), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := m.Status("cloudflared")
	if err != nil || got.Status != "invalid" || got.CanRemove || got.CanInstall {
		t.Fatalf("non-executable status: %#v %v", got, err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("removed changed metadata: %v", err)
	}
}

func TestCloudflaredVersionChangeDoesNotDeleteOlderFiles(t *testing.T) {
	payload := []byte("verified fixture")
	m, old, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
	t.Setenv("PATH", t.TempDir())
	if _, err := m.Install(context.Background(), "cloudflared"); err != nil {
		t.Fatal(err)
	}
	next := old
	next.version = "next-fixture"
	m.assets = []asset{next}
	status, err := m.Status("cloudflared")
	if err != nil || status.Status != "available" {
		t.Fatalf("new pinned version: %+v %v", status, err)
	}
	if _, err := m.Install(context.Background(), "cloudflared"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Remove("cloudflared"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(m.binary(old))
	if err != nil || string(data) != string(payload) {
		t.Fatalf("older version changed: %q %v", data, err)
	}
}

func TestCloudflaredCancelledDownloadNeverPromotesOrLeavesPartial(t *testing.T) {
	payload := []byte("verified fixture")
	m, a, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write(payload[:3])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := m.Install(ctx, "cloudflared"); err == nil {
		t.Fatal("cancelled install succeeded")
	}
	if _, err := os.Lstat(m.binary(a)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cancelled file promoted: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(m.binary(a)))
	if err != nil || len(entries) != 0 {
		t.Fatalf("partial files: %v %v", entries, err)
	}
}

func TestUnknownAndUnsupportedCannotInstall(t *testing.T) {
	m := &Manager{root: filepath.Join(t.TempDir(), "protopeek", "managed"), platform: "unsupported/unknown", assets: cloudflareAssets}
	if _, err := m.Status("../../escape"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("unknown status: %v", err)
	}
	if _, err := m.Install(context.Background(), "../../escape"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("unknown install: %v", err)
	}
	if tool, err := m.Status("cloudflared"); err != nil || tool.Status != "unavailable" || tool.CanInstall {
		t.Fatalf("unsupported: %#v %v", tool, err)
	}
	if _, err := m.Install(context.Background(), "cloudflared"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("unsupported install: %v", err)
	}
}

func TestManagedSymlinkAndUnrelatedFilesAreNeverFollowed(t *testing.T) {
	payload := []byte("verified fixture")
	m, a, _ := fixtureManager(t, payload, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
	if err := m.dirs(true, a); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(external, payload, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, m.binary(a)); err != nil {
		t.Skipf("symlink creation unavailable on this host: %v", err)
	}
	if _, err := m.Remove("cloudflared"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("symlink accepted: %v", err)
	}
	if data, err := os.ReadFile(external); err != nil || string(data) != string(payload) {
		t.Fatalf("outside changed: %q %v", data, err)
	}
}
