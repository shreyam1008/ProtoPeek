package transfer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompletedHistorySurvivesStopAndForgetKeepsFile(t *testing.T) {
	engine := &fakeEngine{}
	service, _, _, _, paths := testService(t, engine)
	output := filepath.Join(service.config.DownloadDirectory, "finished.bin")
	if err := os.WriteFile(output, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	engine.snapshot.Jobs = []Job{{ID: "abcdef1234567890", Name: "finished.bin", Status: JobCompleted, OutputPath: output, Source: "https://user:secret@example.test/file?token=secret", TotalBytes: 4, CompletedBytes: 4, ErrorMessage: "private provider response"}}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Snapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := service.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(paths.StateDirectory, "completed.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"secret", "token=", "private provider"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("history retained %q", secret)
		}
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || !snapshot.Jobs[0].Historical || snapshot.Metrics.CompletedCount != 1 {
		t.Fatalf("stopped history: %#v", snapshot)
	}
	if err := service.ForgetCompleted(context.Background(), "abcdef1234567890"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = service.Snapshot(context.Background())
	if err != nil || len(snapshot.Jobs) != 0 {
		t.Fatalf("forget: %#v %v", snapshot, err)
	}
	if data, err := os.ReadFile(output); err != nil || string(data) != "keep" {
		t.Fatalf("forget changed file: %q %v", data, err)
	}
}

func TestInvalidCompletionPreservesHistory(t *testing.T) {
	service, _, _, _, paths := testService(t, &fakeEngine{})
	old := Job{ID: "abcdef1234567890", Status: JobCompleted, Name: "good", CompletedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	path := filepath.Join(paths.StateDirectory, "completed.json")
	if err := writeCompletedHistory(path, []Job{old}); err != nil {
		t.Fatal(err)
	}
	bad := Job{ID: "abcdef1234567891", Status: JobCompleted, Name: "bad", Directory: strings.Repeat("x", maxDestinationLength+1)}
	if err := service.rememberCompleted([]Job{bad}); err == nil {
		t.Fatal("accepted oversized directory")
	}
	jobs, err := readCompletedHistory(path)
	if err != nil || len(jobs) != 1 || jobs[0].ID != old.ID {
		t.Fatalf("history lost: %v %v", jobs, err)
	}
	if err := os.WriteFile(path, []byte(`{"version":9,"jobs":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil || snapshot.PersistenceWarning == "" {
		t.Fatalf("missing persistence warning: %#v %v", snapshot, err)
	}
}

func TestCompletionObserverSavesWithoutBrowserAndStopsWhenIdle(t *testing.T) {
	engine := &fakeEngine{snapshot: EngineSnapshot{Jobs: []Job{{ID: "abcdef1234567890", Status: JobCompleted, Name: "background.bin"}}}}
	service, launcher, _, _, paths := testService(t, engine)
	launcher.runtime.observeCompletions = true
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer service.Shutdown(context.Background())
	deadline := time.Now().Add(2 * time.Second)
	for {
		jobs, err := readCompletedHistory(filepath.Join(paths.StateDirectory, "completed.json"))
		if err == nil && len(jobs) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("host did not record completion: %v %v", jobs, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	engine.mu.Lock()
	before := len(engine.calls)
	engine.mu.Unlock()
	time.Sleep(100 * time.Millisecond)
	engine.mu.Lock()
	after := len(engine.calls)
	engine.mu.Unlock()
	if before != after {
		t.Fatalf("idle observer polled: %d -> %d", before, after)
	}
	engine.mu.Lock()
	engine.snapshot.Jobs = append(engine.snapshot.Jobs, Job{ID: "abcdef1234567891", Status: JobCompleted, Name: "resumed.bin"})
	engine.mu.Unlock()
	service.wakeHistoryObserver()
	deadline = time.Now().Add(2 * time.Second)
	for {
		jobs, err := readCompletedHistory(filepath.Join(paths.StateDirectory, "completed.json"))
		if err == nil && len(jobs) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("wake did not save new completion: %v %v", jobs, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
