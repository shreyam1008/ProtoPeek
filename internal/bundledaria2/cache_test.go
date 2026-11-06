package bundledaria2

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Bind the offline upgrade manifest to the exact upstream archive. This also
// checks executable/notice pin maintenance on non-Windows build machines.
func TestOfflineCachePinsMatchSourceArchive(t *testing.T) {
	archive, err := os.ReadFile(filepath.Join("assets", strings.TrimPrefix(CompanionFilename, "protopeek-")))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive) != windowsArchiveSize || digest(archive) != windowsArchiveSHA {
		t.Fatal("release archive differs from its pin")
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	for _, pin := range windowsCacheMembers {
		data, err := reader.Open("aria2-1.37.0-win-64bit-build1/" + pin.name)
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(io.LimitReader(data, pin.size+1))
		data.Close()
		if err != nil || int64(len(content)) != pin.size || digest(content) != pin.sha {
			t.Fatalf("wrong pin for %s", pin.name)
		}
	}
}

func TestExplicitCacheQuarantinePreservesChangedCopy(t *testing.T) {
	if nativeBundle.binarySHA != windowsBinarySHA {
		t.Skip("Windows x64 managed engine")
	}
	cache := t.TempDir()
	t.Setenv("LOCALAPPDATA", cache)
	dir, err := cacheDirectory(cache, windowsBinarySHA, true)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "aria2c.exe")
	original := []byte("unverified executable")
	if err := os.WriteFile(target, original, 0600); err != nil {
		t.Fatal(err)
	}
	unknown := filepath.Join(dir, "unexpected.dll")
	if err := os.WriteFile(unknown, []byte("unknown"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := QuarantineChangedCache(); err == nil {
		t.Fatal("quarantined unknown files")
	}
	if err := os.Remove(unknown); err != nil {
		t.Fatal(err)
	}
	if err := QuarantineChangedCache(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("changed copy still active: %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(dir), ".aria2-cache-quarantine-*", "files", "aria2c.exe"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("retained files: %v %v", matches, err)
	}
	saved, err := os.ReadFile(matches[0])
	if err != nil || !bytes.Equal(saved, original) {
		t.Fatalf("changed copy lost: %v", err)
	}
}
