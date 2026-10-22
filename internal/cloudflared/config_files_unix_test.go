//go:build !windows

package cloudflared

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalConfigRefusesSymlinkedAncestorWithRegularLeaf(t *testing.T) {
	state := fixtureOperations(t)
	data, _, err := readRegularConfig(state.path)
	if err != nil || string(data) != operationFixture {
		t.Fatalf("canonical fixture was not readable: %v", err)
	}
	alias := filepath.Join(filepath.Dir(state.path), "directory-alias")
	if err := os.Symlink(filepath.Dir(state.path), alias); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(alias, filepath.Base(state.path))
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		t.Fatalf("linked ancestor fixture did not retain a regular leaf: %v", err)
	}
	if _, _, err := readRegularConfig(path); err == nil || !strings.Contains(err.Error(), "symlink or reparse") {
		t.Fatalf("a symlinked ancestor was adopted: %v", err)
	}
	data, err = os.ReadFile(state.path)
	if err != nil || string(data) != operationFixture {
		t.Fatalf("ancestor refusal changed the canonical file: %v", err)
	}
}
