package transfer

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrAlreadyStarting        = errors.New("transfer engine is already starting")
	ErrEngineNotRunning       = errors.New("transfer engine is not running; start it explicitly first")
	ErrInvalidAddRequest      = errors.New("invalid transfer add request")
	ErrQueueFull              = errors.New("transfer queue limit reached")
	ErrInsufficientDisk       = errors.New("download directory is below the configured free-space reserve")
	ErrQueueStateNotPersisted = errors.New("queued transfer state could not be fully persisted")
)

type Service struct {
	operationMu sync.Mutex
	queueMu     sync.Mutex
	mu          sync.RWMutex

	config   HostConfig
	paths    Paths
	launcher Launcher
	locker   Locker
	now      func() time.Time

	starting  bool
	stopping  bool
	runtime   *Runtime
	lease     Lock
	health    Health
	checksums map[string]string
}

func NewService(config HostConfig, paths Paths) (*Service, error) {
	return NewServiceWithDependencies(config, paths, NewAria2Launcher(), FileLocker{})
}

func NewServiceWithDependencies(config HostConfig, paths Paths, launcher Launcher, locker Locker) (*Service, error) {
	if err := ValidateHostConfig(config); err != nil {
		return nil, err
	}
	if err := ValidatePaths(paths); err != nil {
		return nil, err
	}
	if launcher == nil {
		return nil, errors.New("transfer launcher is required")
	}
	if locker == nil {
		return nil, errors.New("transfer locker is required")
	}
	return &Service{
		config:   config,
		paths:    paths,
		launcher: launcher,
		locker:   locker,
		now:      time.Now,
		health: Health{
			Status:  "stopped",
			Message: "Downloader is stopped. Start it when you need it.",
		},
		checksums: make(map[string]string),
	}, nil
}

// Configure replaces host-owned settings only while the engine is stopped.
// Persisting the config remains an explicit ConfigStore.Save operation.
func (service *Service) Configure(config HostConfig) error {
	if err := ValidateHostConfig(config); err != nil {
		return err
	}
	service.operationMu.Lock()
	defer service.operationMu.Unlock()

	service.mu.Lock()
	defer service.mu.Unlock()
	if service.starting || service.runtime != nil {
		return errors.New("stop the transfer engine before changing host configuration")
	}
	service.config = config
	return nil
}

// Snapshot is observational: it never creates directories, acquires the
// process lock, resolves aria2c, or starts a subprocess.
func (service *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	service.mu.RLock()
	runtime := service.runtime
	config := service.config
	health := service.health
	service.mu.RUnlock()

	snapshot := Snapshot{
		ObservedAt: service.now().UTC(),
		Health:     health,
		Config:     config,
		Jobs:       []Job{},
	}
	if runtime == nil {
		return snapshot, nil
	}

	engineSnapshot, err := runtime.Engine.Snapshot(ctx, config.MaxTrackedJobs)
	if err != nil {
		snapshot.Health.Ready = false
		snapshot.Health.Status = "unavailable"
		snapshot.Health.Message = fmt.Sprintf("aria2c is running but its local RPC is unavailable: %v", err)
		return snapshot, err
	}
	snapshot.Jobs = engineSnapshot.Jobs
	service.mu.RLock()
	for index := range snapshot.Jobs {
		expected, known := service.checksums[snapshot.Jobs[index].ID]
		if !known {
			continue
		}
		snapshot.Jobs[index].ExpectedSHA256 = expected
		if expected == "" {
			snapshot.Jobs[index].Verification = "not_requested"
			snapshot.Jobs[index].VerifyMessage = "No checksum was supplied for this transfer."
			continue
		}
		switch snapshot.Jobs[index].Verification {
		case "verified", "verifying", "failed":
		default:
			if snapshot.Jobs[index].Status == JobCompleted {
				snapshot.Jobs[index].Verification = "verified"
				snapshot.Jobs[index].VerifyMessage = "aria2c completed the transfer after enforcing the expected SHA-256; it does not expose the computed digest."
			} else {
				snapshot.Jobs[index].Verification = "pending"
				snapshot.Jobs[index].VerifyMessage = "aria2c will verify the expected SHA-256 after the download completes."
			}
		}
	}
	service.mu.RUnlock()
	snapshot.Metrics = engineSnapshot.Metrics
	return snapshot, nil
}

func (service *Service) Start(ctx context.Context) (Health, error) {
	service.operationMu.Lock()
	defer service.operationMu.Unlock()

	service.mu.Lock()
	if service.runtime != nil {
		health := service.health
		service.mu.Unlock()
		return health, nil
	}
	if service.starting {
		service.mu.Unlock()
		return Health{}, ErrAlreadyStarting
	}
	config := service.config
	paths := service.paths
	service.starting = true
	service.health = Health{Status: "starting", Message: "Starting the configured aria2c engine."}
	service.mu.Unlock()

	fail := func(status, message string, err error) (Health, error) {
		health := Health{Status: status, Message: message}
		service.mu.Lock()
		service.starting = false
		service.health = health
		service.mu.Unlock()
		return health, err
	}

	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return fail("failed", "Could not create the private transfer state directory.", fmt.Errorf("create transfer state directory: %w", err))
	}
	lease, err := service.locker.TryLock(paths.LockFile)
	if err != nil {
		status := "failed"
		message := "Could not acquire the transfer engine lock."
		if errors.Is(err, ErrLockHeld) {
			status = "locked"
			message = "Another ProtoPeek process already owns the transfer engine."
		}
		return fail(status, message, err)
	}
	restoredChecksums, err := loadVerificationState(paths.VerificationFile, config.MaxTrackedJobs)
	if err != nil {
		_ = lease.Release()
		return fail("failed", "Saved checksum evidence could not be loaded safely.", err)
	}

	runtime, err := service.launcher.Start(ctx, config, paths)
	if err != nil {
		_ = lease.Release()
		status := "failed"
		message := "aria2c could not be started."
		if errors.Is(err, ErrAria2NotFound) {
			status = "binary_missing"
			message = "aria2c was not found. Install it or configure its executable path."
		}
		return fail(status, message, err)
	}
	if err := validateRuntime(runtime); err != nil {
		if runtime != nil && runtime.Stop != nil {
			stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_ = runtime.Stop(stopCtx)
			cancel()
		}
		_ = lease.Release()
		return fail("failed", "aria2c returned an invalid runtime.", err)
	}

	health := Health{
		Ready:         true,
		Status:        "running",
		Message:       "Downloader is ready.",
		BinaryPath:    runtime.BinaryPath,
		EngineVersion: runtime.EngineVersion,
	}
	service.mu.Lock()
	service.starting = false
	service.runtime = runtime
	service.lease = lease
	service.health = health
	service.checksums = restoredChecksums
	service.mu.Unlock()

	go service.monitor(runtime)
	return health, nil
}

func (service *Service) Add(ctx context.Context, request AddRequest) (AddResult, error) {
	request, err := validateAddRequest(request)
	if err != nil {
		return AddResult{}, fmt.Errorf("%w: %v", ErrInvalidAddRequest, err)
	}
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, config, err := service.running()
	if err != nil {
		return AddResult{}, err
	}

	engineSnapshot, err := runtime.Engine.Snapshot(ctx, config.MaxTrackedJobs)
	if err != nil {
		return AddResult{}, fmt.Errorf("inspect transfer queue before add: %w", err)
	}
	pendingCount := pendingJobs(engineSnapshot)
	trackedCount := max(engineSnapshot.Metrics.TotalCount, len(engineSnapshot.Jobs))
	if pendingCount >= config.MaxQueuedJobs || trackedCount >= config.MaxTrackedJobs {
		return AddResult{}, ErrQueueFull
	}

	free, err := availableDiskBytes(config.DownloadDirectory)
	if err != nil {
		return AddResult{}, fmt.Errorf("inspect free disk space: %w", err)
	}
	if free < uint64(config.MinimumFreeDiskBytes) {
		return AddResult{}, ErrInsufficientDisk
	}

	id, queueErr := runtime.Engine.Add(ctx, request, config)
	if id == "" || (queueErr != nil && !errors.Is(queueErr, ErrQueueStateNotPersisted)) {
		if queueErr == nil {
			queueErr = errors.New("transfer engine returned an empty job id")
		}
		return AddResult{}, queueErr
	}
	if !validJobID(id) {
		return AddResult{}, errors.New("transfer engine returned an invalid job id")
	}
	service.mu.Lock()
	service.reconcileChecksumsLocked(engineSnapshot.Jobs)
	service.checksums[id] = request.SHA256
	checksums := cloneChecksums(service.checksums)
	service.mu.Unlock()
	stateErr := saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs)
	warning := ""
	if queueErr != nil || stateErr != nil {
		warning = PersistenceWarningMessage
	}
	verification := "not_requested"
	if request.SHA256 != "" {
		verification = "pending"
	}
	return AddResult{
		ID:                 id,
		ExpectedSHA256:     request.SHA256,
		Verification:       verification,
		PersistenceWarning: warning,
	}, nil
}

func (service *Service) Pause(ctx context.Context, id string) error {
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, _, err := service.runningWithID(id)
	if err != nil {
		return err
	}
	return runtime.Engine.Pause(ctx, id)
}

func (service *Service) Resume(ctx context.Context, id string) error {
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, _, err := service.runningWithID(id)
	if err != nil {
		return err
	}
	return runtime.Engine.Resume(ctx, id)
}

func (service *Service) Retry(ctx context.Context, id string) (AddResult, error) {
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, config, err := service.runningWithID(id)
	if err != nil {
		return AddResult{}, err
	}
	engineSnapshot, err := runtime.Engine.Snapshot(ctx, config.MaxTrackedJobs)
	if err != nil {
		return AddResult{}, fmt.Errorf("inspect transfer queue before retry: %w", err)
	}
	pendingCount := pendingJobs(engineSnapshot)
	trackedAfterReplacement := max(engineSnapshot.Metrics.TotalCount, len(engineSnapshot.Jobs))
	for _, job := range engineSnapshot.Jobs {
		if job.ID == id {
			trackedAfterReplacement--
			break
		}
	}
	if pendingCount >= config.MaxQueuedJobs || trackedAfterReplacement >= config.MaxTrackedJobs {
		return AddResult{}, ErrQueueFull
	}
	free, err := availableDiskBytes(config.DownloadDirectory)
	if err != nil {
		return AddResult{}, fmt.Errorf("inspect free disk space before retry: %w", err)
	}
	if free < uint64(config.MinimumFreeDiskBytes) {
		return AddResult{}, ErrInsufficientDisk
	}
	service.mu.RLock()
	expected, known := service.checksums[id]
	service.mu.RUnlock()
	newID, queueErr := runtime.Engine.Retry(ctx, id, config, expected)
	if newID == "" || (queueErr != nil && !errors.Is(queueErr, ErrQueueStateNotPersisted)) {
		if queueErr == nil {
			queueErr = errors.New("transfer engine returned an empty retry job id")
		}
		return AddResult{}, queueErr
	}
	if !validJobID(newID) {
		return AddResult{}, errors.New("transfer engine returned an invalid retry job id")
	}
	service.mu.Lock()
	if known {
		delete(service.checksums, id)
		service.checksums[newID] = expected
	}
	checksums := cloneChecksums(service.checksums)
	service.mu.Unlock()
	stateErr := saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs)
	verification := "unknown"
	if known {
		verification = "not_requested"
		if expected != "" {
			verification = "pending"
		}
	}
	warning := ""
	if queueErr != nil || stateErr != nil {
		warning = PersistenceWarningMessage
	}
	return AddResult{
		ID:                 newID,
		ExpectedSHA256:     expected,
		Verification:       verification,
		PersistenceWarning: warning,
	}, nil
}

// Cancel removes the aria2 queue/result record only. It never removes output
// or partial files from disk.
func (service *Service) Cancel(ctx context.Context, id string) error {
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, config, err := service.runningWithID(id)
	if err != nil {
		return err
	}
	engineErr := runtime.Engine.Cancel(ctx, id)
	if engineErr != nil && !errors.Is(engineErr, ErrQueueStateNotPersisted) {
		return engineErr
	}
	service.mu.Lock()
	delete(service.checksums, id)
	checksums := cloneChecksums(service.checksums)
	service.mu.Unlock()
	stateErr := saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs)
	if engineErr != nil || stateErr != nil {
		return fmt.Errorf("%w: cancel state was not fully persisted", ErrQueueStateNotPersisted)
	}
	return nil
}

func (service *Service) Shutdown(ctx context.Context) error {
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()

	service.mu.Lock()
	runtime := service.runtime
	if runtime == nil {
		service.starting = false
		service.stopping = false
		service.health = Health{Status: "stopped", Message: "Downloader is stopped."}
		service.mu.Unlock()
		return nil
	}
	service.stopping = true
	service.health = Health{Status: "stopping", Message: "Saving the transfer session and stopping aria2c."}
	service.mu.Unlock()

	err := runtime.Stop(ctx)
	select {
	case <-runtime.Done:
		service.finishRuntime(runtime, true)
	default:
		// Runtime.Stop may return because the caller cancelled while its bounded
		// cleanup continues. Keep the process lock until monitor observes exit.
	}
	return err
}

func (service *Service) reconcileChecksumsLocked(jobs []Job) {
	seen := make(map[string]struct{}, len(jobs))
	for _, job := range jobs {
		seen[job.ID] = struct{}{}
	}
	for id := range service.checksums {
		if _, exists := seen[id]; !exists {
			delete(service.checksums, id)
		}
	}
}

func cloneChecksums(checksums map[string]string) map[string]string {
	cloned := make(map[string]string, len(checksums))
	for id, checksum := range checksums {
		cloned[id] = checksum
	}
	return cloned
}

func pendingJobs(snapshot EngineSnapshot) int {
	return max(snapshot.PendingCount, snapshot.Metrics.QueuedCount+snapshot.Metrics.PausedCount)
}

func (service *Service) monitor(runtime *Runtime) {
	<-runtime.Done
	service.finishRuntime(runtime, false)
}

func (service *Service) finishRuntime(runtime *Runtime, requested bool) {
	service.mu.Lock()
	if service.runtime != runtime {
		service.mu.Unlock()
		return
	}
	lease := service.lease
	wasStopping := service.stopping || requested
	service.runtime = nil
	service.lease = nil
	service.stopping = false
	err := runtime.Err()
	if wasStopping || err == nil {
		service.health = Health{Status: "stopped", Message: "Downloader is stopped."}
	} else {
		service.health = Health{Status: "failed", Message: fmt.Sprintf("aria2c exited unexpectedly: %v", err)}
	}
	service.mu.Unlock()
	if lease != nil {
		_ = lease.Release()
	}
}

func (service *Service) running() (*Runtime, HostConfig, error) {
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.runtime == nil || service.stopping {
		return nil, HostConfig{}, ErrEngineNotRunning
	}
	return service.runtime, service.config, nil
}

func (service *Service) runningWithID(id string) (*Runtime, HostConfig, error) {
	if !validJobID(id) {
		return nil, HostConfig{}, errors.New("invalid transfer job id")
	}
	return service.running()
}

func validateRuntime(runtime *Runtime) error {
	if runtime == nil || runtime.Engine == nil || runtime.Done == nil || runtime.Stop == nil || runtime.Err == nil {
		return errors.New("launcher returned an incomplete transfer runtime")
	}
	return nil
}

func validateAddRequest(request AddRequest) (AddRequest, error) {
	if len(request.Sources) == 0 || len(request.Sources) > maxSourcesPerAdd {
		return AddRequest{}, fmt.Errorf("one to %d source URLs are required", maxSourcesPerAdd)
	}
	seen := make(map[string]struct{}, len(request.Sources))
	sources := make([]string, 0, len(request.Sources))
	for _, raw := range request.Sources {
		raw = strings.TrimSpace(raw)
		if raw == "" || len(raw) > maxSourceLength || containsControl(raw) {
			return AddRequest{}, errors.New("source URL is empty, too long, or contains a line break")
		}
		parsed, err := url.Parse(raw)
		if err != nil || !parsed.IsAbs() || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
			return AddRequest{}, errors.New("source URLs must be absolute HTTP or HTTPS URLs without user information")
		}
		parsed.Fragment = ""
		normalized := parsed.String()
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		sources = append(sources, normalized)
	}
	if len(sources) == 0 {
		return AddRequest{}, errors.New("at least one unique source URL is required")
	}

	request.OutputName = strings.TrimSpace(request.OutputName)
	if request.OutputName != "" {
		if len(request.OutputName) > 255 || request.OutputName == "." || request.OutputName == ".." || filepath.Base(request.OutputName) != request.OutputName || strings.ContainsAny(request.OutputName, "/\\") || containsControl(request.OutputName) {
			return AddRequest{}, errors.New("output name must be a single safe file name")
		}
	}

	request.SHA256 = strings.ToLower(strings.TrimSpace(request.SHA256))
	if request.SHA256 != "" {
		decoded, err := hex.DecodeString(request.SHA256)
		if err != nil || len(decoded) != 32 {
			return AddRequest{}, errors.New("sha256 must contain exactly 64 hexadecimal characters")
		}
	}
	request.Sources = sources
	return request, nil
}

func validJobID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, character := range id {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}

func containsControl(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
