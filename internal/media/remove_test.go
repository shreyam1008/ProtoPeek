package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/userroot"
)

func fixtureRemoval(t *testing.T) (string, Asset, string, []installedFile, assetNotices) {
	t.Helper()
	root := t.TempDir()
	a := Asset{Engine: "gallery-dl", Version: "fixture", SHA256: "fixture"}
	dir := filepath.Join(root, "tools", a.Engine, a.Version)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "gallery-dl.exe")
	notices := assetNotices{Engine: a.Engine, Version: a.Version, Distribution: "fixture", SourceURL: "https://example.test", Files: []noticeFile{{Name: "LICENSE", Size: 7, SHA256: "unused"}}}
	files := []installedFile{}
	for _, item := range []struct{ name, contents string }{{"gallery-dl.exe", "fixture binary"}, {"LICENSE", "license"}} {
		b := []byte(item.contents)
		h := sha256.Sum256(b)
		files = append(files, installedFile{Name: item.name, Size: int64(len(b)), SHA256: hex.EncodeToString(h[:])})
		if err := os.WriteFile(filepath.Join(dir, item.name), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	receipt := toolReceipt{SchemaVersion: 1, Asset: a, Notices: notices, Files: files}
	encoded, _ := json.Marshal(receipt)
	if err := os.WriteFile(path+".verified", encoded, 0600); err != nil {
		t.Fatal(err)
	}
	return root, a, path, files, notices
}

func TestRemoveVerifiedRejectsChangedAndUnexpectedFiles(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	extra := filepath.Join(filepath.Dir(path), "user-file")
	if err := os.WriteFile(extra, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("unexpected file: %v", err)
	}
	if err := os.Remove(extra); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture binarY"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("tampered file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), "LICENSE")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture binary"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("directory remains: %v", err)
	}
}

func TestInterruptedRemovalCanRetryOnlyPinnedRemainder(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	if err := os.Remove(path + ".verified"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := verifyPartialManagedAsset(root, a, path, files, notices); err != nil {
		t.Fatalf("verified remainder rejected: %v", err)
	}
	if err := verifyManagedAsset(root, a, path, files, notices); err == nil {
		t.Fatal("incomplete tool accepted for execution")
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); err != nil {
		t.Fatalf("retry removal: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("remainder left: %v", err)
	}
}

func TestReceiptOrderFromOlderInstallIsAccepted(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	reversed := append([]installedFile(nil), files...)
	reversed[0], reversed[1] = reversed[1], reversed[0]
	body, err := json.Marshal(toolReceipt{SchemaVersion: 1, Asset: a, Notices: notices, Files: reversed})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".verified", body, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyManagedAsset(root, a, path, files, notices); err != nil {
		t.Fatalf("equivalent prior receipt rejected: %v", err)
	}
}

func TestInterruptedInstallRejectsUnknownOrChangedRemainder(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	if err := os.Remove(path + ".verified"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture binarY"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyPartialManagedAsset(root, a, path, files, notices); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("changed remainder accepted: %v", err)
	}
	if err := os.WriteFile(path, []byte("fixture binary"), 0600); err != nil {
		t.Fatal(err)
	}
	extra := filepath.Join(filepath.Dir(path), "unknown")
	if err := os.WriteFile(extra, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("unknown file accepted: %v", err)
	}
	if b, err := os.ReadFile(extra); err != nil || string(b) != "preserve" {
		t.Fatalf("unknown file changed: %q %v", b, err)
	}
}

func TestLegacyInterruptedStagingIsPreservedDuringRepair(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	if err := os.Remove(path + ".verified"); err != nil {
		t.Fatal(err)
	}
	stage := filepath.Join(filepath.Dir(path), ".install-legacy")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "unverified"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); err != nil {
		t.Fatal(err)
	}
	preserved, err := filepath.Glob(filepath.Join(filepath.Dir(filepath.Dir(path)), ".preserved-install-*"))
	if err != nil || len(preserved) != 1 {
		t.Fatalf("preserved stage: %v %v", preserved, err)
	}
	if b, err := os.ReadFile(filepath.Join(preserved[0], "unverified")); err != nil || string(b) != "keep" {
		t.Fatalf("stage contents changed: %q %v", b, err)
	}
}

func TestRemoveRejectsSymlinkAndBusyJobs(t *testing.T) {
	root, a, path, files, notices := fixtureRemoval(t)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(external, []byte("fixture binary"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, path); err != nil {
		t.Skipf("host cannot create symlinks: %v", err)
	}
	if err := removeVerifiedAsset(root, a, path, files, notices); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("symlink accepted: %v", err)
	}
	if _, err := os.Stat(external); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &Service{root: root, ctx: ctx, jobs: []*Job{{ID: "one", Request: Request{Engine: "yt-dlp"}, Status: "queued"}}, cancels: map[string]context.CancelFunc{}}
	for _, name := range []string{"yt-dlp", "deno", "ffmpeg"} {
		if err := s.Remove(name); !errors.Is(err, ErrRemoveBusy) {
			t.Errorf("%s busy: %v", name, err)
		}
	}
}

func TestAllManagedAssetsHaveRemovalPins(t *testing.T) {
	var assets []Asset
	if err := json.Unmarshal(toolManifest, &assets); err != nil {
		t.Fatal(err)
	}
	for _, asset := range assets {
		name := asset.Engine
		if len(asset.Platform) >= 7 && asset.Platform[:7] == "windows" {
			name += ".exe"
		}
		if _, ok := removalFiles(asset, name); !ok {
			t.Errorf("missing removal pin for %s %s", asset.Engine, asset.Platform)
		}
	}
}

func TestInstallRejectsExistingFileAndSymlinkBeforeNetwork(t *testing.T) {
	root := t.TempDir()
	notices, err := noticesFor(Asset{Engine: "deno", Version: "v2.9.6"})
	if err != nil {
		t.Fatal(err)
	}
	asset := Asset{Engine: "deno", Version: "v2.9.6", URL: "https://example.invalid", Size: 1, SHA256: "unused"}
	called := false
	client := &http.Client{Transport: mediaRoundTrip(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, errors.New("unexpected network")
	})}
	dir := filepath.Join(root, "owned")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "deno.exe")
	if err := os.WriteFile(path, []byte("user data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := installVerifiedAsset(context.Background(), asset, notices, path, client); err == nil {
		t.Fatal("existing file overwritten")
	}
	b, err := os.ReadFile(path)
	if err != nil || string(b) != "user data" || called {
		t.Fatalf("changed file or requested network: %q %v %t", b, err, called)
	}
	link := filepath.Join(root, "linked")
	if err := os.Symlink(dir, link); err != nil {
		t.Skipf("host cannot create symlinks: %v", err)
	}
	if err := installVerifiedAsset(context.Background(), asset, notices, filepath.Join(link, "new", "deno.exe"), client); err == nil {
		t.Fatal("followed a directory symlink")
	}
	if _, err := os.Stat(filepath.Join(dir, "new")); !os.IsNotExist(err) || called {
		t.Fatalf("created files outside safe tree: %v", err)
	}
}

func TestMediaAcceptsOSConfigAliasButRejectsAppOwnedSymlink(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "actual")
	if err := os.Mkdir(real, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(base, "config-alias")
	if err := os.Symlink(real, alias); err != nil {
		t.Skipf("host cannot create symlinks: %v", err)
	}
	t.Setenv("APPDATA", alias)
	t.Setenv("XDG_CONFIG_HOME", alias)
	t.Setenv("HOME", alias)
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := userroot.Resolve(config)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New()
	if err != nil {
		t.Fatalf("OS config alias rejected: %v", err)
	}
	s.Close()
	if _, err := os.Stat(filepath.Join(resolved, "protopeek", "media")); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(base, "second-config")
	if err := os.Mkdir(other, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APPDATA", other)
	t.Setenv("XDG_CONFIG_HOME", other)
	t.Setenv("HOME", other)
	config, err = os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(config, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, filepath.Join(config, "protopeek")); err != nil {
		t.Fatal(err)
	}
	if s, err := New(); err == nil {
		s.Close()
		t.Fatal("app-owned symlink accepted")
	}
}

func TestResolveRejectsChangedManagedBinaryEvenWhenReceiptLooksReady(t *testing.T) {
	a, ok := assetFor("gallery-dl")
	if !ok {
		t.Skip("no managed gallery-dl for this platform")
	}
	root := t.TempDir()
	s := &Service{root: root}
	path := s.assetPath(a)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	files, ok := removalFiles(a, filepath.Base(path))
	if !ok {
		t.Fatal("missing pins")
	}
	notices, err := noticesFor(a)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range files {
		f, err := os.Create(filepath.Join(filepath.Dir(path), item.Name))
		if err != nil {
			t.Fatal(err)
		}
		if err := f.Truncate(item.Size); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := json.Marshal(toolReceipt{SchemaVersion: 1, Asset: a, Notices: notices, Files: files})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".verified", receipt, 0600); err != nil {
		t.Fatal(err)
	}
	if !managedAssetReady(a, path) {
		t.Fatal("fixture must pass the old receipt/size readiness check")
	}
	if _, err := s.selectedTool("gallery-dl"); err == nil {
		t.Fatal("unverified managed binary selected")
	}
}
