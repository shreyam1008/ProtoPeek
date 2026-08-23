package cli

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type fakeDownloadService struct {
	mu sync.Mutex

	startHealth transfer.Health
	startErr    error
	addResult   transfer.AddResult
	addErr      error
	snapshots   []transfer.Snapshot
	snapshotErr error
	shutdownErr error

	calls   []string
	lastAdd transfer.AddRequest
}

func (service *fakeDownloadService) Start(context.Context) (transfer.Health, error) {
	service.record("start")
	return service.startHealth, service.startErr
}

func (service *fakeDownloadService) Add(_ context.Context, request transfer.AddRequest) (transfer.AddResult, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.calls = append(service.calls, "add")
	service.lastAdd = request
	return service.addResult, service.addErr
}

func (service *fakeDownloadService) Snapshot(context.Context) (transfer.Snapshot, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.calls = append(service.calls, "snapshot")
	if len(service.snapshots) == 0 {
		return transfer.Snapshot{}, service.snapshotErr
	}
	snapshot := service.snapshots[0]
	if len(service.snapshots) > 1 {
		service.snapshots = service.snapshots[1:]
	}
	return snapshot, service.snapshotErr
}

func (service *fakeDownloadService) Shutdown(context.Context) error {
	service.record("shutdown")
	return service.shutdownErr
}

func (service *fakeDownloadService) record(call string) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.calls = append(service.calls, call)
}

func (service *fakeDownloadService) recordedCalls() string {
	service.mu.Lock()
	defer service.mu.Unlock()
	return strings.Join(service.calls, ",")
}

func TestDownloadCommandHelpDoesNotLoadService(t *testing.T) {
	t.Parallel()
	var stdout, stderr bytes.Buffer
	factoryCalled := false
	code := runDownloadCommand(context.Background(), []string{"--help"}, &stdout, &stderr, func() (downloadCommandService, error) {
		factoryCalled = true
		return nil, errors.New("must not be called")
	}, false)

	if code != 0 {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
	if factoryCalled {
		t.Fatal("help loaded the transfer service")
	}
	if !strings.Contains(stderr.String(), "download [flags] URL") || !strings.Contains(stderr.String(), "-sha256") {
		t.Fatalf("help output = %q", stderr.String())
	}
}

func TestDownloadCommandRejectsUnsafeInputsBeforeLoadingService(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		args []string
	}{
		{name: "unsafe output", args: []string{"--output", "../artifact.bin", "https://example.com/artifact.bin"}},
		{name: "invalid digest", args: []string{"--sha256", "deadbeef", "https://example.com/artifact.bin"}},
		{name: "credentials", args: []string{"https://user:secret@example.com/artifact.bin"}},
		{name: "unsupported scheme", args: []string{"ftp://example.com/artifact.bin"}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var stdout, stderr bytes.Buffer
			factoryCalled := false
			code := runDownloadCommand(context.Background(), test.args, &stdout, &stderr, func() (downloadCommandService, error) {
				factoryCalled = true
				return nil, nil
			}, false)
			if code != 2 {
				t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
			}
			if factoryCalled {
				t.Fatal("invalid input loaded the transfer service")
			}
		})
	}
}

func TestDownloadCommandCompletesAndReportsVerifiedOutput(t *testing.T) {
	t.Parallel()
	digest := strings.Repeat("ab", sha256DigestBytes)
	service := &fakeDownloadService{
		startHealth: transfer.Health{Ready: true, Status: "running", EngineVersion: "1.37.0"},
		addResult: transfer.AddResult{
			ID:                 "aabbccdd",
			ExpectedSHA256:     digest,
			Verification:       "pending",
			PersistenceWarning: transfer.PersistenceWarningMessage,
		},
		snapshots: []transfer.Snapshot{{Jobs: []transfer.Job{{
			ID:              "aabbccdd",
			Name:            "artifact.bin",
			Status:          transfer.JobCompleted,
			OutputPath:      "/tmp/artifact.bin",
			TotalBytes:      1024,
			CompletedBytes:  1024,
			ProgressPercent: 100,
			ExpectedSHA256:  digest,
			Verification:    "verified",
		}}}},
	}
	var stdout, stderr bytes.Buffer
	code := runDownloadCommand(
		context.Background(),
		[]string{"--output", "artifact.bin", "--sha256", strings.ToUpper(digest), "https://example.com/artifact.bin#fragment"},
		&stdout,
		&stderr,
		func() (downloadCommandService, error) { return service, nil },
		false,
	)

	if code != 0 {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
	if stdout.String() != "/tmp/artifact.bin\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "Queued aabbccdd with aria2c 1.37.0") ||
		!strings.Contains(stderr.String(), "Warning: "+transfer.PersistenceWarningMessage) ||
		!strings.Contains(stderr.String(), "completed") {
		t.Fatalf("stderr = %q", stderr.String())
	}
	if got := service.recordedCalls(); got != "start,add,snapshot,shutdown" {
		t.Fatalf("calls = %q", got)
	}
	if service.lastAdd.OutputName != "artifact.bin" || service.lastAdd.SHA256 != digest {
		t.Fatalf("add request = %#v", service.lastAdd)
	}
	if got := service.lastAdd.Sources; len(got) != 1 || got[0] != "https://example.com/artifact.bin" {
		t.Fatalf("sources = %#v", got)
	}
}

func TestDownloadCommandExplainsProcessLock(t *testing.T) {
	t.Parallel()
	service := &fakeDownloadService{startErr: transfer.ErrLockHeld}
	var stdout, stderr bytes.Buffer
	code := runDownloadCommand(context.Background(), []string{"https://example.com/artifact.bin"}, &stdout, &stderr, func() (downloadCommandService, error) {
		return service, nil
	}, false)

	if code != 1 {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "does not connect to an already-running browser session") {
		t.Fatalf("stderr = %q", stderr.String())
	}
	if got := service.recordedCalls(); got != "start,shutdown" {
		t.Fatalf("calls = %q", got)
	}
}

func TestDownloadCommandErrorsNeverEchoSourceURLOrProviderText(t *testing.T) {
	t.Parallel()
	secret := "https://example.com/artifact.bin?signature=private-secret"
	for _, test := range []struct {
		name    string
		service *fakeDownloadService
	}{
		{name: "start", service: &fakeDownloadService{startErr: errors.New("provider rejected " + secret)}},
		{
			name: "add",
			service: &fakeDownloadService{
				startHealth: transfer.Health{Ready: true, Status: "running"},
				addErr:      errors.New("provider rejected " + secret),
			},
		},
		{
			name: "snapshot",
			service: &fakeDownloadService{
				startHealth: transfer.Health{Ready: true, Status: "running"},
				addResult:   transfer.AddResult{ID: "aabbccdd"},
				snapshotErr: errors.New("provider rejected " + secret),
			},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var stdout, stderr bytes.Buffer
			code := runDownloadCommand(context.Background(), []string{secret}, &stdout, &stderr, func() (downloadCommandService, error) {
				return test.service, nil
			}, false)
			if code != 1 {
				t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
			}
			if strings.Contains(stderr.String(), "example.com") || strings.Contains(stderr.String(), "private-secret") || strings.Contains(stderr.String(), "provider rejected") {
				t.Fatalf("terminal error leaked provider detail: %q", stderr.String())
			}
		})
	}
}

func TestDownloadCommandReturnsTerminalFailure(t *testing.T) {
	t.Parallel()
	service := &fakeDownloadService{
		startHealth: transfer.Health{Ready: true, Status: "running", EngineVersion: "1.37.0"},
		addResult:   transfer.AddResult{ID: "aabbccdd"},
		snapshots: []transfer.Snapshot{{Jobs: []transfer.Job{{
			ID:           "aabbccdd",
			Status:       transfer.JobFailed,
			ErrorMessage: "checksum mismatch",
		}}}},
	}
	var stdout, stderr bytes.Buffer
	code := runDownloadCommand(context.Background(), []string{"https://example.com/artifact.bin"}, &stdout, &stderr, func() (downloadCommandService, error) {
		return service, nil
	}, false)

	if code != 1 || !strings.Contains(stderr.String(), "Download failed: checksum mismatch") {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
}

func TestDownloadCommandInterruptPreservesPartialTransfer(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service := &fakeDownloadService{
		startHealth: transfer.Health{Ready: true, Status: "running", EngineVersion: "1.37.0"},
		addResult:   transfer.AddResult{ID: "aabbccdd"},
		snapshots: []transfer.Snapshot{{Jobs: []transfer.Job{{
			ID:              "aabbccdd",
			Status:          transfer.JobDownloading,
			ProgressPercent: 40,
		}}}},
	}
	var stdout, stderr bytes.Buffer
	code := runDownloadCommand(ctx, []string{"https://example.com/artifact.bin"}, &stdout, &stderr, func() (downloadCommandService, error) {
		return service, nil
	}, false)

	if code != 130 || !strings.Contains(stderr.String(), "Partial data and the aria2 session were preserved") {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
	if got := service.recordedCalls(); got != "start,add,snapshot,shutdown" {
		t.Fatalf("calls = %q", got)
	}
}

func TestExitCleanupLayersPreserveOrderAndCode(t *testing.T) {
	t.Parallel()
	var events []string
	exitCode := -1
	baseExit := func(code int) {
		events = append(events, "exit")
		exitCode = code
	}
	transferAwareExit := withExitCleanup(baseExit, func() {
		events = append(events, "transfer")
	})
	connectionAndTransferAwareExit := withExitCleanup(transferAwareExit, func() {
		events = append(events, "connection")
	})

	connectionAndTransferAwareExit(7)

	if got := strings.Join(events, ","); got != "connection,transfer,exit" {
		t.Fatalf("cleanup order = %q", got)
	}
	if exitCode != 7 {
		t.Fatalf("exit code = %d", exitCode)
	}
}

func TestDownloadCommandSystemAria2Integration(t *testing.T) {
	if os.Getenv("PROTOPEEK_ARIA2_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_ARIA2_INTEGRATION=1 to exercise the installed aria2c through the CLI seam")
	}
	binary, err := exec.LookPath("aria2c")
	if err != nil {
		t.Skip("aria2c is not installed")
	}

	payload := []byte("ProtoPeek CLI transfer integration\n")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/octet-stream")
		_, _ = writer.Write(payload)
	}))
	defer server.Close()

	root := t.TempDir()
	downloads := filepath.Join(root, "downloads")
	config := transfer.DefaultHostConfig()
	config.Aria2Path = binary
	config.DownloadDirectory = downloads
	config.MinimumFreeDiskBytes = 0
	paths := transfer.Paths{
		ConfigFile:       filepath.Join(root, "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	service, err := transfer.NewService(config, paths)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	code := runDownloadCommand(
		ctx,
		[]string{"--output", "cli-fixture.bin", "--sha256", hex.EncodeToString(digest[:]), server.URL + "/fixture?private=query-is-not-printed"},
		&stdout,
		&stderr,
		func() (downloadCommandService, error) { return service, nil },
		false,
	)
	if code != 0 {
		t.Fatalf("exit code = %d stderr=%q", code, stderr.String())
	}
	outputPath := filepath.Join(downloads, "cli-fixture.bin")
	if stdout.String() != outputPath+"\n" {
		t.Fatalf("stdout = %q want %q", stdout.String(), outputPath+"\n")
	}
	got, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("downloaded payload = %q", got)
	}
}
