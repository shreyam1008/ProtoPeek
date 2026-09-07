package transfer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatalf("save integration config: %v", err)
	}
	pausedURL := server.URL + "/resume.bin?token=paused-resume-secret"
	pausedHeader := "Authorization: Bearer paused-resume-header"
	pausedSession := pausedURL + "\n dir=" + downloads + "\n out=resume.bin\n pause=true\n header=" + pausedHeader + "\n"
	if err := os.MkdirAll(filepath.Dir(paths.SessionFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.SessionFile, []byte(pausedSession), 0o600); err != nil {
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
		Headers: []RequestHeader{{
			Name:  "Authorization",
			Value: "Bearer completed-session-secret",
		}},
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
				session, err := os.ReadFile(paths.SessionFile)
				if err != nil {
					t.Fatal(err)
				}
				saved := string(session)
				if strings.Contains(saved, "discard-from-snapshot") || strings.Contains(saved, "completed-session-secret") {
					t.Fatalf("completed signed URL/header remained in saved aria2 session: %q", saved)
				}
				if !strings.Contains(saved, "paused-resume-secret") || !strings.Contains(saved, "paused-resume-header") || !strings.Contains(saved, "pause=true") {
					t.Fatalf("paused resume data was not preserved in saved aria2 session: %q", saved)
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

func TestSystemAria2NewJobPreservesExistingFile(t *testing.T) {
	if os.Getenv("PROTOPEEK_ARIA2_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_ARIA2_INTEGRATION=1")
	}
	binary, err := resolveAria2Binary("")
	if err != nil {
		t.Fatal(err)
	}
	payload := strings.Repeat("different new bytes\n", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, payload) }))
	defer server.Close()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = root
	config.Aria2Path = binary
	config.MinimumFreeDiskBytes = 0
	original := filepath.Join(root, "artifact.bin")
	if err := os.WriteFile(original, []byte("keep this unrelated completed file"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := Paths{ConfigFile: filepath.Join(root, "config.json"), StateDirectory: filepath.Join(root, "state"), SessionFile: filepath.Join(root, "state", "session.aria2"), VerificationFile: filepath.Join(root, "state", "verification.json"), LockFile: filepath.Join(root, "state", "engine.lock")}
	runtime, err := NewAria2Launcher().Start(context.Background(), config, paths)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := runtime.Stop(ctx); err != nil {
			t.Error(err)
		}
	}()
	id, err := runtime.Engine.Add(context.Background(), AddRequest{Sources: []string{server.URL + "/artifact.bin"}}, config)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := runtime.Engine.Snapshot(context.Background(), 16)
		if err != nil {
			t.Fatal(err)
		}
		for _, job := range snapshot.Jobs {
			if job.ID != id {
				continue
			}
			if job.Status == JobFailed {
				t.Fatalf("new job failed: %#v", job)
			}
			if job.Status == JobCompleted {
				if data, err := os.ReadFile(original); err != nil || string(data) != "keep this unrelated completed file" {
					t.Fatalf("original changed: %q %v", data, err)
				}
				if data, err := os.ReadFile(filepath.Join(root, "artifact (1).bin")); err != nil || string(data) != payload {
					t.Fatalf("new payload wrong: %d bytes %v", len(data), err)
				}
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("new download did not finish")
}
