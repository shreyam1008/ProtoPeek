package bundledaria2

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func fixtureBundle(t *testing.T) bundle {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, name := range []string{"aria2c", "COPYING", "AUTHORS", "README.mingw", "LICENSE.OpenSSL"} {
		file, err := writer.Create("fixture/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return bundle{archive: output.Bytes(), archiveSHA: digest(output.Bytes()), binarySHA: digest([]byte("aria2c")), prefix: "fixture/", binary: "aria2c"}
}

func TestExtractionVerifiesCacheAndIncludesNotices(t *testing.T) {
	t.Parallel()
	fixture := fixtureBundle(t)
	dir := t.TempDir()
	path, err := extract(fixture, dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"COPYING", "AUTHORS", "README.mingw", "LICENSE.OpenSSL", "aria2c"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	if reused, err := extract(fixture, dir); err != nil || reused != path {
		t.Fatalf("reuse = %q %v", reused, err)
	}
	// Same-length tampering must fail; size alone is not evidence of integrity.
	if err := os.WriteFile(path, []byte("xxxxxx"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := extract(fixture, dir); err == nil {
		t.Fatal("tampered cache accepted")
	}
}

func TestExtractionRejectsInvalidPayloadBeforeExposingExecutable(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"archive", "binary", "missing"} {
		t.Run(kind, func(t *testing.T) {
			payload := fixtureBundle(t)
			switch kind {
			case "archive":
				payload.archiveSHA = "invalid"
			case "binary":
				payload.binarySHA = "invalid"
			case "missing":
				payload.prefix = "absent/"
			}
			dir := t.TempDir()
			if _, err := extract(payload, dir); err == nil {
				t.Fatal("invalid bundle accepted")
			}
			if _, err := os.Stat(filepath.Join(dir, "aria2c")); !os.IsNotExist(err) {
				t.Fatalf("executable exposed: %v", err)
			}
		})
	}
}

func TestNativeBundleIntegrity(t *testing.T) {
	if len(nativeBundle.archive) == 0 {
		t.Skip("this platform has no bundled engine")
	}
	path, err := extract(nativeBundle, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != nativeBundle.binary {
		t.Fatal(path)
	}
}
