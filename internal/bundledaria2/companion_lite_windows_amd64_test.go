//go:build protopeek_lite

package bundledaria2

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Exercise the actual executable-relative lookup in a separate, isolated copy
// of this test binary. No machine PATH, installed engine or user cache is used.
func TestLiteCompanionThroughExecutable(t *testing.T) {
	dir := t.TempDir()
	current, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(current)
	if err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(dir, "companion-test.exe")
	if err := os.WriteFile(child, binary, 0700); err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(filepath.Join("assets", strings.TrimPrefix(CompanionFilename, "protopeek-")))
	if err != nil || len(archive) != windowsArchiveSize || digest(archive) != windowsArchiveSHA {
		t.Fatalf("source archive does not match its pins: %v", err)
	}
	companion := filepath.Join(dir, CompanionFilename)
	run := func(mode string) {
		t.Helper()
		cmd := exec.Command(child, "-test.run=^TestLiteCompanionChild$", "-test.v")
		cmd.Env = append(os.Environ(), "PROTOPEEK_LITE_TEST_CHILD="+mode, "LOCALAPPDATA="+filepath.Join(dir, "cache"))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v\n%s", mode, err, output)
		}
	}
	run("missing")
	if err := os.WriteFile(companion, archive, 0600); err != nil {
		t.Fatal(err)
	}
	run("valid")
	tampered := bytes.Clone(archive)
	tampered[0] ^= 1
	if err := os.WriteFile(companion, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	// An invalid supplied archive fails closed even when the cache is intact.
	run("invalid")
	if err := os.Remove(companion); err != nil {
		t.Fatal(err)
	}
	managedDir := filepath.Join(dir, "cache", "protopeek", "engines", "aria2")
	if err := os.MkdirAll(managedDir, 0700); err != nil {
		t.Fatal(err)
	}
	managedArchive := filepath.Join(managedDir, CompanionFilename)
	if err := os.WriteFile(managedArchive, archive, 0600); err != nil {
		t.Fatal(err)
	}
	// A verified managed archive works offline when the adjacent archive is absent.
	run("valid")
	if err := os.WriteFile(managedArchive, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	run("invalid")
	run("repair")
	if _, err := os.Stat(managedArchive); !os.IsNotExist(err) {
		t.Fatalf("changed archive still active: %v", err)
	}
	quarantine, err := filepath.Glob(filepath.Join(managedDir, ".aria2-quarantine-*"))
	if err != nil || len(quarantine) != 1 {
		t.Fatalf("quarantine: %v %v", quarantine, err)
	}
	retained, err := os.ReadFile(quarantine[0])
	if err != nil || !bytes.Equal(retained, tampered) {
		t.Fatal("changed archive not preserved", err)
	}
	run("legacy")
	cacheDir := filepath.Join(managedDir, windowsBinarySHA)
	license := filepath.Join(cacheDir, "COPYING")
	original, err := os.ReadFile(license)
	if err != nil {
		t.Fatal(err)
	}
	original[0] ^= 1
	if err := os.WriteFile(license, original, 0600); err != nil {
		t.Fatal(err)
	}
	run("changed-cache")
	if err := os.Remove(license); err != nil {
		t.Fatal(err)
	}
	run("partial-cache")
	original[0] ^= 1 // restore the original pinned notice bytes
	if err := os.WriteFile(license, original, 0600); err != nil {
		t.Fatal(err)
	}
	run("remove-legacy")
	run("missing")
}

func TestLiteCompanionChild(t *testing.T) {
	mode := os.Getenv("PROTOPEEK_LITE_TEST_CHILD")
	if mode == "" {
		return
	}
	path, err := Path()
	switch mode {
	case "missing":
		if !errors.Is(err, ErrCompanionMissing) || path != "" {
			t.Fatalf("missing: %q %v", path, err)
		}
	case "invalid":
		if !errors.Is(err, ErrCompanionInvalid) || path != "" {
			t.Fatalf("invalid: %q %v", path, err)
		}
	case "legacy":
		if err != nil || Inspect().CachedPath != path || Inspect().Included {
			t.Fatalf("legacy cache: %q %v %+v", path, err, Inspect())
		}
	case "remove-legacy":
		if err != nil || path == "" {
			t.Fatalf("verified legacy engine unavailable: %s %v", path, err)
		}
		if err := RemoveCached(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
			t.Fatalf("legacy cache remains: %v", err)
		}
	case "changed-cache":
		if !errors.Is(err, ErrCacheInvalid) || path != "" || !Inspect().Repairable {
			t.Fatalf("changed legacy cache: %q %v %+v", path, err, Inspect())
		}
	case "partial-cache":
		if !errors.Is(err, ErrCompanionMissing) || path != "" || !Inspect().Partial {
			t.Fatalf("partial legacy cache: %q %v %+v", path, err, Inspect())
		}
	case "valid":
		if err != nil || filepath.Base(path) != "aria2c.exe" {
			t.Fatalf("valid: %q %v", path, err)
		}
		binary, err := os.ReadFile(path)
		if err != nil || digest(binary) != windowsBinarySHA {
			t.Fatalf("extracted engine digest: %v", err)
		}
		for _, name := range []string{"COPYING", "AUTHORS", "README.mingw", "LICENSE.OpenSSL"} {
			if _, err := os.Stat(filepath.Join(filepath.Dir(path), name)); err != nil {
				t.Fatalf("notice %s: %v", name, err)
			}
		}
	case "repair":
		if !errors.Is(err, ErrCompanionInvalid) || !CanRepairManagedArchive() {
			t.Fatalf("repair unavailable: %v", err)
		}
		if err := QuarantineManagedArchive(); err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatalf("unknown child mode %q", mode)
	}
}
