package userroot

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveTrustedRootAliasWithoutCreatingDescendants(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "real")
	if err := os.Mkdir(real, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(real, alias); err != nil {
		t.Skipf("host cannot create symlinks: %v", err)
	}
	resolved, err := Resolve(filepath.Join(alias, "missing"))
	if err != nil {
		t.Fatal(err)
	}
	// macOS exposes its temporary directory through /var -> /private/var.
	canonical, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(canonical, "missing")
	if resolved != want {
		t.Fatalf("got %q want %q", resolved, want)
	}
	if _, err := os.Stat(want); !os.IsNotExist(err) {
		t.Fatalf("read created directory: %v", err)
	}
}
