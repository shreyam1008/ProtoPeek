package safepromote

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenameNeverReplacesFileOrDirectory(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	target := filepath.Join(root, "target")
	if err := os.WriteFile(source, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Rename(source, target); err == nil {
		t.Fatal("replaced file")
	}
	if b, err := os.ReadFile(target); err != nil || string(b) != "keep" {
		t.Fatalf("target changed: %q %v", b, err)
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := Rename(source, target); err != nil {
		t.Fatal(err)
	}
	dirSource := filepath.Join(root, "dir-source")
	dirTarget := filepath.Join(root, "dir-target")
	if err := os.Mkdir(dirSource, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(dirTarget, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Rename(dirSource, dirTarget); err == nil {
		t.Fatal("replaced directory")
	}
	if _, err := os.Stat(dirTarget); err != nil {
		t.Fatal(err)
	}
}
