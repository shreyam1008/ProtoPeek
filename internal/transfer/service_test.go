package transfer

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeEngine struct {
	mu               sync.Mutex
	snapshot         EngineSnapshot
	snapshotErr      error
	addID            string
	addErr           error
	retryID          string
	retryErr         error
	pauseErr         error
	resumeErr        error
	cancelErr        error
	lastRetryRequest AddRequest
	lastAdd          AddRequest
	lastConfig       HostConfig
	calls            []string
}

func (engine *fakeEngine) Snapshot(context.Context, int) (EngineSnapshot, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.calls = append(engine.calls, "snapshot")
	return engine.snapshot, engine.snapshotErr
}

func (engine *fakeEngine) Add(_ context.Context, request AddRequest, config HostConfig) (string, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.calls = append(engine.calls, "add")
	engine.lastAdd = request
	engine.lastConfig = config
	return engine.addID, engine.addErr
}

func (engine *fakeEngine) Pause(context.Context, string) error {
	engine.record("pause")
	return engine.pauseErr
}

func (engine *fakeEngine) Resume(context.Context, string) error {
	engine.record("resume")
	return engine.resumeErr
}

func (engine *fakeEngine) Retry(_ context.Context, _ string, request AddRequest, _ HostConfig) (string, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.calls = append(engine.calls, "retry")
	engine.lastRetryRequest = cloneAddRequest(request)
	return engine.retryID, engine.retryErr
}

func (engine *fakeEngine) Cancel(context.Context, string) error {
	engine.record("cancel")
	return engine.cancelErr
}

func (engine *fakeEngine) SaveSession(context.Context) error { return nil }
func (engine *fakeEngine) Shutdown(context.Context) error    { return nil }

func (engine *fakeEngine) record(call string) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.calls = append(engine.calls, call)
}

type fakeLauncher struct {
	mu         sync.Mutex
	calls      int
	runtime    *Runtime
	err        error
	lastConfig HostConfig
	lastPaths  Paths
}

func (launcher *fakeLauncher) Start(_ context.Context, config HostConfig, paths Paths) (*Runtime, error) {
	launcher.mu.Lock()
	defer launcher.mu.Unlock()
	launcher.calls++
	launcher.lastConfig = config
	launcher.lastPaths = paths
	return launcher.runtime, launcher.err
}

type fakeLease struct {
	mu       sync.Mutex
	released int
}

func (lease *fakeLease) Release() error {
	lease.mu.Lock()
	defer lease.mu.Unlock()
	lease.released++
	return nil
}

func (lease *fakeLease) releases() int {
	lease.mu.Lock()
	defer lease.mu.Unlock()
	return lease.released
}

type fakeLocker struct {
	mu    sync.Mutex
	calls int
	lease *fakeLease
	err   error
}

func (locker *fakeLocker) TryLock(string) (Lock, error) {
	locker.mu.Lock()
	defer locker.mu.Unlock()
	locker.calls++
	return locker.lease, locker.err
}

type fakeRuntimeControl struct {
	done chan struct{}
	once sync.Once
	mu   sync.RWMutex
	err  error
}

func newFakeRuntime(engine Engine) (*Runtime, *fakeRuntimeControl) {
	control := &fakeRuntimeControl{done: make(chan struct{})}
	runtime := &Runtime{
		Engine:        engine,
		BinaryPath:    "/usr/bin/aria2c",
		EngineVersion: "1.37.0",
		Done:          control.done,
		Stop: func(context.Context) error {
			control.exit(nil)
			return nil
		},
		Err: control.Err,
	}
	return runtime, control
}

func (control *fakeRuntimeControl) exit(err error) {
	control.once.Do(func() {
		control.mu.Lock()
		control.err = err
		control.mu.Unlock()
		close(control.done)
	})
}

func (control *fakeRuntimeControl) Err() error {
	control.mu.RLock()
	defer control.mu.RUnlock()
	return control.err
}

func testService(t *testing.T, engine Engine) (*Service, *fakeLauncher, *fakeLocker, *fakeRuntimeControl, Paths) {
	t.Helper()
	directory := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = filepath.Join(directory, "downloads")
	config.MinimumFreeDiskBytes = 0
	if err := os.MkdirAll(config.DownloadDirectory, 0o755); err != nil {
		t.Fatalf("create test download directory: %v", err)
	}
	paths := Paths{
		ConfigFile:       filepath.Join(directory, "config", "transfers.json"),
		StateDirectory:   filepath.Join(directory, "state"),
		SessionFile:      filepath.Join(directory, "state", "session.aria2"),
		VerificationFile: filepath.Join(directory, "state", "verification.json"),
		LockFile:         filepath.Join(directory, "state", "engine.lock"),
	}
	runtime, control := newFakeRuntime(engine)
	launcher := &fakeLauncher{runtime: runtime}
	locker := &fakeLocker{lease: &fakeLease{}}
	service, err := NewServiceWithDependencies(config, paths, launcher, locker)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	// The service fixture models the normal persisted-config startup path. Tests
	// that need the disk-absent/defaults contract construct their own paths.
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatalf("save test config: %v", err)
	}
	return service, launcher, locker, control, paths
}

func TestSnapshotDoesNotLaunchOrWrite(t *testing.T) {
	t.Parallel()
	service, launcher, locker, _, paths := testService(t, &fakeEngine{})

	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snapshot.Health.Status != "stopped" || snapshot.Health.Ready {
		t.Fatalf("health = %#v", snapshot.Health)
	}
	if launcher.calls != 0 || locker.calls != 0 {
		t.Fatalf("read-only snapshot launched=%d locked=%d", launcher.calls, locker.calls)
	}
	if _, err := filepath.Glob(filepath.Join(paths.StateDirectory, "*")); err != nil {
		t.Fatal(err)
	}
	if exists, _ := pathExists(paths.StateDirectory); exists {
		t.Fatal("read-only snapshot created transfer state directory")
	}
}

func TestServiceExplicitLifecycleAndChecksumEvidence(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		addID:   "aabbccdd",
		retryID: "eeff0011",
		snapshot: EngineSnapshot{Jobs: []Job{{
			ID:           "aabbccdd",
			Verification: "unknown",
		}}},
	}
	service, _, locker, _, _ := testService(t, engine)
	if _, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/a"}}); !errors.Is(err, ErrEngineNotRunning) {
		t.Fatalf("add before start error = %v", err)
	}
	health, err := service.Start(context.Background())
	if err != nil || !health.Ready {
		t.Fatalf("start health=%#v err=%v", health, err)
	}

	checksum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	result, err := service.Add(context.Background(), AddRequest{
		Sources: []string{
			"https://example.com/archive.tar.zst?signature=secret#fragment",
			"https://example.com/archive.tar.zst?signature=secret#duplicate",
		},
		OutputName: "archive.tar.zst",
		SHA256:     checksum,
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if result.ID != "aabbccdd" || result.ExpectedSHA256 != checksum || result.Verification != "pending" {
		t.Fatalf("add result = %#v", result)
	}
	if len(engine.lastAdd.Sources) != 1 || engine.lastAdd.Sources[0] != "https://example.com/archive.tar.zst?signature=secret" {
		t.Fatalf("normalized sources = %#v", engine.lastAdd.Sources)
	}

	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if got := snapshot.Jobs[0]; got.ExpectedSHA256 != checksum || got.Verification != "pending" {
		t.Fatalf("checksum evidence = %#v", got)
	}

	for name, call := range map[string]func() error{
		"pause":  func() error { return service.Pause(context.Background(), "aabbccdd") },
		"resume": func() error { return service.Resume(context.Background(), "aabbccdd") },
	} {
		if err := call(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	retry, err := service.Retry(context.Background(), "aabbccdd")
	if err != nil || retry.ID != "eeff0011" || retry.ExpectedSHA256 != checksum {
		t.Fatalf("retry = %#v, err=%v", retry, err)
	}
	if engine.lastRetryRequest.SHA256 != checksum {
		t.Fatalf("retry request = %#v", engine.lastRetryRequest)
	}
	service.mu.RLock()
	_, oldChecksumStillTracked := service.checksums["aabbccdd"]
	newChecksum := service.checksums["eeff0011"]
	service.mu.RUnlock()
	if oldChecksumStillTracked || newChecksum != checksum {
		t.Fatalf("retry checksum tracking old=%v new=%q", oldChecksumStillTracked, newChecksum)
	}
	if err := service.Cancel(context.Background(), "aabbccdd"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := service.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if locker.lease.releases() != 1 {
		t.Fatalf("lock releases = %d", locker.lease.releases())
	}
}

func TestServiceTreatsCompletedChecksumJobAsVerifiedWithoutInventingDigest(t *testing.T) {
	t.Parallel()
	checksum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	secretHeader := "Bearer completed-job-secret"
	engine := &fakeEngine{
		addID: "aabbccdd",
		snapshot: EngineSnapshot{Jobs: []Job{{
			ID:           "aabbccdd",
			Status:       JobCompleted,
			Verification: "unknown",
		}}},
	}
	service, _, _, _, paths := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/a?token=completed-private"},
		SHA256:  checksum,
		Headers: []RequestHeader{{Name: "Authorization", Value: secretHeader}},
	}); err != nil {
		t.Fatal(err)
	}
	before, err := loadRetryState(filepath.Join(paths.StateDirectory, "retry.json"), service.config.MaxTrackedJobs)
	if err != nil || len(before) != 1 {
		t.Fatalf("retry state before completion cleanup = %#v, err=%v", before, err)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	job := snapshot.Jobs[0]
	if job.Verification != "verified" || job.ExpectedSHA256 != checksum || job.ActualSHA256 != "" || job.RetryAvailable {
		t.Fatalf("verification evidence = %#v", job)
	}
	service.mu.RLock()
	_, retainedInMemory := service.retryRequests["aabbccdd"]
	service.mu.RUnlock()
	if retainedInMemory {
		t.Fatal("completed job retained private retry metadata in memory")
	}
	after, err := loadRetryState(filepath.Join(paths.StateDirectory, "retry.json"), service.config.MaxTrackedJobs)
	if err != nil || len(after) != 0 {
		t.Fatalf("retry state after completion cleanup = %#v, err=%v", after, err)
	}
	encoded, err := os.ReadFile(filepath.Join(paths.StateDirectory, "retry.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secretHeader) || strings.Contains(string(encoded), "completed-private") {
		t.Fatal("completed job credentials remained in persisted retry metadata")
	}
}

func TestSnapshotRetriesCompletedRetryCleanupAfterTransientPersistenceFailure(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		addID: "aabbccdd",
		snapshot: EngineSnapshot{Jobs: []Job{{
			ID:     "aabbccdd",
			Status: JobCompleted,
		}}},
	}
	service, _, _, _, paths := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/private?token=retry-cleanup"},
		Headers: []RequestHeader{{Name: "Authorization", Value: "Bearer retry-cleanup-secret"}},
	}); err != nil {
		t.Fatal(err)
	}
	retryPath := filepath.Join(paths.StateDirectory, "retry.json")
	if err := os.Remove(retryPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(retryPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Snapshot(context.Background()); err == nil {
		t.Fatal("completed retry cleanup unexpectedly persisted through a directory target")
	}
	service.mu.RLock()
	_, retainedForRetry := service.retryRequests["aabbccdd"]
	service.mu.RUnlock()
	if !retainedForRetry {
		t.Fatal("failed cleanup did not retain in-memory metadata for a later retry")
	}
	if err := os.Remove(retryPath); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Snapshot(context.Background()); err != nil {
		t.Fatalf("retry completed metadata cleanup: %v", err)
	}
	service.mu.RLock()
	_, retainedAfterSuccess := service.retryRequests["aabbccdd"]
	service.mu.RUnlock()
	if retainedAfterSuccess {
		t.Fatal("successful retry cleanup retained in-memory metadata")
	}
	persisted, err := loadRetryState(retryPath, service.config.MaxTrackedJobs)
	if err != nil || len(persisted) != 0 {
		t.Fatalf("persisted retry state after retry cleanup = %#v, err=%v", persisted, err)
	}
}

func TestShutdownPrunesCompletedPrivateRetryMetadataBeforeStopping(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{addID: "aabbccdd"}
	service, _, _, _, paths := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/private?token=shutdown-cleanup"},
		Headers: []RequestHeader{{Name: "Authorization", Value: "Bearer shutdown-cleanup-secret"}},
	}); err != nil {
		t.Fatal(err)
	}
	engine.mu.Lock()
	engine.snapshot = EngineSnapshot{Jobs: []Job{{ID: "aabbccdd", Status: JobCompleted}}}
	engine.mu.Unlock()
	if err := service.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	persisted, err := loadRetryState(filepath.Join(paths.StateDirectory, "retry.json"), service.config.MaxTrackedJobs)
	if err != nil || len(persisted) != 0 {
		t.Fatalf("retry state after shutdown cleanup = %#v, err=%v", persisted, err)
	}
}

func TestServiceReleasesLockAfterStartFailure(t *testing.T) {
	t.Parallel()
	service, launcher, locker, _, _ := testService(t, &fakeEngine{})
	launcher.runtime = nil
	launcher.err = errors.New("boom")
	if _, err := service.Start(context.Background()); err == nil {
		t.Fatal("expected start failure")
	}
	if locker.lease.releases() != 1 {
		t.Fatalf("lock releases = %d", locker.lease.releases())
	}
}

func TestServiceRecordsUnexpectedProcessExit(t *testing.T) {
	t.Parallel()
	service, _, locker, control, _ := testService(t, &fakeEngine{})
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	control.exit(errors.New("process crashed"))

	deadline := time.Now().Add(time.Second)
	for {
		snapshot, err := service.Snapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Health.Status == "failed" {
			if locker.lease.releases() != 1 {
				t.Fatalf("lock releases = %d", locker.lease.releases())
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("health never observed crash: %#v", snapshot.Health)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCancelledShutdownKeepsLockUntilProcessExits(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{}
	service, launcher, locker, control, _ := testService(t, engine)
	launcher.runtime.Stop = func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := service.Shutdown(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown error = %v", err)
	}
	if locker.lease.releases() != 0 {
		t.Fatal("cancelled shutdown released the cross-process lock before process exit")
	}
	control.exit(nil)
	deadline := time.Now().Add(time.Second)
	for locker.lease.releases() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if locker.lease.releases() != 1 {
		t.Fatalf("lock releases after process exit = %d", locker.lease.releases())
	}
}

func TestServiceEnforcesQueueLimitBeforeAdd(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		addID: "aabbccdd",
		snapshot: EngineSnapshot{Metrics: Metrics{
			QueuedCount: defaultMaxQueuedJobs,
			TotalCount:  defaultMaxQueuedJobs,
		}},
	}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/a"}})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("queue error = %v", err)
	}
}

func TestServiceCountsPausedJobsAgainstPendingQueueLimit(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		addID: "aabbccdd",
		snapshot: EngineSnapshot{Metrics: Metrics{
			PausedCount: defaultMaxQueuedJobs,
			TotalCount:  defaultMaxQueuedJobs,
		}},
	}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/a"}})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("queue error = %v", err)
	}
	engine.mu.Lock()
	calls := strings.Join(engine.calls, ",")
	engine.mu.Unlock()
	if strings.Contains(calls, "add") {
		t.Fatalf("engine calls = %q", calls)
	}
}

func TestServiceUsesEngineWidePendingCountWhenJobsAreTruncated(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		addID: "aabbccdd",
		snapshot: EngineSnapshot{
			Jobs:         []Job{{ID: "00112233", Status: JobQueued}},
			PendingCount: defaultMaxQueuedJobs,
			Metrics:      Metrics{QueuedCount: 1, TotalCount: defaultMaxQueuedJobs},
		},
	}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/a"}}); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("queue error = %v", err)
	}
}

func TestServiceRetryEnforcesQueueDiskAndReplacementAwareTrackedBounds(t *testing.T) {
	t.Parallel()
	t.Run("pending queue", func(t *testing.T) {
		engine := &fakeEngine{
			retryID: "eeff0011",
			snapshot: EngineSnapshot{
				Jobs:    []Job{{ID: "aabbccdd", Status: JobFailed}},
				Metrics: Metrics{PausedCount: defaultMaxQueuedJobs, TotalCount: 1},
			},
		}
		service, _, _, _, _ := testService(t, engine)
		if _, err := service.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Retry(context.Background(), "aabbccdd"); !errors.Is(err, ErrQueueFull) {
			t.Fatalf("retry error = %v", err)
		}
	})

	t.Run("tracked replacement", func(t *testing.T) {
		engine := &fakeEngine{
			retryID: "eeff0011",
			snapshot: EngineSnapshot{
				Jobs:    []Job{{ID: "aabbccdd", Status: JobFailed}},
				Metrics: Metrics{TotalCount: 4},
			},
		}
		service, _, _, _, _ := testService(t, engine)
		service.mu.Lock()
		service.config.MaxQueuedJobs = 4
		service.config.MaxTrackedJobs = 4
		config := service.config
		service.mu.Unlock()
		if err := NewConfigStore(service.paths.ConfigFile).Save(config); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
		service.mu.Lock()
		service.retryRequests["aabbccdd"] = AddRequest{Sources: []string{"https://example.com/retry"}}
		service.mu.Unlock()
		if _, err := service.Retry(context.Background(), "aabbccdd"); err != nil {
			t.Fatalf("replacement retry error = %v", err)
		}
	})

	t.Run("untracked result at tracked cap", func(t *testing.T) {
		engine := &fakeEngine{
			retryID: "eeff0011",
			snapshot: EngineSnapshot{
				Jobs:    []Job{{ID: "00112233", Status: JobFailed}},
				Metrics: Metrics{TotalCount: 4},
			},
		}
		service, _, _, _, _ := testService(t, engine)
		service.mu.Lock()
		service.config.MaxQueuedJobs = 4
		service.config.MaxTrackedJobs = 4
		config := service.config
		service.mu.Unlock()
		if err := NewConfigStore(service.paths.ConfigFile).Save(config); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Retry(context.Background(), "aabbccdd"); !errors.Is(err, ErrQueueFull) {
			t.Fatalf("retry error = %v", err)
		}
	})

	t.Run("disk reserve", func(t *testing.T) {
		engine := &fakeEngine{
			retryID: "eeff0011",
			snapshot: EngineSnapshot{
				Jobs:    []Job{{ID: "aabbccdd", Status: JobFailed}},
				Metrics: Metrics{TotalCount: 1},
			},
		}
		service, _, _, _, _ := testService(t, engine)
		service.mu.Lock()
		service.config.MinimumFreeDiskBytes = maxMinimumFreeDiskBytes
		config := service.config
		service.mu.Unlock()
		if err := NewConfigStore(service.paths.ConfigFile).Save(config); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
		service.mu.Lock()
		service.retryRequests["aabbccdd"] = AddRequest{Sources: []string{"https://example.com/retry"}}
		service.mu.Unlock()
		if _, err := service.Retry(context.Background(), "aabbccdd"); !errors.Is(err, ErrInsufficientDisk) {
			t.Fatalf("retry error = %v", err)
		}
	})
}

func TestServiceCancelTreatsPostMutationPersistenceFailureAsPartialSuccess(t *testing.T) {
	t.Parallel()
	checksum := strings.Repeat("ab", expectedSHA256Bytes)
	engine := &fakeEngine{addID: "aabbccdd"}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/a"},
		SHA256:  checksum,
	}); err != nil {
		t.Fatal(err)
	}
	engine.cancelErr = fmt.Errorf("%w: injected save failure", ErrQueueStateNotPersisted)
	if err := service.Cancel(context.Background(), "aabbccdd"); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("cancel error = %v", err)
	}
	service.mu.RLock()
	_, stillTracked := service.checksums["aabbccdd"]
	service.mu.RUnlock()
	if stillTracked {
		t.Fatal("cancelled job checksum remained tracked")
	}
}

func TestValidateAddRequestRejectsUnsafeInputs(t *testing.T) {
	t.Parallel()
	for _, request := range []AddRequest{
		{},
		{Sources: []string{"file:///etc/passwd"}},
		{Sources: []string{"https://user:password@example.com/file"}},
		{Sources: []string{"https://example.com/file"}, OutputName: "../file"},
		{Sources: []string{"https://example.com/file"}, SHA256: "short"},
	} {
		if _, err := validateAddRequest(request); err == nil {
			t.Fatalf("request should fail: %#v", request)
		}
	}
}

func TestServiceClassifiesInvalidAddRequest(t *testing.T) {
	t.Parallel()
	service, _, _, _, _ := testService(t, &fakeEngine{})
	_, err := service.Add(context.Background(), AddRequest{Sources: []string{"file:///etc/passwd"}})
	if !errors.Is(err, ErrInvalidAddRequest) {
		t.Fatalf("error = %v", err)
	}
}

func TestServiceRestoresChecksumEvidenceAndReappliesItOnRetry(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = filepath.Join(root, "downloads")
	config.MinimumFreeDiskBytes = 0
	if err := os.MkdirAll(config.DownloadDirectory, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := Paths{
		ConfigFile:       filepath.Join(root, "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	checksum := strings.Repeat("ab", expectedSHA256Bytes)
	customDirectory := filepath.Join(root, "custom-downloads")
	if err := os.MkdirAll(customDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	secretHeader := "Bearer retry-private-value"

	firstEngine := &fakeEngine{addID: "aabbccdd"}
	firstService, _, _ := newServiceForPaths(t, config, paths, firstEngine)
	if _, err := firstService.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := firstService.Add(context.Background(), AddRequest{
		Sources:              []string{"https://example.com/artifact.bin?signature=private"},
		SHA256:               checksum,
		DestinationDirectory: customDirectory,
		UserAgent:            "ProtoPeek retry test",
		Headers:              []RequestHeader{{Name: "Authorization", Value: secretHeader}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := firstService.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}

	secondEngine := &fakeEngine{
		retryID: "eeff0011",
		snapshot: EngineSnapshot{Jobs: []Job{{
			ID:           "aabbccdd",
			Status:       JobFailed,
			Verification: "unknown",
		}}},
	}
	secondService, _, _ := newServiceForPaths(t, config, paths, secondEngine)
	if _, err := secondService.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	snapshot, err := secondService.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].ExpectedSHA256 != checksum || snapshot.Jobs[0].Verification != "pending" || !snapshot.Jobs[0].RetryAvailable {
		t.Fatalf("restored snapshot = %#v", snapshot.Jobs)
	}
	if encoded := fmt.Sprintf("%#v", snapshot); strings.Contains(encoded, secretHeader) || strings.Contains(encoded, "signature=private") {
		t.Fatalf("snapshot exposed private retry metadata: %s", encoded)
	}
	retry, err := secondService.Retry(context.Background(), "aabbccdd")
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != "eeff0011" || retry.ExpectedSHA256 != checksum || secondEngine.lastRetryRequest.SHA256 != checksum {
		t.Fatalf("retry=%#v engine request=%#v", retry, secondEngine.lastRetryRequest)
	}
	if secondEngine.lastRetryRequest.DestinationDirectory != customDirectory || secondEngine.lastRetryRequest.UserAgent != "ProtoPeek retry test" || len(secondEngine.lastRetryRequest.Headers) != 1 || secondEngine.lastRetryRequest.Headers[0].Value != secretHeader {
		t.Fatalf("retry did not preserve private per-job options: %#v", secondEngine.lastRetryRequest)
	}
	loaded, err := loadVerificationState(paths.VerificationFile, config.MaxTrackedJobs)
	if err != nil {
		t.Fatal(err)
	}
	if _, oldExists := loaded["aabbccdd"]; oldExists || loaded["eeff0011"] != checksum {
		t.Fatalf("moved verification state = %#v", loaded)
	}
	if err := secondService.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestServiceDisablesRetryWhenExactPrivateMetadataIsUnavailable(t *testing.T) {
	t.Parallel()
	engine := &fakeEngine{
		retryID: "eeff0011",
		snapshot: EngineSnapshot{Jobs: []Job{{
			ID:     "aabbccdd",
			Status: JobFailed,
		}}},
	}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].RetryAvailable || snapshot.Jobs[0].RetryReason == "" {
		t.Fatalf("retry evidence = %#v", snapshot.Jobs)
	}
	if _, err := service.Retry(context.Background(), "aabbccdd"); !errors.Is(err, ErrRetryMetadataMissing) {
		t.Fatalf("retry error = %v", err)
	}
}

func TestServiceReturnsQueuedIDWithPersistenceWarning(t *testing.T) {
	t.Parallel()
	checksum := strings.Repeat("cd", expectedSHA256Bytes)
	engine := &fakeEngine{
		addID:  "aabbccdd",
		addErr: fmt.Errorf("%w: injected session failure", ErrQueueStateNotPersisted),
	}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	result, err := service.Add(context.Background(), AddRequest{
		Sources: []string{"https://example.com/artifact.bin?token=private"},
		SHA256:  checksum,
	})
	if err != nil {
		t.Fatalf("queued partial success returned failure: %v", err)
	}
	if result.ID != "aabbccdd" || result.PersistenceWarning == "" {
		t.Fatalf("add result = %#v", result)
	}
	service.mu.RLock()
	tracked := service.checksums[result.ID]
	service.mu.RUnlock()
	if tracked != checksum {
		t.Fatalf("tracked checksum = %q", tracked)
	}
}

func TestServiceSerializesAddsAcrossCapacityCheckAndAdmission(t *testing.T) {
	engine := newBlockingBoundEngine()
	service, _, _, _, _ := testService(t, engine)
	service.mu.Lock()
	service.config.MaxQueuedJobs = 1
	service.config.MaxTrackedJobs = 4
	config := service.config
	service.mu.Unlock()
	if err := NewConfigStore(service.paths.ConfigFile).Save(config); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}

	results := make(chan error, 2)
	go func() {
		_, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/one"}})
		results <- err
	}()
	<-engine.firstAddStarted
	<-engine.snapshotObserved
	go func() {
		_, err := service.Add(context.Background(), AddRequest{Sources: []string{"https://example.com/two"}})
		results <- err
	}()

	secondCheckBeforeFirstAdmissionFinished := false
	select {
	case <-engine.snapshotObserved:
		secondCheckBeforeFirstAdmissionFinished = true
	case <-time.After(100 * time.Millisecond):
	}
	close(engine.releaseFirstAdd)
	firstErr := <-results
	secondErr := <-results
	if secondCheckBeforeFirstAdmissionFinished {
		t.Fatal("second add crossed the capacity check while the first admission was still in progress")
	}
	if (firstErr == nil) == (secondErr == nil) {
		t.Fatalf("add errors = %v, %v; want exactly one admitted", firstErr, secondErr)
	}
	if !errors.Is(firstErr, ErrQueueFull) && !errors.Is(secondErr, ErrQueueFull) {
		t.Fatalf("add errors = %v, %v; want ErrQueueFull", firstErr, secondErr)
	}
	engine.mu.Lock()
	addCalls := engine.addCalls
	engine.mu.Unlock()
	if addCalls != 1 {
		t.Fatalf("engine add calls = %d", addCalls)
	}
}

func newServiceForPaths(t *testing.T, config HostConfig, paths Paths, engine Engine) (*Service, *fakeRuntimeControl, *fakeLocker) {
	t.Helper()
	runtime, control := newFakeRuntime(engine)
	locker := &fakeLocker{lease: &fakeLease{}}
	service, err := NewServiceWithDependencies(config, paths, &fakeLauncher{runtime: runtime}, locker)
	if err != nil {
		t.Fatal(err)
	}
	return service, control, locker
}

type blockingBoundEngine struct {
	mu sync.Mutex

	queued            int
	addCalls          int
	snapshotObserved  chan struct{}
	firstAddStarted   chan struct{}
	releaseFirstAdd   chan struct{}
	firstAddStartOnce sync.Once
}

func newBlockingBoundEngine() *blockingBoundEngine {
	return &blockingBoundEngine{
		snapshotObserved: make(chan struct{}, 4),
		firstAddStarted:  make(chan struct{}),
		releaseFirstAdd:  make(chan struct{}),
	}
}

func (engine *blockingBoundEngine) Snapshot(context.Context, int) (EngineSnapshot, error) {
	engine.mu.Lock()
	queued := engine.queued
	engine.mu.Unlock()
	engine.snapshotObserved <- struct{}{}
	return EngineSnapshot{Metrics: Metrics{QueuedCount: queued, TotalCount: queued}}, nil
}

func (engine *blockingBoundEngine) Add(context.Context, AddRequest, HostConfig) (string, error) {
	engine.mu.Lock()
	engine.addCalls++
	call := engine.addCalls
	engine.mu.Unlock()
	if call == 1 {
		engine.firstAddStartOnce.Do(func() { close(engine.firstAddStarted) })
		<-engine.releaseFirstAdd
	}
	engine.mu.Lock()
	engine.queued++
	engine.mu.Unlock()
	return "aabbccdd", nil
}

func (*blockingBoundEngine) Pause(context.Context, string) error  { return nil }
func (*blockingBoundEngine) Resume(context.Context, string) error { return nil }
func (*blockingBoundEngine) Retry(context.Context, string, AddRequest, HostConfig) (string, error) {
	return "eeff0011", nil
}
func (*blockingBoundEngine) Cancel(context.Context, string) error { return nil }
func (*blockingBoundEngine) SaveSession(context.Context) error    { return nil }
func (*blockingBoundEngine) Shutdown(context.Context) error       { return nil }

func pathExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}
