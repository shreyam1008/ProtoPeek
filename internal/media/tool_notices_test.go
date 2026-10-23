package media

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type mediaRoundTrip func(*http.Request) (*http.Response, error)

func (r mediaRoundTrip) RoundTrip(request *http.Request) (*http.Response, error) { return r(request) }

func fixtureDigest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func fixtureZip(t *testing.T, names []string, contents map[string][]byte) []byte {
	t.Helper()
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	for _, name := range names {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(contents[name]); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestEveryManagedAssetHasPinnedBoundedNotices(t *testing.T) {
	var assets []Asset
	if err := json.Unmarshal(toolManifest, &assets); err != nil {
		t.Fatal(err)
	}
	for _, asset := range assets {
		if _, err := noticesFor(asset); err != nil {
			t.Fatalf("%s %s %s: %v", asset.Engine, asset.Platform, asset.Version, err)
		}
	}
	var entries []assetNotices
	if err := json.Unmarshal(noticeManifest, &entries); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, entry := range entries {
		key := entry.Engine + "@" + entry.Version
		if seen[key] {
			t.Fatalf("duplicate notice source %s", key)
		}
		seen[key] = true
		if err := validateNotices(entry); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"..", "../escape", "folder\\escape", ".verified"} {
		entry := entries[0]
		entry.Files = append([]noticeFile(nil), entry.Files...)
		entry.Files[0].Name = name
		if validateNotices(entry) == nil {
			t.Fatalf("accepted unsafe notice filename %q", name)
		}
	}
}

func TestManagedInstallRetainsNoticeAndProvenanceBeforeReady(t *testing.T) {
	license, err := os.ReadFile(filepath.Join("testdata", "deno-LICENSE.txt"))
	if err != nil {
		t.Fatal(err)
	}
	notices, err := noticesFor(Asset{Engine: "deno", Version: "v2.9.6"})
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(license)) != notices.Files[0].Size || fixtureDigest(license) != notices.Files[0].SHA256 {
		t.Fatal("notice fixture differs from independently pinned upstream bytes")
	}
	for _, mode := range []string{"valid", "corrupt-notice", "oversized-notice", "missing-notice", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			binary := []byte("synthetic, never-executed executable")
			name := "deno"
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			payload := fixtureZip(t, []string{"bin/" + name}, map[string][]byte{"bin/" + name: binary})
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/package.zip" {
					w.Write(payload)
					return
				}
				switch mode {
				case "corrupt-notice":
					w.Write(bytes.Repeat([]byte{'x'}, len(license)))
				case "oversized-notice":
					w.Write(append(append([]byte(nil), license...), 'x'))
				case "missing-notice":
					http.NotFound(w, r)
				case "cancelled":
					cancel()
					<-r.Context().Done()
				default:
					w.Write(license)
				}
			}))
			defer server.Close()
			base, _ := url.Parse(server.URL)
			client := &http.Client{Transport: mediaRoundTrip(func(r *http.Request) (*http.Response, error) {
				copy := r.Clone(r.Context())
				copy.URL.Scheme, copy.URL.Host = base.Scheme, base.Host
				return http.DefaultTransport.RoundTrip(copy)
			})}
			asset := Asset{Engine: "deno", Platform: runtime.GOOS + "/" + runtime.GOARCH, Version: "v2.9.6", URL: server.URL + "/package.zip", Size: int64(len(payload)), SHA256: fixtureDigest(payload), Archive: "zip"}
			executable := filepath.Join(t.TempDir(), "version", name)
			err := installVerifiedAsset(ctx, asset, notices, executable, client)
			if mode != "valid" {
				if err == nil || managedAssetReady(asset, executable) {
					t.Fatalf("failed/cancelled install accepted: %v", err)
				}
				if _, err := os.Stat(executable); !os.IsNotExist(err) {
					t.Fatalf("unverified executable promoted: %v", err)
				}
				return
			}
			if err != nil || !managedAssetReady(asset, executable) {
				t.Fatalf("verified fixture not ready: %v", err)
			}
			retained, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "LICENSE.txt"))
			if err != nil || !bytes.Equal(retained, license) {
				t.Fatal("upstream notice discarded or changed", err)
			}
			var receipt toolReceipt
			data, _ := os.ReadFile(executable + ".verified")
			if json.Unmarshal(data, &receipt) != nil || receipt.Asset != asset || receipt.Notices.SourceURL != notices.SourceURL || len(receipt.Files) != 2 {
				t.Fatalf("missing exact package/source provenance: %s", data)
			}
			if err := os.Remove(filepath.Join(filepath.Dir(executable), "LICENSE.txt")); err != nil {
				t.Fatal(err)
			}
			if managedAssetReady(asset, executable) {
				t.Fatal("managed executable usable without retained notice")
			}
		})
	}
}

func TestArchiveInstallRequiresRetainedNoticesAndRejectsDuplicates(t *testing.T) {
	for _, mode := range []string{"valid", "missing-license", "duplicate-license", "corrupt-license"} {
		t.Run(mode, func(t *testing.T) {
			files := map[string][]byte{"bin/ffmpeg.exe": []byte("ffmpeg fixture"), "bin/ffprobe.exe": []byte("ffprobe fixture"), "LICENSE": []byte("fixture GPL license"), "README.txt": []byte("fixture build/source information")}
			notices := assetNotices{Engine: "ffmpeg", Version: "fixture", Distribution: "fixture distribution", SourceURL: "https://source.invalid/pinned"}
			for _, name := range []string{"LICENSE", "README.txt"} {
				notices.Files = append(notices.Files, noticeFile{Name: name, Archive: true, Size: int64(len(files[name])), SHA256: fixtureDigest(files[name])})
			}
			names := []string{"bin/ffmpeg.exe", "bin/ffprobe.exe", "README.txt"}
			if mode != "missing-license" {
				names = append(names, "LICENSE")
			}
			if mode == "duplicate-license" {
				names = append(names, "LICENSE")
			}
			if mode == "corrupt-license" {
				files["LICENSE"][0] = 'X'
			}
			payload := fixtureZip(t, names, files)
			client := &http.Client{Transport: mediaRoundTrip(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(payload))}, nil
			})}
			asset := Asset{Engine: "ffmpeg", Version: "fixture", URL: "https://fixture.invalid/ffmpeg.zip", Archive: "zip", Size: int64(len(payload)), SHA256: fixtureDigest(payload)}
			executable := filepath.Join(t.TempDir(), "version", "ffmpeg.exe")
			err := installVerifiedAsset(t.Context(), asset, notices, executable, client)
			if mode != "valid" {
				if err == nil {
					t.Fatal("invalid mandatory notice accepted")
				}
				if _, err := os.Stat(executable + ".verified"); !os.IsNotExist(err) {
					t.Fatalf("invalid archive marked verified: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"LICENSE", "README.txt"} {
				data, err := os.ReadFile(filepath.Join(filepath.Dir(executable), name))
				if err != nil || !bytes.Equal(data, files[name]) {
					t.Fatalf("archive notice not retained: %s %v", name, err)
				}
			}
		})
	}
}

func TestRetryRequiresMissingEngineToBeInstalled(t *testing.T) {
	s := testService(t)
	t.Setenv("PATH", t.TempDir())
	s.mu.Lock()
	s.jobs = []*Job{{ID: "missing", Status: "failed", Request: Request{Engine: "yt-dlp"}}}
	s.mu.Unlock()
	if err := s.Action("missing", "retry"); err == nil || !strings.Contains(err.Error(), "install yt-dlp") {
		t.Fatalf("unavailable engine retry did not fail usefully: %v", err)
	}
	if got := s.Snapshot().Jobs[0].Status; got != "failed" {
		t.Fatal(fmt.Sprintf("unavailable retry changed state to %s", got))
	}
}
