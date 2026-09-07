package transfer

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestSystemAria2QueuedNamesAreReservedBeforeCreation(t *testing.T) {
	if os.Getenv("PROTOPEEK_ARIA2_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_ARIA2_INTEGRATION=1")
	}
	binary, err := resolveAria2Binary("")
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	var startOnce, releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/block.bin" {
			startOnce.Do(func() { close(started) })
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		_, _ = io.WriteString(w, "payload-"+r.URL.Query().Get("v"))
	}))
	defer server.Close()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory, config.Aria2Path = root, binary
	config.MinimumFreeDiskBytes, config.MaxActiveJobs = 0, 1
	paths := Paths{ConfigFile: filepath.Join(root, "config.json"), StateDirectory: filepath.Join(root, "state"), SessionFile: filepath.Join(root, "state", "session.aria2"), VerificationFile: filepath.Join(root, "state", "verification.json"), LockFile: filepath.Join(root, "state", "engine.lock")}
	service, err := NewService(config, paths)
	if err != nil {
		t.Fatal(err)
	}
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		releaseOnce.Do(func() { close(release) })
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	}()
	if _, err := service.Add(context.Background(), AddRequest{Sources: []string{server.URL + "/block.bin"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("blocker never started")
	}
	for _, version := range []string{"first", "second"} {
		if _, err := service.Add(context.Background(), AddRequest{Sources: []string{server.URL + "/artifact.bin?v=" + version}}); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, job := range snapshot.Jobs {
		if job.Status == JobQueued {
			names[job.Name] = true
			if _, err := os.Stat(job.OutputPath); !os.IsNotExist(err) {
				t.Fatalf("waiting file already exists: %s %v", job.OutputPath, err)
			}
		}
	}
	if len(names) != 2 || !names["artifact.bin"] || !names["artifact (1).bin"] {
		t.Fatalf("queued names: %+v / %+v", names, snapshot.Jobs)
	}
	releaseOnce.Do(func() { close(release) })
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err = service.Snapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Metrics.CompletedCount == 3 {
			for name, expected := range map[string]string{"artifact.bin": "payload-first", "artifact (1).bin": "payload-second"} {
				data, err := os.ReadFile(filepath.Join(root, name))
				if err != nil || string(data) != expected {
					t.Fatalf("%s: %q %v", name, data, err)
				}
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("queue did not finish: %+v", snapshot.Jobs)
}
