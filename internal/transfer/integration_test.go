package transfer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestSystemAria2Integration(t *testing.T) {
	if os.Getenv("PROTOPEEK_ARIA2_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_ARIA2_INTEGRATION=1 to exercise the installed aria2c")
	}
	binary, err := exec.LookPath("aria2c")
	if err != nil {
		t.Skip("aria2c is not installed")
	}

	payload := []byte("ProtoPeek transfer integration\n")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/octet-stream")
		_, _ = writer.Write(payload)
	}))
	defer server.Close()

	directory := t.TempDir()
	downloads := filepath.Join(directory, "downloads")
	config := DefaultHostConfig()
	config.Aria2Path = binary
	config.DownloadDirectory = downloads
	config.MinimumFreeDiskBytes = 0
	paths := Paths{
		ConfigFile:       filepath.Join(directory, "transfers.json"),
		StateDirectory:   filepath.Join(directory, "state"),
		SessionFile:      filepath.Join(directory, "state", "session.aria2"),
		VerificationFile: filepath.Join(directory, "state", "verification.json"),
		LockFile:         filepath.Join(directory, "state", "engine.lock"),
	}
	service, err := NewService(config, paths)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatalf("start system aria2c: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Errorf("shutdown system aria2c: %v", err)
		}
	}()

	digest := sha256.Sum256(payload)
	result, err := service.Add(context.Background(), AddRequest{
		Sources:    []string{server.URL + "/fixture.bin?private=discard-from-snapshot"},
		OutputName: "fixture.bin",
		SHA256:     hex.EncodeToString(digest[:]),
	})
	if err != nil {
		t.Fatalf("add local fixture: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for {
		snapshot, err := service.Snapshot(context.Background())
		if err != nil {
			t.Fatalf("snapshot local fixture: %v", err)
		}
		for _, job := range snapshot.Jobs {
			if job.ID != result.ID {
				continue
			}
			if job.Source != server.URL+"/fixture.bin" {
				t.Fatalf("source was not redacted: %q", job.Source)
			}
			if job.Status == JobFailed {
				t.Fatalf("local fixture failed: %s %s", job.ErrorCode, job.ErrorMessage)
			}
			if job.Status == JobCompleted {
				got, err := os.ReadFile(filepath.Join(downloads, "fixture.bin"))
				if err != nil {
					t.Fatal(err)
				}
				if string(got) != string(payload) {
					t.Fatalf("downloaded payload = %q", got)
				}
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("local aria2 transfer did not complete before deadline")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
