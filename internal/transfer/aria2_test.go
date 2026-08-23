package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeAriaRPC struct {
	mu sync.Mutex

	active  []aria2Status
	waiting []aria2Status
	stopped []aria2Status
	status  aria2Status
	global  aria2GlobalStat
	version string

	versionErr      error
	pauseErr        error
	removeErr       error
	removeResultErr error
	saveErr         error
	addID           string
	addErr          error
	methods         []string
	lastAdd         []string
	lastOpts        map[string]any
	onShutdown      func()
}

func (rpc *fakeAriaRPC) record(method string) {
	rpc.mu.Lock()
	defer rpc.mu.Unlock()
	rpc.methods = append(rpc.methods, method)
}

func (rpc *fakeAriaRPC) AddURI(_ context.Context, sources []string, options map[string]any) (string, error) {
	rpc.record("add")
	rpc.lastAdd = append([]string(nil), sources...)
	rpc.lastOpts = options
	return rpc.addID, rpc.addErr
}

func (rpc *fakeAriaRPC) TellActive(context.Context) ([]aria2Status, error) {
	rpc.record("active")
	return rpc.active, nil
}

func (rpc *fakeAriaRPC) TellWaiting(context.Context, int, int) ([]aria2Status, error) {
	rpc.record("waiting")
	return rpc.waiting, nil
}

func (rpc *fakeAriaRPC) TellStopped(context.Context, int, int) ([]aria2Status, error) {
	rpc.record("stopped")
	return rpc.stopped, nil
}

func (rpc *fakeAriaRPC) TellStatus(context.Context, string) (aria2Status, error) {
	rpc.record("status")
	return rpc.status, nil
}

func (rpc *fakeAriaRPC) Pause(context.Context, string) error {
	rpc.record("pause")
	return rpc.pauseErr
}

func (rpc *fakeAriaRPC) Unpause(context.Context, string) error {
	rpc.record("unpause")
	return nil
}

func (rpc *fakeAriaRPC) Remove(context.Context, string) error {
	rpc.record("remove")
	return rpc.removeErr
}

func (rpc *fakeAriaRPC) ForceRemove(context.Context, string) error {
	rpc.record("forceRemove")
	return nil
}

func (rpc *fakeAriaRPC) RemoveDownloadResult(context.Context, string) error {
	rpc.record("removeResult")
	return rpc.removeResultErr
}

func (rpc *fakeAriaRPC) SaveSession(context.Context) error {
	rpc.record("save")
	return rpc.saveErr
}

func (rpc *fakeAriaRPC) Shutdown(context.Context) error {
	rpc.record("shutdown")
	if rpc.onShutdown != nil {
		rpc.onShutdown()
	}
	return nil
}

func (rpc *fakeAriaRPC) GetGlobalStat(context.Context) (aria2GlobalStat, error) {
	rpc.record("global")
	return rpc.global, nil
}

func (rpc *fakeAriaRPC) GetVersion(context.Context) (string, error) {
	rpc.record("version")
	return rpc.version, rpc.versionErr
}

func TestRPCClientUsesSecretAndCorrelatesResponse(t *testing.T) {
	t.Parallel()
	var observed rpcRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request = %s content-type=%q", request.Method, request.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(request.Body).Decode(&observed); err != nil {
			t.Errorf("decode request: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, `{"jsonrpc":"2.0","id":%q,"result":{"version":"1.37.0"}}`, observed.ID)
	}))
	defer server.Close()

	client := newRPCClient(server.URL, "private-token")
	version, err := client.GetVersion(context.Background())
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if version != "1.37.0" || observed.Method != "aria2.getVersion" {
		t.Fatalf("version=%q request=%#v", version, observed)
	}
	if len(observed.Params) != 1 || observed.Params[0] != "token:private-token" {
		t.Fatalf("RPC token parameters = %#v", observed.Params)
	}
}

func TestRPCClientBoundsResponses(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, strings.Repeat("x", maxRPCResponseBytes+1))
	}))
	defer server.Close()
	client := newRPCClient(server.URL, "")
	if _, err := client.GetVersion(context.Background()); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized response error = %v", err)
	}
}

func TestAria2EngineMapsRedactedAndChecksumEvidence(t *testing.T) {
	t.Parallel()
	rpc := &fakeAriaRPC{
		active: []aria2Status{{
			GID:             "aabbccdd",
			Status:          "active",
			TotalLength:     "100",
			CompletedLength: "50",
			DownloadSpeed:   "10",
			Connections:     "2",
			Dir:             "/tmp",
			VerifyPending:   "true",
			VerifiedLength:  "25",
			Files: []aria2File{{
				Path: "/tmp/archive.zip",
				URIs: []aria2URI{{URI: "https://user:secret@example.com/archive.zip?signature=private#fragment"}},
			}},
		}},
		global: aria2GlobalStat{DownloadSpeed: "10"},
	}
	snapshot, err := (&aria2Engine{rpc: rpc}).Snapshot(context.Background(), 10)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snapshot.Jobs) != 1 {
		t.Fatalf("jobs = %#v", snapshot.Jobs)
	}
	job := snapshot.Jobs[0]
	if job.Source != "https://example.com/archive.zip" {
		t.Fatalf("redacted source = %q", job.Source)
	}
	if job.Verification != "verifying" || job.VerifiedBytes != 25 || job.ActualSHA256 != "" {
		t.Fatalf("verification evidence = %#v", job)
	}
	if job.ProgressPercent != 50 || job.ETASeconds != 5 {
		t.Fatalf("progress evidence = %#v", job)
	}
}

func TestAria2SnapshotUsesGlobalCountsBeyondTheBoundedJobList(t *testing.T) {
	t.Parallel()
	rpc := &fakeAriaRPC{
		active: []aria2Status{{GID: "aabbccdd", Status: "active"}},
		global: aria2GlobalStat{
			NumActive:  "1",
			NumWaiting: "7",
			NumStopped: "11",
		},
	}
	snapshot, err := (&aria2Engine{rpc: rpc}).Snapshot(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.PendingCount != 7 || snapshot.Metrics.TotalCount != 19 {
		t.Fatalf("bounded snapshot = %#v", snapshot)
	}
}

func TestAria2CancelNeverDeletesOutputFile(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "partial.iso")
	if err := os.WriteFile(path, []byte("keep me"), 0o600); err != nil {
		t.Fatal(err)
	}
	rpc := &fakeAriaRPC{
		status: aria2Status{
			GID:    "aabbccdd",
			Status: "active",
			Files:  []aria2File{{Path: path}},
		},
		removeErr: errors.New("ordinary remove failed"),
	}
	if err := (&aria2Engine{rpc: rpc}).Cancel(context.Background(), "aabbccdd"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("cancel touched output file: %v", err)
	}
	want := []string{"status", "remove", "forceRemove", "removeResult", "save"}
	if strings.Join(rpc.methods, ",") != strings.Join(want, ",") {
		t.Fatalf("methods = %#v; want %#v", rpc.methods, want)
	}
}

func TestAria2RetryReappliesExpectedChecksum(t *testing.T) {
	t.Parallel()
	checksum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	rpc := &fakeAriaRPC{
		status: aria2Status{
			GID:    "aabbccdd",
			Status: "error",
			Files: []aria2File{{
				Path: "/tmp/archive.zip",
				URIs: []aria2URI{{URI: "https://example.com/archive.zip"}},
			}},
		},
		addID: "eeff0011",
	}
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	newID, err := (&aria2Engine{rpc: rpc}).Retry(context.Background(), "aabbccdd", config, checksum)
	if err != nil {
		t.Fatal(err)
	}
	if newID != "eeff0011" {
		t.Fatalf("new id = %q", newID)
	}
	if rpc.lastOpts["checksum"] != "sha-256="+checksum {
		t.Fatalf("retry options = %#v", rpc.lastOpts)
	}
}

func TestAria2AddAndRetryReturnQueuedIDWithPersistenceError(t *testing.T) {
	t.Parallel()
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()

	addRPC := &fakeAriaRPC{
		addID:   "aabbccdd",
		saveErr: errors.New("session disk unavailable"),
	}
	addID, addErr := (&aria2Engine{rpc: addRPC}).Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/artifact.bin"},
	}, config)
	if addID != "aabbccdd" || !errors.Is(addErr, ErrQueueStateNotPersisted) {
		t.Fatalf("add id=%q err=%v", addID, addErr)
	}

	retryRPC := &fakeAriaRPC{
		status: aria2Status{
			GID:    "aabbccdd",
			Status: "error",
			Files: []aria2File{{
				Path: "/tmp/artifact.bin",
				URIs: []aria2URI{{URI: "https://example.com/artifact.bin"}},
			}},
		},
		addID:           "eeff0011",
		removeResultErr: errors.New("old result busy"),
	}
	retryID, retryErr := (&aria2Engine{rpc: retryRPC}).Retry(context.Background(), "aabbccdd", config, "")
	if retryID != "eeff0011" || !errors.Is(retryErr, ErrQueueStateNotPersisted) {
		t.Fatalf("retry id=%q err=%v", retryID, retryErr)
	}
	if got := strings.Join(retryRPC.methods, ","); got != "status,add,removeResult,save" {
		t.Fatalf("retry methods = %q", got)
	}
}

func TestAria2MutationAfterSaveFailureIsExplicitPartialSuccess(t *testing.T) {
	t.Parallel()
	rpc := &fakeAriaRPC{saveErr: errors.New("session disk unavailable")}
	engine := &aria2Engine{rpc: rpc}
	if err := engine.Pause(context.Background(), "aabbccdd"); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("pause error = %v", err)
	}
	if err := engine.Resume(context.Background(), "aabbccdd"); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("resume error = %v", err)
	}
}

func TestAria2StatusNeverExposesRawErrorTextOrSecretQuery(t *testing.T) {
	t.Parallel()
	job := mapAria2Status(aria2Status{
		GID:          "aabbccdd",
		Status:       "error",
		ErrorCode:    "3",
		ErrorMessage: "provider failed for https://example.com/file?signature=private-secret",
	})
	if strings.Contains(job.ErrorMessage, "example.com") || strings.Contains(job.ErrorMessage, "private-secret") {
		t.Fatalf("safe error message = %q", job.ErrorMessage)
	}
	if job.ErrorMessage != "aria2c reported transfer error code 3." {
		t.Fatalf("safe error message = %q", job.ErrorMessage)
	}
}

func TestAria2SuccessfulStatusDoesNotInventErrorZero(t *testing.T) {
	t.Parallel()
	job := mapAria2Status(aria2Status{
		GID:             "aabbccdd",
		Status:          "complete",
		ErrorCode:       "0",
		TotalLength:     "100",
		CompletedLength: "100",
	})
	if job.ErrorCode != "" || job.ErrorMessage != "" {
		t.Fatalf("successful job error evidence = %#v", job)
	}
}

type fakeManagedProcess struct {
	done chan struct{}
	once sync.Once
	mu   sync.RWMutex
	err  error
}

func newFakeManagedProcess() *fakeManagedProcess {
	return &fakeManagedProcess{done: make(chan struct{})}
}

func (process *fakeManagedProcess) Done() <-chan struct{} { return process.done }

func (process *fakeManagedProcess) Err() error {
	process.mu.RLock()
	defer process.mu.RUnlock()
	return process.err
}

func (process *fakeManagedProcess) Kill() error {
	process.exit(errors.New("killed"))
	return nil
}

func (process *fakeManagedProcess) exit(err error) {
	process.once.Do(func() {
		process.mu.Lock()
		process.err = err
		process.mu.Unlock()
		close(process.done)
	})
}

func TestAria2LauncherUsesPrivateSecretFileNotCommandLine(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = filepath.Join(directory, "downloads")
	paths := Paths{
		ConfigFile:       filepath.Join(directory, "transfers.json"),
		StateDirectory:   filepath.Join(directory, "state"),
		SessionFile:      filepath.Join(directory, "state", "session.aria2"),
		VerificationFile: filepath.Join(directory, "state", "verification.json"),
		LockFile:         filepath.Join(directory, "state", "engine.lock"),
	}
	process := newFakeManagedProcess()
	rpc := &fakeAriaRPC{version: "1.37.0"}
	var arguments []string
	var secretPath string
	var secretContents string
	launcher := NewAria2Launcher()
	launcher.resolve = func(string) (string, error) { return "/fake/aria2c", nil }
	launcher.reservePort = func() (int, error) { return 6800, nil }
	launcher.randomToken = func() (string, error) { return "secret-value", nil }
	launcher.startProcess = func(_ string, args []string, _, _ io.Writer) (managedProcess, error) {
		arguments = append([]string(nil), args...)
		for _, argument := range args {
			if strings.HasPrefix(argument, "--conf-path=") {
				secretPath = strings.TrimPrefix(argument, "--conf-path=")
				data, err := os.ReadFile(secretPath)
				if err != nil {
					t.Fatalf("read secret config during launch: %v", err)
				}
				secretContents = string(data)
			}
		}
		return process, nil
	}
	launcher.newRPC = func(endpoint, secret string) aria2RPC {
		if endpoint != "http://127.0.0.1:6800/jsonrpc" || secret != "secret-value" {
			t.Fatalf("rpc endpoint=%q secret=%q", endpoint, secret)
		}
		return rpc
	}
	launcher.pollInterval = time.Millisecond
	launcher.startupTimeout = 100 * time.Millisecond

	runtime, err := launcher.Start(context.Background(), config, paths)
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if runtime.EngineVersion != "1.37.0" || secretContents != "rpc-secret=secret-value\n" {
		t.Fatalf("runtime=%#v secret contents=%q", runtime, secretContents)
	}
	for _, argument := range arguments {
		if strings.Contains(argument, "secret-value") {
			t.Fatalf("RPC secret leaked into process arguments: %q", argument)
		}
	}
	if _, err := os.Stat(secretPath); !os.IsNotExist(err) {
		t.Fatalf("private startup config was not removed: %v", err)
	}
	process.exit(nil)
}

func TestAria2LauncherReportsEarlyProcessFailure(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = filepath.Join(directory, "downloads")
	paths := Paths{
		ConfigFile:       filepath.Join(directory, "transfers.json"),
		StateDirectory:   filepath.Join(directory, "state"),
		SessionFile:      filepath.Join(directory, "state", "session.aria2"),
		VerificationFile: filepath.Join(directory, "state", "verification.json"),
		LockFile:         filepath.Join(directory, "state", "engine.lock"),
	}
	process := newFakeManagedProcess()
	process.exit(errors.New("bad config"))
	launcher := NewAria2Launcher()
	launcher.resolve = func(string) (string, error) { return "/fake/aria2c", nil }
	launcher.reservePort = func() (int, error) { return 6800, nil }
	launcher.randomToken = func() (string, error) { return "secret-value", nil }
	launcher.startProcess = func(string, []string, io.Writer, io.Writer) (managedProcess, error) { return process, nil }
	launcher.newRPC = func(string, string) aria2RPC {
		return &fakeAriaRPC{versionErr: errors.New("connection refused")}
	}
	launcher.pollInterval = time.Millisecond
	launcher.startupTimeout = 100 * time.Millisecond

	if _, err := launcher.Start(context.Background(), config, paths); err == nil || !strings.Contains(err.Error(), "exited during startup") {
		t.Fatalf("startup error = %v", err)
	}
}

func TestConfiguredAria2PathDoesNotFallBackToBundle(t *testing.T) {
	t.Parallel()
	_, err := resolveAria2Binary(filepath.Join(t.TempDir(), "missing-aria2c"))
	if !errors.Is(err, ErrAria2NotFound) {
		t.Fatalf("resolve error = %v", err)
	}
}
