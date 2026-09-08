package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func archiveFixture(t *testing.T, goos string, files map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	if goos == "windows" {
		w := zip.NewWriter(&b)
		for name, data := range files {
			f, err := w.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = f.Write([]byte(data))
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
	} else {
		gz := gzip.NewWriter(&b)
		w := tar.NewWriter(gz)
		for name, data := range files {
			if err := w.WriteHeader(&tar.Header{Name: name, Size: int64(len(data)), Mode: 0755}); err != nil {
				t.Fatal(err)
			}
			_, _ = w.Write([]byte(data))
		}
		_ = w.Close()
		_ = gz.Close()
	}
	return b.Bytes()
}
func fakeValidate(p, revision string) error {
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	if strings.Contains(string(b), "unrelated") {
		return errors.New("not ProtoPeek")
	}
	return nil
}
func engineFixture(t *testing.T, goos string, badChecksum bool) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	suffix := ""
	osname := goos
	ext := ".tar.gz"
	if goos == "windows" {
		suffix = ".exe"
		ext = ".zip"
	}
	if goos == "darwin" {
		osname = "osx"
	}
	for _, name := range []string{"protopeek", "pp"} {
		if err := os.WriteFile(filepath.Join(dir, name+suffix), []byte("old-"+name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	archive := archiveFixture(t, goos, map[string]string{"protopeek" + suffix: "new-protopeek", "pp" + suffix: "new-pp", "../../outside": "do not extract"})
	name := "protopeek_0.7.0_" + osname + "_x86_64" + ext
	digest := sha256.Sum256(archive)
	sum := hex.EncodeToString(digest[:])
	if badChecksum {
		sum = strings.Repeat("0", 64)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v0.7.0", "assets": []map[string]any{{"name": name, "size": len(archive)}, {"name": "checksums.txt", "size": 100}}})
		case "/v0.7.0/checksums.txt":
			fmt.Fprintf(w, "%s  %s\n", sum, name)
		case "/v0.7.0/" + name:
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	e := New("v0.6.1")
	e.api = srv.URL
	e.downloads = srv.URL
	e.client = srv.Client()
	e.validate = fakeValidate
	e.inspect = func() Installation {
		return Installation{Version: "v0.6.1", Channel: "stable", OS: goos, Arch: "amd64", Executable: filepath.Join(dir, "protopeek"+suffix), Manager: "direct", CanUpdate: true}
	}
	return e, dir
}
func TestVerifiedUpdateOnArchivePlatforms(t *testing.T) {
	for _, goos := range []string{"windows", "darwin", "linux"} {
		t.Run(goos, func(t *testing.T) {
			e, dir := engineFixture(t, goos, false)
			p, err := e.Check(context.Background(), "")
			if err != nil {
				t.Fatal(err)
			}
			if !p.Available {
				t.Fatal("expected update")
			}
			if err = e.Apply(context.Background(), p.ID); err != nil {
				t.Fatal(err)
			}
			suffix := ""
			if goos == "windows" {
				suffix = ".exe"
			}
			for _, name := range []string{"protopeek", "pp"} {
				b, err := os.ReadFile(filepath.Join(dir, name+suffix))
				if err != nil || string(b) != "new-"+name {
					t.Fatalf("%s: %q %v", name, b, err)
				}
			}
			if !e.Snapshot().RestartRequired {
				t.Fatal("restart must be explicit")
			}
			if _, err = os.Stat(filepath.Join(dir, "outside")); !os.IsNotExist(err) {
				t.Fatal("unexpected extracted file")
			}
			if _, err = e.Check(context.Background(), ""); err == nil {
				t.Fatal("old process must not update again")
			}
		})
	}
}
func TestUpdateFailuresPreserveInstallation(t *testing.T) {
	for _, mode := range []string{"checksum", "cancel", "stale", "wrong-plan", "unrelated-alias", "locked"} {
		t.Run(mode, func(t *testing.T) {
			e, dir := engineFixture(t, "windows", mode == "checksum")
			p, err := e.Check(context.Background(), "")
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			id := p.ID
			switch mode {
			case "cancel":
				cancel()
			case "stale":
				_ = os.WriteFile(filepath.Join(dir, "protopeek.exe"), []byte("changed"), 0755)
			case "wrong-plan":
				id = "not-the-plan"
			case "unrelated-alias":
				_ = os.WriteFile(filepath.Join(dir, "pp.exe"), []byte("unrelated"), 0755)
			case "locked":
				unlock, e := lockInstall(filepath.Join(dir, ".protopeek-update.lock"))
				if e != nil {
					t.Fatal(e)
				}
				defer unlock()
			}
			err = e.Apply(ctx, id)
			if mode == "unrelated-alias" {
				if err != nil {
					t.Fatal(err)
				}
				b, _ := os.ReadFile(filepath.Join(dir, "pp.exe"))
				if string(b) != "unrelated" {
					t.Fatal("overwrote unrelated alias")
				}
				return
			}
			if err == nil {
				t.Fatal("expected failure")
			}
			b, _ := os.ReadFile(filepath.Join(dir, "protopeek.exe"))
			expected := "old-protopeek"
			if mode == "stale" {
				expected = "changed"
			}
			if string(b) != expected {
				t.Fatalf("changed original: %q", b)
			}
		})
	}
}
func TestRollbackRestoresBothCommands(t *testing.T) {
	dir, stage := t.TempDir(), t.TempDir()
	for _, name := range []string{"protopeek", "pp"} {
		_ = os.WriteFile(filepath.Join(dir, name), []byte("old-"+name), 0755)
	}
	_ = os.WriteFile(filepath.Join(stage, "protopeek"), []byte("new"), 0755)
	// Missing second staged executable forces failure after the first replacement.
	_, _, err := installPair(dir, stage, "", fakeValidate)
	if err == nil {
		t.Fatal("expected rollback")
	}
	for _, name := range []string{"protopeek", "pp"} {
		b, _ := os.ReadFile(filepath.Join(dir, name))
		if string(b) != "old-"+name {
			t.Fatalf("rollback lost %s: %q", name, b)
		}
	}
}
func TestManagedPathsAndVersionOrdering(t *testing.T) {
	for p, want := range map[string]string{"/opt/homebrew/Cellar/protopeek/0.6.1/bin/pp": "Homebrew", "C:/Users/name/scoop/apps/protopeek/current/pp.exe": "Scoop", "/nix/store/hash/bin/pp": "Nix", "/snap/protopeek/current/pp": "Snap"} {
		got, _ := managedInstallation(p, "windows")
		if got != want {
			t.Fatalf("%s: %s", p, got)
		}
	}
	for _, tt := range []struct {
		a, b string
		want bool
	}{{"v0.7.0", "v0.6.1", true}, {"v0.6.1", "v0.6.1", false}, {"v0.6.1", "v0.7.0", false}, {"v1.10.0", "v1.9.0", true}} {
		if newer(tt.a, tt.b) != tt.want {
			t.Fatal(tt)
		}
	}
	if _, err := checksum([]byte("abc file\n"), "file"); err == nil {
		t.Fatal("invalid checksum accepted")
	}
	if _, err := checksum([]byte(strings.Repeat("0", 64)+" file\n"+strings.Repeat("0", 64)+" file\n"), "file"); err == nil {
		t.Fatal("duplicate checksum accepted")
	}
}

func TestCancellationWhileDownloadingPreservesFiles(t *testing.T) {
	e, dir := engineFixture(t, "windows", false)
	p, err := e.Check(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "checksums.txt") {
			fmt.Fprintf(w, "%s  %s\n", strings.Repeat("0", 64), p.Archive)
			return
		}
		_, _ = w.Write([]byte("x"))
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer srv.Close()
	e.downloads = srv.URL
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- e.Apply(ctx, p.ID) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("download did not start")
	}
	cancel()
	select {
	case err = <-done:
		if err == nil {
			t.Fatal("expected cancellation")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not stop download")
	}
	b, _ := os.ReadFile(filepath.Join(dir, "protopeek.exe"))
	if string(b) != "old-protopeek" {
		t.Fatal("cancel changed installation")
	}
}

func TestPreviewChecksCompareSourceRevision(t *testing.T) {
	for _, channel := range []string{"edge", "nightly"} {
		t.Run(channel, func(t *testing.T) {
			e, _ := engineFixture(t, "windows", false)
			oldInspect := e.inspect
			e.inspect = func() Installation {
				i := oldInspect()
				i.Version = "v0.0.0-" + channel
				i.Channel = channel
				i.Revision = strings.Repeat("a", 40)
				return i
			}
			revision := strings.Repeat("b", 40)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/git/ref/") {
					fmt.Fprintf(w, `{"object":{"type":"commit","sha":%q}}`, revision)
					return
				}
				fmt.Fprintf(w, `{"tag_name":"v0.0.0-%s","prerelease":true,"assets":[{"name":"protopeek_0.0.0-%s_windows_x86_64.zip","size":100},{"name":"checksums.txt","size":100}]}`, channel, channel)
			}))
			defer srv.Close()
			e.api = srv.URL
			p, err := e.Check(context.Background(), "")
			if err != nil || !p.Available || p.Channel != channel {
				t.Fatalf("%+v %v", p, err)
			}
			revision = strings.Repeat("a", 40)
			p, err = e.Check(context.Background(), "")
			if err != nil || p.Available {
				t.Fatalf("same preview revision: %+v %v", p, err)
			}
			if _, err = e.Check(context.Background(), "stable"); err == nil {
				t.Fatal("stable accepted prerelease")
			}

		})
	}
}
func TestRunningExecutableReplacement(t *testing.T) {
	if os.Getenv("PROTOPEEK_UPDATE_TEST_CHILD") == "1" {
		p, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		dir := filepath.Dir(p)
		stage := filepath.Join(dir, "stage")
		suffix := ""
		if runtime.GOOS == "windows" {
			suffix = ".exe"
		}
		_, _, err = installPair(dir, stage, suffix, func(string, string) error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		return
	}
	dir := t.TempDir()
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	stage := filepath.Join(dir, "stage")
	if err = os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"protopeek", "pp"} {
		for _, where := range []string{dir, stage} {
			if err = os.WriteFile(filepath.Join(where, name+suffix), b, 0755); err != nil {
				t.Fatal(err)
			}
		}
	}
	c := exec.Command(filepath.Join(dir, "protopeek"+suffix), "-test.run=^TestRunningExecutableReplacement$")
	c.Env = append(os.Environ(), "PROTOPEEK_UPDATE_TEST_CHILD=1")
	if out, err := c.CombinedOutput(); err != nil {
		t.Fatalf("running replacement: %v\n%s", err, out)
	}
	for _, name := range []string{"protopeek", "pp"} {
		if _, err = os.Stat(filepath.Join(dir, name+suffix)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDefaultChannel(t *testing.T) {
	for version, want := range map[string]string{"v0.6.1": "stable", "v0.0.0-nightly": "nightly", "v0.0.0-edge": "edge"} {
		if got := defaultChannel(version); got != want {
			t.Fatalf("%s: %s, want %s", version, got, want)
		}
	}
}
