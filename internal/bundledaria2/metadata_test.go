package bundledaria2

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectBundleDoesNotExtractOrCreateCache(t *testing.T) {
	t.Parallel()
	cache := filepath.Join(t.TempDir(), "not-created")
	payload := fixtureBundle(t)
	got := inspectBundle(payload, cache)
	if !got.Included || got.ArchiveBytes != len(payload.archive) || got.CachedPath != "" || got.CacheError != "" {
		t.Fatalf("metadata = %#v", got)
	}
	if _, err := os.Stat(cache); !os.IsNotExist(err) {
		t.Fatalf("inspection created cache: %v", err)
	}
	if got := inspectBundle(bundle{}, cache); got != (Metadata{}) {
		t.Fatalf("empty bundle metadata = %#v", got)
	}
}

func TestInspectBundleVerifiesExistingCacheWithoutRepairingIt(t *testing.T) {
	t.Parallel()
	payload := fixtureBundle(t)
	cache := t.TempDir()
	dir := filepath.Join(cache, "protopeek", "engines", "aria2", payload.binarySHA)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, payload.binary)
	if err := os.WriteFile(target, []byte("aria2c"), 0o700); err != nil {
		t.Fatal(err)
	}
	got := inspectBundle(payload, cache)
	if got.CachedPath != target || got.CacheError != "" {
		t.Fatalf("valid cache metadata = %#v", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("inspection extracted extra files: %v %v", entries, err)
	}
	if err := os.WriteFile(target, []byte("xxxxxx"), 0o700); err != nil {
		t.Fatal(err)
	}
	got = inspectBundle(payload, cache)
	if got.CachedPath != "" || got.CacheError == "" || !got.Included {
		t.Fatalf("tampered cache accepted: %#v", got)
	}
	raw, err := os.ReadFile(target)
	if err != nil || string(raw) != "xxxxxx" {
		t.Fatalf("inspection repaired the cache: %q %v", raw, err)
	}
}

func TestInspectBundleRejectsNonRegularCache(t *testing.T) {
	t.Parallel()
	payload := fixtureBundle(t)
	cache := t.TempDir()
	target := filepath.Join(cache, "protopeek", "engines", "aria2", payload.binarySHA, payload.binary)
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if got := inspectBundle(payload, cache); got.CachedPath != "" || got.CacheError == "" {
		t.Fatalf("directory accepted as executable: %#v", got)
	}
}
