package managedtools

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func archiveFixture(t *testing.T, entries []tar.Header, body []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for i := range entries {
		h := entries[i]
		if err := tw.WriteHeader(&h); err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeReg && h.Size > 0 {
			if _, err := tw.Write(body[:h.Size]); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestArchiveInstallVerifiesAndRemovesExecutable(t *testing.T) {
	payload := []byte("safe fixture binary")
	raw := archiveFixture(t, []tar.Header{{Name: "cloudflared", Mode: 0700, Typeflag: tar.TypeReg, Size: int64(len(payload))}}, payload)
	m, a, _ := fixtureManager(t, raw, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) }))
	hash := sha256.Sum256(payload)
	a.archive = true
	a.binarySize = int64(len(payload))
	a.binarySHA = hex.EncodeToString(hash[:])
	m.assets = []asset{a}
	got, err := m.Install(context.Background(), "cloudflared")
	if err != nil || got.Status != "installed" {
		t.Fatalf("install: %+v %v", got, err)
	}
	data, err := os.ReadFile(m.binary(a))
	if err != nil || !bytes.Equal(data, payload) {
		t.Fatalf("binary: %q %v", data, err)
	}
	if _, err = m.Remove("cloudflared"); err != nil {
		t.Fatal(err)
	}
}

func TestArchiveRejectsUnsafeOrUnexpectedEntries(t *testing.T) {
	payload := []byte("safe fixture binary")
	h := sha256.Sum256(payload)
	a := asset{binarySize: int64(len(payload)), binarySHA: hex.EncodeToString(h[:])}
	valid := tar.Header{Name: "cloudflared", Mode: 0700, Typeflag: tar.TypeReg, Size: int64(len(payload))}
	for _, tc := range []struct {
		name     string
		entries  []tar.Header
		mismatch bool
	}{
		{"traversal", []tar.Header{{Name: "../cloudflared", Mode: 0700, Typeflag: tar.TypeReg, Size: int64(len(payload))}}, false},
		{"link", []tar.Header{{Name: "cloudflared", Typeflag: tar.TypeSymlink, Linkname: "outside"}}, false},
		{"duplicate", []tar.Header{valid, valid}, false},
		{"unexpected entry", []tar.Header{valid, {Name: "extra", Typeflag: tar.TypeReg}}, false},
		{"wrong digest", []tar.Header{valid}, true},
		{"wrong size", []tar.Header{{Name: "cloudflared", Mode: 0700, Typeflag: tar.TypeReg, Size: 1}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			raw := archiveFixture(t, tc.entries, payload)
			source := filepath.Join(dir, "source.tgz")
			if err := os.WriteFile(source, raw, 0600); err != nil {
				t.Fatal(err)
			}
			pin := a
			if tc.mismatch {
				pin.binarySHA = strings.Repeat("0", 64)
			}
			if _, err := extractArchive(context.Background(), source, dir, pin); !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected invalid archive: %v", err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 1 || entries[0].Name() != "source.tgz" {
				t.Fatalf("left extraction files: %v %v", entries, err)
			}
		})
	}
}

func TestArchiveRejectsCorruptGzipAndCancelledExtraction(t *testing.T) {
	payload := []byte("safe fixture binary")
	hash := sha256.Sum256(payload)
	a := asset{binarySize: int64(len(payload)), binarySHA: hex.EncodeToString(hash[:])}
	raw := archiveFixture(t, []tar.Header{{Name: "cloudflared", Mode: 0700, Typeflag: tar.TypeReg, Size: int64(len(payload))}}, payload)
	dir := t.TempDir()
	source := filepath.Join(dir, "source.tgz")
	broken := append([]byte(nil), raw...)
	broken[len(broken)-1] ^= 0xff
	if err := os.WriteFile(source, broken, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := extractArchive(context.Background(), source, dir, a); err == nil {
		t.Fatal("accepted corrupt gzip trailer")
	}
	if err := os.WriteFile(source, raw, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := extractArchive(ctx, source, dir, a); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled extraction: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "source.tgz" {
		t.Fatalf("left extraction files: %v %v", entries, err)
	}
}

// Optional local evidence for downloaded vendor assets. Native macOS CI checks
// the same pins through the public lifecycle and executes the binary.
func TestDownloadedMacArchivesMatchPins(t *testing.T) {
	root := os.Getenv("PROTOPEEK_MACOS_ASSETS")
	if root == "" {
		t.Skip("vendor asset evidence not provided")
	}
	for _, a := range cloudflareAssets {
		if !strings.HasPrefix(a.platform, "darwin/") {
			continue
		}
		t.Run(a.platform, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, filepath.Base(a.url)))
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(raw)
			if int64(len(raw)) != a.size || hex.EncodeToString(hash[:]) != a.sha {
				t.Fatal("archive pin mismatch")
			}
			dir := t.TempDir()
			source := filepath.Join(dir, "asset.tgz")
			if err = os.WriteFile(source, raw, 0600); err != nil {
				t.Fatal(err)
			}
			binary, err := extractArchive(context.Background(), source, dir, a)
			if err != nil {
				t.Fatal(err)
			}
			extracted, err := os.ReadFile(binary)
			if err != nil {
				t.Fatal(err)
			}
			binaryHash := sha256.Sum256(extracted)
			if int64(len(extracted)) != a.binarySize || hex.EncodeToString(binaryHash[:]) != a.binarySHA {
				t.Fatal("extracted executable pin mismatch")
			}
		})
	}
}
