//go:build linux || darwin

package managedtools

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The CI job explicitly enables this test. It downloads the pinned upstream
// asset, verifies it, executes only --version, and removes the owned file.
func TestNativeCloudflaredLifecycle(t *testing.T) {
	if os.Getenv("PROTOPEEK_CLOUDFLARED_INTEGRATION") != "1" {
		t.Skip("explicit upstream asset acceptance required")
	}
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
	cache, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(cache, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(cache, "preserve.txt")
	if err := os.WriteFile(sentinel, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := New()
	if err != nil {
		t.Fatal(err)
	}
	before, err := manager.Status("cloudflared")
	if err != nil || before.Status != "available" || !before.CanInstall {
		t.Fatalf("before: %+v %v", before, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	installed, err := manager.Install(ctx, "cloudflared")
	if err != nil || installed.Status != "installed" || !installed.CanRemove {
		t.Fatalf("install: %+v %v", installed, err)
	}
	binary, err := CloudflaredPath()
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.CommandContext(ctx, binary, "--version").CombinedOutput()
	if err != nil || !strings.Contains(string(output), installed.Version) {
		t.Fatalf("version: %q %v", output, err)
	}
	release, err := AcquireCloudflaredUse(binary)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Remove("cloudflared"); !errors.Is(err, ErrBusy) {
		release()
		t.Fatalf("in-use removal: %v", err)
	}
	release()
	after, err := manager.Remove("cloudflared")
	if err != nil || after.Status != "available" || !after.CanInstall {
		t.Fatalf("remove: %+v %v", after, err)
	}
	if _, err := os.Lstat(binary); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("binary remained: %v", err)
	}
	data, err := os.ReadFile(sentinel)
	if err != nil || string(data) != "untouched" {
		t.Fatalf("unrelated file changed: %q %v", data, err)
	}
	t.Logf("verified pinned %s, ran --version, enforced use lock, and removed owned binary", installed.Version)
}
