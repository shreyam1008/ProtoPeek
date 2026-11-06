//go:build windows

package media

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsConfigJunctionAndOwnedJunctionBoundary(t *testing.T) {
	base := t.TempDir()
	actual := filepath.Join(base, "actual")
	if err := os.Mkdir(actual, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "config-junction")
	if output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", link, actual).CombinedOutput(); err != nil {
		t.Fatalf("create config junction: %v: %s", err, output)
	}
	t.Setenv("APPDATA", link)
	s, err := New()
	if err != nil {
		t.Fatalf("OS config junction rejected: %v", err)
	}
	if !strings.EqualFold(filepath.Clean(s.root), filepath.Join(actual, "protopeek", "media")) {
		t.Fatalf("config root not resolved: %s", s.root)
	}
	s.Close()
	other := filepath.Join(base, "other")
	if err := os.Mkdir(other, 0700); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", filepath.Join(other, "protopeek"), actual).CombinedOutput(); err != nil {
		t.Fatalf("create owned junction: %v: %s", err, output)
	}
	t.Setenv("APPDATA", other)
	if s, err := New(); err == nil {
		s.Close()
		t.Fatal("app-owned junction accepted")
	}
}
