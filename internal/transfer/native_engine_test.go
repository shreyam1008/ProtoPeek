package transfer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
)

func nativeFixture(t *testing.T) (HostConfig, Paths) {
	t.Helper()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = filepath.Join(root, "downloads")
	config.MinimumFreeDiskBytes = 0
	state := filepath.Join(root, "state")
	paths := Paths{ConfigFile: filepath.Join(root, "config.json"), StateDirectory: state, SessionFile: filepath.Join(state, "session.aria2"), VerificationFile: filepath.Join(state, "verification.json"), LockFile: filepath.Join(state, "engine.lock")}
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatal(err)
	}
	return config, paths
}

func nativeTestURLHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func nativeService(t *testing.T, c HostConfig, p Paths) *Service {
	t.Helper()
	s, err := NewServiceWithDependencies(c, p, newNativeLauncher(), FileLocker{})
	if err != nil {
		t.Fatal(err)
	}
	if h, err := s.Start(context.Background()); err != nil || h.Engine != "native" {
		t.Fatalf("start: %#v, %v", h, err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})
	return s
}

type cancelAfterContextChecks struct {
	context.Context
	cancel context.CancelFunc
	checks atomic.Int32
	limit  int32
}

func (ctx *cancelAfterContextChecks) Err() error {
	if ctx.checks.Add(1) >= ctx.limit {
		ctx.cancel()
	}
	return ctx.Context.Err()
}

func TestNativeStartCancellationPreservesPromotionCheckpoint(t *testing.T) {
	c, p := nativeFixture(t)
	if err := os.MkdirAll(c.DownloadDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(p.StateDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("x"), 256<<10)
	sum := sha256.Sum256(payload)
	r := &nativeRecord{
		Request: AddRequest{Sources: []string{"https://example.test/file"}, OutputName: "file.bin", DestinationDirectory: c.DownloadDirectory},
		Job: Job{ID: "aabbccdd", Name: "file.bin", Directory: c.DownloadDirectory,
			OutputPath: filepath.Join(c.DownloadDirectory, "file.bin"), Status: JobDownloading},
		CommitSHA256: hex.EncodeToString(sum[:]),
	}
	part := nativePart(r)
	if err := os.WriteFile(part, payload, 0600); err != nil {
		t.Fatal(err)
	}
	e := &nativeEngine{path: filepath.Join(p.StateDirectory, "session.native.json"), state: nativeState{Version: 1, Jobs: []*nativeRecord{r}}}
	if err := e.saveLocked(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(e.path)
	if err != nil {
		t.Fatal(err)
	}
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &cancelAfterContextChecks{Context: base, cancel: cancel, limit: 6}
	if _, err := newNativeLauncher().Start(ctx, c, p); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation during recovery, got %v", err)
	}
	if got, err := os.ReadFile(part); err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("partial changed during canceled recovery: %v", err)
	}
	if _, err := os.Stat(r.Job.OutputPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("output unexpectedly promoted: %v", err)
	}
	if after, err := os.ReadFile(e.path); err != nil || !bytes.Equal(after, before) {
		t.Fatalf("checkpoint changed during canceled recovery: %v", err)
	}
}

func TestNativeManagedHeadersAreActionableInSingleAndBatchRequests(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	for _, name := range []string{"Range", "If-Range", "accept-encoding"} {
		request := AddRequest{Sources: []string{"https://example.test/file"}, Headers: []RequestHeader{{Name: name, Value: "private"}}}
		if _, err := s.Add(context.Background(), request); !errors.Is(err, ErrNativeManagedHeader) {
			t.Fatalf("%s: expected managed-header error, got %v", name, err)
		}
		result, err := s.AddBatch(context.Background(), BatchAddRequest{Jobs: []AddRequest{request}})
		if err != nil || result.QueuedCount != 0 || len(result.Results) != 1 || result.Results[0].FailureCode != BatchFailureManagedHeader {
			t.Fatalf("%s: batch result %#v, %v", name, result, err)
		}
	}
}

func waitNative(t *testing.T, s *Service, id string, want JobStatus) Job {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		snap, err := s.Snapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range snap.Jobs {
			if j.ID == id && j.Status == want {
				return j
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	snap, _ := s.Snapshot(context.Background())
	t.Fatalf("job %s did not become %s: %#v", id, want, snap.Jobs)
	return Job{}
}

func TestNativeDownloadChecksumAndHeader(t *testing.T) {
	body := []byte("native verified download")
	digest := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("ETag", "\"version-1\"")
		_, _ = w.Write(body)
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	result, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL + "/file?token=secret"}, OutputName: "file.bin", SHA256: hex.EncodeToString(digest[:]), Headers: []RequestHeader{{Name: "Authorization", Value: "Bearer secret"}}})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, result.ID, JobCompleted)
	if j.Verification != "verified" || j.ActualSHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("verification: %#v", j)
	}
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("output %q, %v", got, err)
	}
	state, err := os.ReadFile(filepath.Join(p.StateDirectory, "session.native.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(state, []byte("Bearer secret")) || bytes.Contains(state, []byte("token=secret")) {
		t.Fatal("completed native session retained request secrets")
	}
}

func TestNativeResumeAfterRestart(t *testing.T) {
	body := bytes.Repeat([]byte("0123456789abcdef"), 4096)
	var ranges atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", "\"stable\"")
		var start int
		if value := r.Header.Get("Range"); value != "" {
			if _, err := fmt.Sscanf(value, "bytes=%d-", &start); err != nil || r.Header.Get("If-Range") != "\"stable\"" {
				http.Error(w, "bad range", 400)
				return
			}
			ranges.Add(1)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(body)-1, len(body)))
			w.Header().Set("Content-Length", fmt.Sprint(len(body)-start))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(body[start:])
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		_, _ = w.Write(body[:8192])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL + "/large"}, OutputName: "large.bin"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		snap, _ := s.Snapshot(context.Background())
		if len(snap.Jobs) > 0 && snap.Jobs[0].CompletedBytes >= 8192 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("initial chunk did not arrive")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.Pause(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := s.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	cancel()
	s = nativeService(t, c, p)
	waitNative(t, s, add.ID, JobPaused)
	if err := s.Resume(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || !bytes.Equal(got, body) || ranges.Load() != 1 {
		t.Fatalf("resume: len=%d ranges=%d err=%v", len(got), ranges.Load(), err)
	}
}

func TestNativeRejectsUnsafeResumeAndPreservesPartial(t *testing.T) {
	for _, mode := range []string{"ignore-range", "changed-validator", "bad-range"} {
		t.Run(mode, func(t *testing.T) {
			body := bytes.Repeat([]byte("a"), 4096)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("ETag", "\"one\"")
				if mode == "ignore-range" {
					_, _ = w.Write(body)
					return
				}
				if mode == "changed-validator" {
					w.Header().Set("ETag", "\"two\"")
				}
				w.Header().Set("Content-Range", "bytes 0-9/4096")
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(body[:10])
			}))
			defer server.Close()
			c, p := nativeFixture(t)
			s := nativeService(t, c, p)
			e := s.runtime.Engine.(*nativeEngine)
			id := "aabbccdd"
			req := AddRequest{Sources: []string{server.URL}, OutputName: "partial.bin"}
			r := &nativeRecord{Request: req, Validator: "\"one\"", EffectiveURLSHA256: nativeTestURLHash(server.URL), Job: Job{ID: id, Name: req.OutputName, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, req.OutputName), Status: JobPaused}}
			if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(nativePart(r), body[:100], 0600); err != nil {
				t.Fatal(err)
			}
			e.mu.Lock()
			e.state.Jobs = append(e.state.Jobs, r)
			if err := e.saveLocked(); err != nil {
				e.mu.Unlock()
				t.Fatal(err)
			}
			e.mu.Unlock()
			if err := s.Resume(context.Background(), id); err != nil {
				t.Fatal(err)
			}
			waitNative(t, s, id, JobFailed)
			got, err := os.ReadFile(nativePart(r))
			if err != nil || !bytes.Equal(got, body[:100]) {
				t.Fatalf("partial changed: %d, %v", len(got), err)
			}
			if _, err := os.Stat(r.Job.OutputPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("unsafe result was promoted")
			}
		})
	}
}

func TestAdaptiveLauncherPreservesLegacySession(t *testing.T) {
	c, p := nativeFixture(t)
	if err := os.MkdirAll(p.StateDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.SessionFile, []byte("https://example.test/file\n"), 0600); err != nil {
		t.Fatal(err)
	}
	l := &adaptiveLauncher{aria: NewAria2Launcher()}
	l.aria.resolve = func(string) (string, error) { return "", ErrAria2NotFound }
	if _, err := l.Start(context.Background(), c, p); !errors.Is(err, ErrAria2NotFound) {
		t.Fatalf("legacy session hidden: %v", err)
	}
	got, err := os.ReadFile(p.SessionFile)
	if err != nil || !strings.Contains(string(got), "example.test") {
		t.Fatal("legacy session changed")
	}
}

func TestNativeChecksumMismatchPreservesPartial(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("wrong content")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	sum := sha256.Sum256([]byte("expected content"))
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "checked.bin", SHA256: hex.EncodeToString(sum[:])})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobFailed)
	if j.Verification != "failed" {
		t.Fatalf("verification: %#v", j)
	}
	if _, err := os.Stat(j.OutputPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("mismatched output was promoted")
	}
	if _, err := os.Stat(filepath.Join(j.Directory, ".protopeek-"+add.ID+".part")); err != nil {
		t.Fatalf("partial missing: %v", err)
	}
}

func TestNativeCancelPreservesPartial(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100000")
		_, _ = w.Write(bytes.Repeat([]byte("x"), 8192))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "cancel.bin"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		snap, _ := s.Snapshot(context.Background())
		if len(snap.Jobs) > 0 && snap.Jobs[0].CompletedBytes > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("initial bytes missing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.Cancel(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(c.DownloadDirectory, "cancel.bin")
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancelled output was promoted")
	}
	if info, err := os.Stat(filepath.Join(c.DownloadDirectory, ".protopeek-"+add.ID+".part")); err != nil || info.Size() == 0 {
		t.Fatalf("partial missing: %v", err)
	}
}

func TestNativePersistenceFailureBlocksCompletionSnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("complete"))
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	state := filepath.Join(p.StateDirectory, "session.native.json")
	backup := state + ".backup"
	e := s.runtime.Engine.(*nativeEngine)
	e.mu.Lock()
	e.promote = func(from, to string) error {
		if err := safepromote.Rename(from, to); err != nil {
			return err
		}
		if err := os.Rename(state, backup); err != nil {
			return err
		}
		return os.Mkdir(state, 0700)
	}
	e.mu.Unlock()
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "complete.bin"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		e.mu.Lock()
		record, _ := e.findLocked(add.ID)
		done := record != nil && record.Job.Status == JobCompleted
		e.mu.Unlock()
		if done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("download did not complete")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := s.Snapshot(context.Background()); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("expected persistence error, got %v", err)
	}
	if err := os.Remove(state); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, state); err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, add.ID, JobCompleted)
}

func TestNativePromotionCheckpointRecovery(t *testing.T) {
	for _, stage := range []string{"before-rename", "after-rename", "conflict"} {
		t.Run(stage, func(t *testing.T) {
			c, p := nativeFixture(t)
			if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(p.StateDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			body := []byte("complete content")
			sum := sha256.Sum256(body)
			r := &nativeRecord{Request: AddRequest{Sources: []string{"https://example.test/file?token=secret"}, OutputName: "file.bin", DestinationDirectory: c.DownloadDirectory, Headers: []RequestHeader{{Name: "Authorization", Value: "secret"}}}, Job: Job{ID: "aabbccdd", Name: "file.bin", Source: "https://example.test/file", Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "file.bin"), Status: JobDownloading}, CommitSHA256: hex.EncodeToString(sum[:])}
			if stage != "after-rename" {
				if err := os.WriteFile(nativePart(r), body, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if stage != "before-rename" {
				if err := os.WriteFile(r.Job.OutputPath, body, 0600); err != nil {
					t.Fatal(err)
				}
			}
			other := &nativeRecord{Request: AddRequest{Sources: []string{"https://example.test/other"}, OutputName: "other.bin", DestinationDirectory: c.DownloadDirectory}, Job: Job{ID: "bbccdd11", Name: "other.bin", Source: "https://example.test/other", Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "other.bin"), Status: JobPaused}}
			data, err := json.Marshal(nativeState{Version: 1, Jobs: []*nativeRecord{r, other}})
			if err != nil {
				t.Fatal(err)
			}
			state := filepath.Join(p.StateDirectory, "session.native.json")
			if err := os.WriteFile(state, data, 0600); err != nil {
				t.Fatal(err)
			}
			if stage == "conflict" {
				s := nativeService(t, c, p)
				failed := waitNative(t, s, r.Job.ID, JobFailed)
				waitNative(t, s, other.Job.ID, JobPaused)
				if !strings.Contains(failed.ErrorMessage, "destination already exists") {
					t.Fatal(failed.ErrorMessage)
				}
				part, partErr := os.ReadFile(nativePart(r))
				dest, destErr := os.ReadFile(r.Job.OutputPath)
				if partErr != nil || destErr != nil || !bytes.Equal(part, body) || !bytes.Equal(dest, body) {
					t.Fatal("conflicting files were not preserved")
				}
				return
			}
			s := nativeService(t, c, p)
			j := waitNative(t, s, r.Job.ID, JobCompleted)
			got, err := os.ReadFile(j.OutputPath)
			if err != nil || !bytes.Equal(got, body) {
				t.Fatalf("output %q, %v", got, err)
			}
			data, err = os.ReadFile(state)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(data, []byte("secret")) {
				t.Fatal("recovered session retained secrets")
			}
		})
	}
}

func TestAdaptiveLauncherDoesNotHideNativeQueue(t *testing.T) {
	c, p := nativeFixture(t)
	if err := os.MkdirAll(p.StateDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	record := &nativeRecord{Request: AddRequest{Sources: []string{"https://example.test/native"}, OutputName: "native.bin", DestinationDirectory: c.DownloadDirectory}, Job: Job{ID: "abc123", Name: "native.bin", Status: JobPaused, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "native.bin"), Source: "https://example.test/native"}}
	state, err := json.Marshal(nativeState{Version: 1, Jobs: []*nativeRecord{record}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(p.StateDirectory, "session.native.json"), state, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.SessionFile, []byte("https://example.test/file\n"), 0600); err != nil {
		t.Fatal(err)
	}
	l := &adaptiveLauncher{aria: NewAria2Launcher()}
	runtime, err := l.Start(context.Background(), c, p)
	if err != nil || runtime.EngineName != "native" || !strings.Contains(runtime.EngineNote, "aria2 queue is preserved") {
		t.Fatalf("native queue inaccessible: %#v %v", runtime, err)
	}
	if err := runtime.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(p.SessionFile); err != nil {
		t.Fatal(err)
	}
	c.Aria2Path = "explicit-aria2"
	if _, err := l.Start(context.Background(), c, p); !errors.Is(err, ErrNativeQueuePending) {
		t.Fatalf("explicit engine hid native queue: %v", err)
	}
}

func TestNativeResumeAcrossOriginRedirectDoesNotLeakHeaders(t *testing.T) {
	body := []byte("a verified payload served by a redirected CDN")
	var observed atomic.Bool
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Secret") != "" {
			t.Error("credential forwarded to redirect origin")
		}
		if r.Header.Get("Range") != "bytes=10-" || r.Header.Get("If-Range") != `"stable"` || r.Header.Get("Accept-Encoding") != "identity" {
			t.Errorf("unsafe range headers: %v", r.Header)
		}
		observed.Store(true)
		w.Header().Set("ETag", `"stable"`)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 10-%d/%d", len(body)-1, len(body)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[10:])
	}))
	defer cdn.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, cdn.URL, http.StatusFound) }))
	defer origin.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	r := &nativeRecord{Request: AddRequest{Sources: []string{origin.URL}, OutputName: "redirect.bin", DestinationDirectory: c.DownloadDirectory, Headers: []RequestHeader{{Name: "Authorization", Value: "Bearer private"}, {Name: "X-Secret", Value: "private"}}}, Validator: `"stable"`, EffectiveURLSHA256: nativeTestURLHash(cdn.URL), Job: Job{ID: "aabb0011", Name: "redirect.bin", Source: origin.URL, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "redirect.bin"), Status: JobPaused}}
	if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePart(r), body[:10], 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.state.Jobs = append(e.state.Jobs, r)
	err := e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Resume(context.Background(), r.Job.ID); err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, r.Job.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || !observed.Load() || !bytes.Equal(got, body) {
		t.Fatalf("redirected resume: %q, %v", got, err)
	}
}

func TestNativeRedirectReturningToOriginDoesNotLeakSignedReferer(t *testing.T) {
	var origin *httptest.Server
	finalReferer := make(chan string, 1)
	cdnAuthorization := make(chan string, 1)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdnAuthorization <- r.Header.Get("Authorization")
		http.Redirect(w, r, origin.URL+"/final", http.StatusFound)
	}))
	defer cdn.Close()
	origin = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, cdn.URL+"/asset?signature=private-token", http.StatusFound)
			return
		}
		finalReferer <- r.Header.Get("Referer")
		_, _ = w.Write([]byte("ok"))
	}))
	defer origin.Close()
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, origin.URL+"/start", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer private")
	response, err := newNativeHTTPClient(false, time.Second).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	auth, referer := <-cdnAuthorization, <-finalReferer
	if response.StatusCode != http.StatusOK || auth != "" || referer != "" {
		t.Fatalf("redirect leaked headers: status=%d cdn auth=%q final referer=%q", response.StatusCode, auth, referer)
	}
}

func TestNativeCompletePartialRecoversFrom416(t *testing.T) {
	body := []byte("fully written before crash")
	for _, valid := range []bool{true, false} {
		t.Run(fmt.Sprint(valid), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Range") != fmt.Sprintf("bytes=%d-", len(body)) || r.Header.Get("If-Range") != `"stable"` {
					t.Error("missing safe resume headers")
				}
				w.Header().Set("ETag", `"stable"`)
				size := len(body)
				if !valid {
					size++
				}
				w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				_, _ = w.Write([]byte("not file data"))
			}))
			defer server.Close()
			c, p := nativeFixture(t)
			s := nativeService(t, c, p)
			e := s.runtime.Engine.(*nativeEngine)
			r := &nativeRecord{Request: AddRequest{Sources: []string{server.URL}, OutputName: "done.bin", DestinationDirectory: c.DownloadDirectory}, Validator: `"stable"`, EffectiveURLSHA256: nativeTestURLHash(server.URL), Job: Job{ID: "aabb0022", Name: "done.bin", Source: server.URL, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "done.bin"), Status: JobPaused}}
			if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(nativePart(r), body, 0600); err != nil {
				t.Fatal(err)
			}
			e.mu.Lock()
			e.state.Jobs = append(e.state.Jobs, r)
			err := e.saveLocked()
			e.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if err := s.Resume(context.Background(), r.Job.ID); err != nil {
				t.Fatal(err)
			}
			if valid {
				j := waitNative(t, s, r.Job.ID, JobCompleted)
				got, err := os.ReadFile(j.OutputPath)
				if err != nil || !bytes.Equal(got, body) {
					t.Fatalf("recovered: %q %v", got, err)
				}
			} else {
				waitNative(t, s, r.Job.ID, JobFailed)
				got, err := os.ReadFile(nativePart(r))
				if err != nil || !bytes.Equal(got, body) {
					t.Fatal("invalid 416 modified partial")
				}
			}
		})
	}
}

func TestNativeUnsafeValidatorsDoNotPoisonRestart(t *testing.T) {
	for name, etag := range map[string]string{"last-modified-only": "", "oversized": `"` + strings.Repeat("a", 2048) + `"`, "weak": `W/"weak"`} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if etag != "" {
					w.Header().Set("ETag", etag)
				}
				w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
				w.Header().Set("Content-Length", "100000")
				_, _ = w.Write(bytes.Repeat([]byte("x"), 4096))
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer server.Close()
			c, p := nativeFixture(t)
			s := nativeService(t, c, p)
			add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "unsafe.bin"})
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(10 * time.Second)
			for {
				snap, err := s.Snapshot(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				if len(snap.Jobs) > 0 && snap.Jobs[0].CompletedBytes >= 4096 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("partial did not arrive")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err := s.Pause(context.Background(), add.ID); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err = s.Shutdown(ctx)
			cancel()
			if err != nil {
				t.Fatal(err)
			}
			s = nativeService(t, c, p)
			waitNative(t, s, add.ID, JobPaused)
			if err := s.Resume(context.Background(), add.ID); err != nil {
				t.Fatal(err)
			}
			j := waitNative(t, s, add.ID, JobFailed)
			if !strings.Contains(j.ErrorMessage, "safe resume validator") {
				t.Fatalf("unsafe validator accepted: %s", j.ErrorMessage)
			}
		})
	}
}

func TestNativeCancellationPersistenceFailureIsVisibleAndRecoverable(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	r := &nativeRecord{Request: AddRequest{Sources: []string{"https://example.test/file?token=secret"}, OutputName: "cancel.bin", DestinationDirectory: c.DownloadDirectory, Headers: []RequestHeader{{Name: "Authorization", Value: "secret"}}}, Job: Job{ID: "aabb0033", Name: "cancel.bin", Source: "https://example.test/file", Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "cancel.bin"), Status: JobPaused}}
	e.mu.Lock()
	e.state.Jobs = append(e.state.Jobs, r)
	err := e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(p.StateDirectory, "session.native.json")
	backup := state + ".backup"
	if err := os.Rename(state, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	if err := e.Cancel(context.Background(), r.Job.ID); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := e.Snapshot(context.Background(), 20); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("snapshot concealed failed save: %v", err)
	}
	if err := os.Remove(state); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, state); err != nil {
		t.Fatal(err)
	}
	snap, err := e.Snapshot(context.Background(), 20)
	if err != nil || len(snap.Jobs) != 0 {
		t.Fatalf("snapshot recovery: %#v %v", snap, err)
	}
	data, err := os.ReadFile(state)
	if err != nil || bytes.Contains(data, []byte("secret")) {
		t.Fatalf("cancelled secrets retained: %v", err)
	}
}

func TestNativePromotionDirectorySyncFailureRecovers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("downloaded")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	e.mu.Lock()
	e.syncDir = func(string) error { return errors.New("injected sync failure") }
	e.mu.Unlock()
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL + "?token=secret"}, OutputName: "sync.bin"})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobFailed)
	if !strings.Contains(j.ErrorMessage, "sync") {
		t.Fatal(j.ErrorMessage)
	}
	e.mu.Lock()
	e.syncDir = syncDirectory
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	s = nativeService(t, c, p)
	j = waitNative(t, s, add.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || string(got) != "downloaded" {
		t.Fatalf("recovered %q: %v", got, err)
	}
	data, err := os.ReadFile(filepath.Join(p.StateDirectory, "session.native.json"))
	if err != nil || bytes.Contains(data, []byte("secret")) {
		t.Fatalf("recovered session retained secrets: %v", err)
	}
}

func TestNativePartialSupportsLongOutputAndPreservesLegacyName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("content")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	name := strings.Repeat("x", 220) + ".bin"
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: name})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	if got, err := os.ReadFile(j.OutputPath); err != nil || string(got) != "content" {
		t.Fatalf("long name: %q %v", got, err)
	}
	r := &nativeRecord{Job: Job{ID: "aabb0044", Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "old.bin")}}
	legacy := r.Job.OutputPath + ".protopeek-" + r.Job.ID + ".part"
	if err := os.WriteFile(legacy, []byte("old partial"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := nativePart(r); got != legacy {
		t.Fatalf("legacy partial hidden: %s", got)
	}
}

func TestNativeChangedRedirectCannotMixMatchingETags(t *testing.T) {
	oldBody, newBody := []byte("old-content"), []byte("new-content")
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"same"`)
		if r.Header.Get("Range") != "" {
			w.Header().Set("Content-Range", "bytes 3-10/11")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(newBody[3:])
			return
		}
		_, _ = w.Write(newBody)
	}))
	defer cdn.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, cdn.URL+"/new?token=private", http.StatusFound)
	}))
	defer origin.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	r := &nativeRecord{Request: AddRequest{Sources: []string{origin.URL}, OutputName: "identity.bin", DestinationDirectory: c.DownloadDirectory}, Validator: `"same"`, EffectiveURLSHA256: nativeTestURLHash(cdn.URL + "/old?token=private"), Job: Job{ID: "ccdd0011", Name: "identity.bin", Status: JobPaused, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "identity.bin"), Source: origin.URL}}
	if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePart(r), oldBody[:3], 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.state.Jobs = append(e.state.Jobs, r)
	err := e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Resume(context.Background(), r.Job.ID); err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, r.Job.ID, JobFailed)
	if !strings.Contains(j.ErrorMessage, "redirect target changed") {
		t.Fatal(j.ErrorMessage)
	}
	if got, err := os.ReadFile(nativePart(r)); err != nil || !bytes.Equal(got, oldBody[:3]) {
		t.Fatal("mixed partial data")
	}
	if _, err := e.Retry(context.Background(), r.Job.ID, r.Request, c); err != nil {
		t.Fatal(err)
	}
	j = waitNative(t, s, r.Job.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || !bytes.Equal(got, newBody) {
		t.Fatalf("retry: %q %v", got, err)
	}
	files, err := filepath.Glob(filepath.Join(c.DownloadDirectory, ".protopeek-"+r.Job.ID+"-*-preserved.part"))
	if err != nil || len(files) != 1 {
		t.Fatalf("preserved: %v %v", files, err)
	}
	got, err = os.ReadFile(files[0])
	if err != nil || !bytes.Equal(got, oldBody[:3]) {
		t.Fatalf("lost original partial: %q %v", got, err)
	}
	state, err := os.ReadFile(filepath.Join(p.StateDirectory, "session.native.json"))
	if err != nil || bytes.Contains(state, []byte("token=private")) {
		t.Fatal("redirect URL leaked into session")
	}
}

func TestNativeRetryAfterChecksumMismatchPreservesBadPartial(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"stable"`)
		if attempts.Add(1) <= 2 {
			_, _ = w.Write([]byte("bad data"))
			return
		}
		_, _ = w.Write([]byte("good data"))
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	expected := sha256.Sum256([]byte("good data"))
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "retry.bin", SHA256: hex.EncodeToString(expected[:])})
	if err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, add.ID, JobFailed)
	if _, err := s.Retry(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, add.ID, JobFailed)
	if _, err := s.Retry(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || string(got) != "good data" {
		t.Fatalf("retry: %q %v", got, err)
	}
	files, err := filepath.Glob(filepath.Join(c.DownloadDirectory, ".protopeek-"+add.ID+"-*-preserved.part"))
	if err != nil || len(files) != 2 {
		t.Fatalf("preserved %v %v", files, err)
	}
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 2 {
		t.Fatalf("visible partials: %#v %v", snapshot.PreservedPartials, err)
	}
	for _, partial := range snapshot.PreservedPartials {
		got, err = os.ReadFile(partial.Path)
		if err != nil || string(got) != "bad data" || partial.SizeBytes != int64(len(got)) || partial.JobID != add.ID {
			t.Fatalf("prior bytes %q %#v %v", got, partial, err)
		}
	}
	if err := s.Cancel(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 2 {
		t.Fatalf("stopped partials: %#v %v", snapshot.PreservedPartials, err)
	}
	if err := os.Remove(files[0]); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 1 {
		t.Fatalf("removed partial still listed: %#v %v", snapshot.PreservedPartials, err)
	}
}

func TestNativeRetryWithoutETagRestartsAndPreservesPartial(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if attempts.Add(1) == 1 {
			w.Header().Set("Content-Length", "20")
			_, _ = w.Write([]byte("initial"))
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		_, _ = w.Write([]byte("replacement"))
	}))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "noetag.bin"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		snap, err := s.Snapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(snap.Jobs) > 0 && snap.Jobs[0].CompletedBytes >= 7 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("partial missing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.Pause(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	s = nativeService(t, c, p)
	if err := s.Resume(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, add.ID, JobFailed)
	if _, err := s.Retry(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	got, err := os.ReadFile(j.OutputPath)
	if err != nil || string(got) != "replacement" {
		t.Fatalf("retry %q %v", got, err)
	}
	files, err := filepath.Glob(filepath.Join(c.DownloadDirectory, ".protopeek-"+add.ID+"-*-preserved.part"))
	if err != nil || len(files) != 1 {
		t.Fatalf("preserved %v %v", files, err)
	}
	got, err = os.ReadFile(files[0])
	if err != nil || string(got) != "initial" {
		t.Fatalf("old bytes %q %v", got, err)
	}
}

func TestNativePreservedPartialLimitAndManualCleanup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("new")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	r := &nativeRecord{Request: AddRequest{Sources: []string{server.URL}, OutputName: "retry.bin", DestinationDirectory: c.DownloadDirectory}, Job: Job{ID: "abcdef01", Name: "retry.bin", Status: JobFailed, Source: server.URL, Directory: c.DownloadDirectory, OutputPath: filepath.Join(c.DownloadDirectory, "retry.bin")}}
	if err := os.WriteFile(nativePart(r), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	for i := 0; i < maxPreservedPartials; i++ {
		path := filepath.Join(c.DownloadDirectory, fmt.Sprintf(".protopeek-deadbeef-%016x-preserved.part", i))
		if err := os.WriteFile(path, []byte("x"), 0600); err != nil {
			e.mu.Unlock()
			t.Fatal(err)
		}
		identity, identityErr := directoryIdentity(c.DownloadDirectory)
		if identityErr != nil {
			e.mu.Unlock()
			t.Fatal(identityErr)
		}
		e.state.PreservedPartials = append(e.state.PreservedPartials, nativePreservedPartial{PreservedPartial: PreservedPartial{JobID: "deadbeef", Path: path, SizeBytes: 1}, DirectoryIdentity: identity})
	}
	e.state.Jobs = append(e.state.Jobs, r)
	err := e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Retry(context.Background(), r.Job.ID, r.Request, c); !errors.Is(err, ErrPreservedLimit) {
		t.Fatalf("limit: %v", err)
	}
	if got, err := os.ReadFile(nativePart(r)); err != nil || string(got) != "old" {
		t.Fatalf("blocked retry changed partial: %q %v", got, err)
	}
	snap, err := s.Snapshot(context.Background())
	if err != nil || len(snap.PreservedPartials) != maxPreservedPartials {
		t.Fatalf("ledger: %d %v", len(snap.PreservedPartials), err)
	}
	if err := os.Remove(snap.PreservedPartials[0].Path); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Retry(context.Background(), r.Job.ID, r.Request, c); err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, r.Job.ID, JobCompleted)
	snap, err = s.Snapshot(context.Background())
	if err != nil || len(snap.PreservedPartials) != maxPreservedPartials {
		t.Fatalf("ledger after cleanup/retry: %d %v", len(snap.PreservedPartials), err)
	}
}

func TestNativePreservedPartialSurvivesDisconnectedDirectory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("new")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	if err := os.MkdirAll(c.DownloadDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	identity, err := directoryIdentity(c.DownloadDirectory)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(c.DownloadDirectory, ".protopeek-deadbeef-0000000000000001-preserved.part")
	if err := os.WriteFile(path, []byte("old data"), 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.state.PreservedPartials = append(e.state.PreservedPartials, nativePreservedPartial{PreservedPartial: PreservedPartial{JobID: "deadbeef", Path: path, SizeBytes: 8}, DirectoryIdentity: identity})
	err = e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	offline := c.DownloadDirectory + "-offline"
	if err := os.Rename(c.DownloadDirectory, offline); err != nil {
		t.Fatal(err)
	}
	// Simulate a mount point that stays present but now refers to a different
	// empty underlying directory, as well as a disconnected removable drive.
	if err := os.Mkdir(c.DownloadDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	snap, err := s.Snapshot(context.Background())
	if err != nil || len(snap.PreservedPartials) != 1 {
		t.Fatalf("lost offline entry: %#v %v", snap.PreservedPartials, err)
	}
	other := filepath.Join(filepath.Dir(c.DownloadDirectory), "other")
	if err := os.Mkdir(other, 0755); err != nil {
		t.Fatal(err)
	}
	r := &nativeRecord{Request: AddRequest{Sources: []string{server.URL}, OutputName: "retry.bin", DestinationDirectory: other}, Job: Job{ID: "abcdef01", Name: "retry.bin", Status: JobFailed, Source: server.URL, Directory: other, OutputPath: filepath.Join(other, "retry.bin")}}
	if err := os.WriteFile(nativePart(r), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.state.Jobs = append(e.state.Jobs, r)
	err = e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Retry(context.Background(), r.Job.ID, r.Request, c); err != nil {
		t.Fatal(err)
	}
	waitNative(t, s, r.Job.ID, JobCompleted)
	if err := os.Remove(c.DownloadDirectory); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(offline, c.DownloadDirectory); err != nil {
		t.Fatal(err)
	}
	snap, err = s.Snapshot(context.Background())
	if err != nil || len(snap.PreservedPartials) != 2 {
		t.Fatalf("lost reconnected entry: %#v %v", snap.PreservedPartials, err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "old data" {
		t.Fatalf("reconnected file: %q %v", got, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	snap, err = s.Snapshot(context.Background())
	if err != nil || len(snap.PreservedPartials) != 1 {
		t.Fatalf("manual removal not recognized: %#v %v", snap.PreservedPartials, err)
	}
}

func TestNativeIdleTimeoutAndContinuousTransfer(t *testing.T) {
	for _, mode := range []string{"headers", "body", "continuous"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "headers":
					<-r.Context().Done()
				case "body":
					w.Header().Set("Content-Length", "1000")
					_, _ = w.Write([]byte("part"))
					w.(http.Flusher).Flush()
					<-r.Context().Done()
				case "continuous":
					for i := 0; i < 8; i++ {
						_, _ = w.Write([]byte("x"))
						w.(http.Flusher).Flush()
						time.Sleep(40 * time.Millisecond)
					}
				}
			}))
			defer server.Close()
			c, p := nativeFixture(t)
			s := nativeService(t, c, p)
			e := s.runtime.Engine.(*nativeEngine)
			e.mu.Lock()
			e.client = newNativeHTTPClient(false, 150*time.Millisecond)
			e.mu.Unlock()
			add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "idle.bin"})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "continuous" {
				j := waitNative(t, s, add.ID, JobCompleted)
				data, err := os.ReadFile(j.OutputPath)
				if err != nil || len(data) != 8 {
					t.Fatalf("continuous: %q %v", data, err)
				}
			} else {
				waitNative(t, s, add.ID, JobFailed)
			}
		})
	}
}

func TestArchiveNativeCompletionsBeforeSwitchIsIdempotent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("file")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL + "?token=secret"}, OutputName: "done.bin"})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	process := newFakeManagedProcess()
	aria := NewAria2Launcher()
	aria.resolve = func(string) (string, error) { return "fake-aria2", nil }
	aria.reservePort = func() (int, error) { return 6800, nil }
	aria.randomToken = func() (string, error) { return "test-secret", nil }
	aria.startProcess = func(string, []string, io.Writer, io.Writer) (managedProcess, error) { return process, nil }
	aria.newRPC = func(string, string) aria2RPC { return &fakeAriaRPC{version: "1.37.0"} }
	c.Aria2Path = "explicit-aria2"
	runtime, err := (&adaptiveLauncher{aria: aria}).Start(context.Background(), c, p)
	if err != nil || runtime.EngineName != "aria2" {
		t.Fatalf("switch: %#v %v", runtime, err)
	}
	process.exit(nil)
	if err := archiveNativeCompletions(context.Background(), c, p); err != nil {
		t.Fatal(err)
	}
	jobs, err := readCompletedHistory(filepath.Join(p.StateDirectory, "completed.json"))
	if err != nil || len(jobs) != 1 || jobs[0].ID != add.ID {
		t.Fatalf("history: %#v %v", jobs, err)
	}
	if got, err := os.ReadFile(j.OutputPath); err != nil || string(got) != "file" {
		t.Fatalf("output changed: %q %v", got, err)
	}
	data, err := os.ReadFile(filepath.Join(p.StateDirectory, "session.native.json"))
	if err != nil || bytes.Contains(data, []byte("secret")) {
		t.Fatalf("session: %s %v", data, err)
	}
	has, unfinished, err := nativeSessionState(filepath.Join(p.StateDirectory, "session.native.json"))
	if err != nil || has || unfinished {
		t.Fatalf("native not cleared: %v %v %v", has, unfinished, err)
	}
}

func TestStoppedForgetDoesNotResurrectNativeCompletion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("complete")) }))
	defer server.Close()
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	add, err := s.Add(context.Background(), AddRequest{Sources: []string{server.URL}, OutputName: "forgot.bin"})
	if err != nil {
		t.Fatal(err)
	}
	j := waitNative(t, s, add.ID, JobCompleted)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetCompleted(context.Background(), add.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(j.OutputPath); err != nil || string(got) != "complete" {
		t.Fatalf("output changed: %q %v", got, err)
	}
	s = nativeService(t, c, p)
	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, job := range snap.Jobs {
		if job.ID == add.ID {
			t.Fatal("forgotten record reappeared")
		}
	}
}
