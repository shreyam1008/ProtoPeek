//go:build windows && amd64 && !protopeek_lite

package bundledaria2

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveCachedRequiresExactVerifiedFiles(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(path)
	extra := filepath.Join(dir, "user-file")
	if err := os.WriteFile(extra, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := RemoveCached(); err == nil {
		t.Fatal("removed a cache containing an unexpected file")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(extra); err != nil {
		t.Fatal(err)
	}
	license := filepath.Join(dir, "COPYING")
	original, err := os.ReadFile(license)
	if err != nil || len(original) == 0 {
		t.Fatalf("read license: %v", err)
	}
	modified := append([]byte(nil), original...)
	modified[0] ^= 1
	if err := os.WriteFile(license, modified, 0600); err != nil {
		t.Fatal(err)
	}
	if err := RemoveCached(); err == nil {
		t.Fatal("removed a cache containing a changed notice")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(license, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := RemoveCached(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("cache remains: %v", err)
	}
}

func TestRemoveCachedRetriesAfterInterruptionAndPreservesAbandonedBytes(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(path)
	for _, name := range []string{filepath.Base(path), "AUTHORS"} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	temp := filepath.Join(dir, ".extract-1729")
	if err := os.WriteFile(temp, []byte("preserve orphan"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := RemoveCached(); err != nil {
		t.Fatal(err)
	}
	left, err := os.ReadDir(dir)
	if err != nil || len(left) != 1 || left[0].Name() != filepath.Base(temp) {
		t.Fatalf("unexpected remainder %v: %v", left, err)
	}
	if data, err := os.ReadFile(temp); err != nil || string(data) != "preserve orphan" {
		t.Fatalf("changed abandoned file: %q, %v", data, err)
	}
}
