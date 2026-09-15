package media

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testService(t *testing.T) *Service {
	t.Helper()
	s, err := NewAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}
func awaitJob(t *testing.T, s *Service, id string, status string) Job {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, j := range s.Snapshot().Jobs {
			if j.ID == id {
				if j.Status == status {
					return j
				}
				if j.Status == "failed" {
					t.Fatalf("job failed: %s", j.Message)
				}
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job did not become %s: %+v", status, s.Snapshot().Jobs)
	return Job{}
}

func TestNativeInspectAndDownload(t *testing.T) {
	s := testService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/page" {
			w.Header().Set("Content-Type", "text/html")
			io.WriteString(w, `<title>Example gallery</title><img src="/one.png"><img src="/one.png"><video src="/two.mp4"></video><img src="file:///private">`)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		io.WriteString(w, "image-content")
	}))
	defer server.Close()
	p, err := s.Inspect(t.Context(), server.URL+"/page")
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "Example gallery" || len(p.Items) != 2 {
		t.Fatalf("unexpected preview: %+v", p)
	}
	j, err := s.Add(Request{URL: server.URL + "/page", Engine: "native-go", Format: "images", Directory: t.TempDir(), Start: 1, End: 100})
	if err != nil {
		t.Fatal(err)
	}
	done := awaitJob(t, s, j.ID, "completed")
	data, err := os.ReadFile(filepath.Join(done.Directory, "001.png"))
	if err != nil || string(data) != "image-content" {
		t.Fatalf("wrong file: %q %v", data, err)
	}
	if done.Files != 1 {
		t.Fatalf("wrong saved count: %+v", done)
	}
	if err := s.Action(j.ID, "forget"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(done.Directory, "001.png")); err != nil {
		t.Fatal("forget removed saved file", err)
	}
}

func TestCancelNativeTransferAndRetry(t *testing.T) {
	s := testService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	j, err := s.Add(Request{URL: server.URL, Engine: "native-go", Format: "video", Directory: t.TempDir(), Start: 1, End: 1})
	if err != nil {
		t.Fatal(err)
	}
	awaitJob(t, s, j.ID, "downloading")
	if err := s.Action(j.ID, "cancel"); err != nil {
		t.Fatal(err)
	}
	awaitJob(t, s, j.ID, "cancelled")
}

func TestRequestRejectsBadInput(t *testing.T) {
	r := Request{URL: "https://example.org/media", Engine: "native-go", Format: "auto", Directory: t.TempDir(), Start: 1, End: 1}
	for _, raw := range []string{"file:///etc/passwd", "https://user:pass@example.org/a", "--exec=bad", "http://example.org/\n"} {
		copy := r
		copy.URL = raw
		// Whitespace surrounding a URL is intentionally accepted.
		if strings.HasSuffix(raw, "\n") {
			copy.URL = "http://example.org/a\nb"
		}
		if validateRequest(&copy) == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	r.End = 101
	if validateRequest(&r) == nil {
		t.Error("accepted unbounded selection")
	}
}

func TestManifestAndChecksum(t *testing.T) {
	var assets []Asset
	if err := json.Unmarshal(toolManifest, &assets); err != nil {
		t.Fatal(err)
	}
	for _, a := range assets {
		if !strings.HasPrefix(a.URL, "https://") || len(a.SHA256) != 64 || a.Size <= 0 || a.Version == "latest" {
			t.Fatalf("unpinned asset: %+v", a)
		}
	}
	data := []byte("verified payload")
	sum := sha256.Sum256(data)
	a := Asset{Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:])}
	if err := verifyCopy(io.Discard, bytes.NewReader(data), a); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{[]byte("tampered payload"), append(data, 'x'), data[:3]} {
		if verifyCopy(io.Discard, bytes.NewReader(bad), a) == nil {
			t.Error("accepted corrupt installation")
		}
	}
}

func TestZipExtractionIgnoresUnrelatedPaths(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "tool.zip")
	f, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	for name, data := range map[string]string{"bin/deno": "binary", "../../escape": "bad"} {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, data)
	}
	z.Close()
	f.Close()
	dest := filepath.Join(root, "deno")
	if err := installZip(t.Context(), source, dest, "deno"); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(dest); err != nil || string(data) != "binary" {
		t.Fatal("binary not extracted", err)
	}
	if _, err := os.Stat(filepath.Join(root, "escape")); err == nil {
		t.Error("unexpected file extracted")
	}
}

func TestProgressPhases(t *testing.T) {
	s := testService(t)
	s.mu.Lock()
	s.jobs = []*Job{{ID: "test", Status: "downloading"}}
	s.mu.Unlock()
	s.progress("test", `PP_PROGRESS:{"status":"downloading","downloaded_bytes":100,"total_bytes":200,"speed":10,"eta":10}`)
	j := s.Snapshot().Jobs[0]
	if j.Bytes != 100 || j.Total != 200 || j.Status != "downloading" {
		t.Fatalf("wrong progress: %+v", j)
	}
	s.progress("test", `PP_PROGRESS:{"status":"finished","downloaded_bytes":200,"total_bytes":200}`)
	if s.Snapshot().Jobs[0].Status != "processing" {
		t.Error("merge marked as complete")
	}
}

func TestProcessCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestSleepingHelper$")
	cmd.Env = append(os.Environ(), "PP_SLEEP_HELPER=1")
	configureProcess(cmd)
	start := time.Now()
	if err := cmd.Run(); err == nil {
		t.Fatal("cancelled process succeeded")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("cancellation was not prompt")
	}
}

func TestSleepingHelper(t *testing.T) {
	if os.Getenv("PP_SLEEP_HELPER") == "1" {
		time.Sleep(time.Minute)
		os.Exit(0)
	}
}

func TestInterruptedHistory(t *testing.T) {
	root := t.TempDir()
	data := `[{"id":"interrupted","status":"downloading"}]`
	os.WriteFile(filepath.Join(root, "jobs.json"), []byte(data), 0600)
	s, err := NewAt(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Snapshot().Jobs[0].Status != "cancelled" {
		t.Error("unexpected automatic resume")
	}
}
