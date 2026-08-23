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
	ErrInvalidHostConfig      = errors.New("invalid transfer host configuration")
	ErrHostConfigRunning      = errors.New("stop the transfer engine before changing host configuration")
	ErrHostConfigConflict     = errors.New("transfer host configuration changed; reload before saving")
	ErrHostConfigRevision     = errors.New("transfer host configuration revision is invalid")
	ErrInvalidAddRequest      = errors.New("invalid transfer add request")
	ErrQueueFull              = errors.New("transfer queue limit reached")
	ErrInsufficientDisk       = errors.New("download directory is below the configured free-space reserve")
	ErrQueueStateNotPersisted = errors.New("queued transfer state could not be fully persisted")
	ErrRetryMetadataMissing   = errors.New("exact retry metadata is unavailable; queue a new job with its required options")
)

type Service struct {
	operationMu sync.Mutex
	queueMu     sync.Mutex
	mu          sync.RWMutex

	config         HostConfig
	configRevision string
	paths          Paths
	configStore    *ConfigStore
	launcher       Launcher
	locker         Locker
	now            func() time.Time

	starting      bool
	stopping      bool
	runtime       *Runtime
	lease         Lock
	health        Health
	checksums     map[string]string
	retryRequests map[string]AddRequest
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
		config:         config,
		configRevision: HostConfigRevision(config),
		paths:          paths,
		configStore:    NewConfigStore(paths.ConfigFile),
		launcher:       launcher,
		locker:         locker,
		now:            time.Now,
		health: Health{
			Status:  "stopped",
			Message: "Downloader is stopped. Start it when you need it.",
		},
		checksums:     make(map[string]string),
		retryRequests: make(map[string]AddRequest),
	}, nil
}

// Configure updates the process-local config for migration setup and tests.
// Browser host-settings writes must use ConfigureAndSavePatch so they retain
// hidden fields and participate in revision/lock checks.
func (service *Service) Configure(config HostConfig) error {
	if err := ValidateHostConfig(config); err != nil {
		return err
	}
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.mu.Lock()
	defer service.mu.Unlock()
	if service.starting || service.stopping || service.runtime != nil {
		return ErrHostConfigRunning
	}
	service.config = config
	service.configRevision = HostConfigRevision(config)
	return nil
}

// ConfigureAndSavePatch applies only the allowlisted browser host settings.
// The current config is reloaded while holding the cross-process engine lock,
// then compared with expectedRevision before any write. Unsupported fields
// therefore survive another process's patch and stale browser drafts cannot
// overwrite newer disk state.
func (service *Service) ConfigureAndSavePatch(expectedRevision string, patch HostConfigPatch) (HostConfig, string, error) {
	if err := ValidateHostConfigPatch(patch); err != nil {
		return HostConfig{}, "", fmt.Errorf("%w: %v", ErrInvalidHostConfig, err)
	}
	if err := ValidateHostConfigRevision(expectedRevision); err != nil {
		return HostConfig{}, "", err
	}

	service.operationMu.Lock()
	defer service.operationMu.Unlock()

	service.mu.RLock()
	running := service.starting || service.stopping || service.runtime != nil
	store := service.configStore
	paths := service.paths
	service.mu.RUnlock()
	if running {
		return HostConfig{}, "", ErrHostConfigRunning
	}
	lease, err := service.locker.TryLock(paths.LockFile)
	if err != nil {
		return HostConfig{}, "", fmt.Errorf("acquire transfer config lock: %w", err)
	}
	if lease == nil {
		return HostConfig{}, "", errors.New("acquire transfer config lock: locker returned no lease")
	}
	defer func() { _ = lease.Release() }()
	if store == nil {
		store = NewConfigStore(paths.ConfigFile)
	}
	current, _, currentRevision, err := store.LoadWithRevision()
	if err != nil {
		return HostConfig{}, "", fmt.Errorf("reload transfer config: %w", err)
	}
	if currentRevision != expectedRevision {
		return HostConfig{}, currentRevision, fmt.Errorf("%w: expected %s, found %s", ErrHostConfigConflict, expectedRevision, currentRevision)
	}
	updated := patch.Apply(current)
	if err := ValidateHostConfig(updated); err != nil {
		return HostConfig{}, currentRevision, fmt.Errorf("%w: %v", ErrInvalidHostConfig, err)
	}
	if patch.Empty() {
		service.setConfig(updated, currentRevision)
		return updated, currentRevision, nil
	}
	if err := store.Save(updated); err != nil {
		var committed *ConfigCommitError
		if errors.As(err, &committed) {
			newRevision := HostConfigRevision(updated)
			service.setConfig(updated, newRevision)
			return updated, newRevision, fmt.Errorf("save transfer config: %w", err)
		}
		return HostConfig{}, currentRevision, fmt.Errorf("save transfer config: %w", err)
	}
	newRevision := HostConfigRevision(updated)
	service.setConfig(updated, newRevision)
	return updated, newRevision, nil
}

func (service *Service) setConfig(config HostConfig, revision string) {
	service.mu.Lock()
	service.config = config
	service.configRevision = revision
	service.mu.Unlock()
}

func validHostConfigRevision(revision string) bool {
	if len(revision) != 64 {
		return false
	}
	var digest [32]byte
	_, err := hex.Decode(digest[:], []byte(revision))
	return err == nil
}

// ValidateHostConfigRevision keeps malformed optimistic-concurrency tokens
// outside the service dependency boundary and gives HTTP callers a stable
// client error before any lock or config-file work begins.
func ValidateHostConfigRevision(revision string) error {
	if !validHostConfigRevision(revision) {
		return ErrHostConfigRevision
	}
	return nil
}

// Snapshot never launches or reconfigures aria2c. While the engine is running,
// it also reconciles private retry metadata so credentials are not retained
// after a transfer completes successfully.
func (service *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	// A stopped snapshot reloads the disk-authoritative config. Serialize the
	// read-and-publish transaction with patches, starts, shutdown, and GoBarry
	// migration so a slower disk read cannot overwrite a newer same-process
	// config. The operationMu -> queueMu order matches migration and shutdown.
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()

	service.mu.RLock()
	runtime := service.runtime
	starting := service.starting
	stopping := service.stopping
	config := service.config
	configRevision := service.configRevision
	store := service.configStore
	health := service.health
	service.mu.RUnlock()
	if runtime == nil && !starting && !stopping && store != nil {
		// A stopped process is observational but must not present a stale
		// in-memory revision after another ProtoPeek process saves settings.
		// ConfigStore.LoadWithRevision only reads; it never creates defaults or
		// starts the engine.
		diskConfig, _, diskRevision, loadErr := store.LoadWithRevision()
		if loadErr != nil {
			snapshot := Snapshot{
				ObservedAt:     service.now().UTC(),
				Health:         Health{Status: "unavailable", Message: "Saved transfer host settings could not be loaded safely."},
				Config:         config,
				ConfigRevision: configRevision,
				Jobs:           []Job{},
			}
			return snapshot, loadErr
		}
		service.mu.Lock()
		if service.runtime == nil && !service.starting && !service.stopping {
			service.config = diskConfig
			service.configRevision = diskRevision
			config = diskConfig
			configRevision = diskRevision
		}
		service.mu.Unlock()
	}

	snapshot := Snapshot{
		ObservedAt:     service.now().UTC(),
		Health:         health,
		Config:         config,
		ConfigRevision: configRevision,
		Jobs:           []Job{},
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
	service.mu.Lock()
	retryRequestsBefore := cloneRetryRequests(service.retryRequests)
	retryStateChanged := service.reconcileStateLocked(engineSnapshot)
	for index := range snapshot.Jobs {
		_, retryAvailable := service.retryRequests[snapshot.Jobs[index].ID]
		snapshot.Jobs[index].RetryAvailable = retryAvailable
		if !retryAvailable && (snapshot.Jobs[index].Status == JobFailed || snapshot.Jobs[index].Status == JobCancelled) {
			snapshot.Jobs[index].RetryReason = "Exact retry options are unavailable. Queue a new job and re-enter any required headers."
		}
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
	retryRequests := cloneRetryRequests(service.retryRequests)
	service.mu.Unlock()
	snapshot.Metrics = engineSnapshot.Metrics
	if retryStateChanged {
		if err := saveRetryState(filepath.Join(service.paths.StateDirectory, "retry.json"), retryRequests, config.MaxTrackedJobs); err != nil {
			service.mu.Lock()
			service.retryRequests = retryRequestsBefore
			service.mu.Unlock()
			return snapshot, fmt.Errorf("remove completed transfer retry metadata: %w", err)
		}
	}
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
	paths := service.paths
	store := service.configStore
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
	if lease == nil {
		return fail("failed", "Could not acquire the transfer engine lock.", errors.New("transfer locker returned no lease"))
	}
	if store == nil {
		store = NewConfigStore(paths.ConfigFile)
	}
	config, _, configRevision, err := store.LoadWithRevision()
	if err != nil {
		_ = lease.Release()
		return fail("failed", "Saved transfer host settings could not be loaded safely.", err)
	}
	// The lock covers this reload and the subsequent launch. A second process
	// cannot replace the config between the disk read and aria2 startup.
	service.setConfig(config, configRevision)
	restoredChecksums, err := loadVerificationState(paths.VerificationFile, config.MaxTrackedJobs)
	if err != nil {
		_ = lease.Release()
		return fail("failed", "Saved checksum evidence could not be loaded safely.", err)
	}
	restoredRetryRequests, err := loadRetryState(filepath.Join(paths.StateDirectory, "retry.json"), config.MaxTrackedJobs)
	if err != nil {
		_ = lease.Release()
		return fail("failed", "Saved retry metadata could not be loaded safely.", err)
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
	service.retryRequests = restoredRetryRequests
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

	downloadDirectory := config.DownloadDirectory
	if request.DestinationDirectory != "" {
		downloadDirectory = request.DestinationDirectory
	}
	free, err := availableDiskBytes(downloadDirectory)
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
	service.reconcileStateLocked(engineSnapshot)
	service.checksums[id] = request.SHA256
	service.retryRequests[id] = cloneAddRequest(request)
	checksums := cloneChecksums(service.checksums)
	retryRequests := cloneRetryRequests(service.retryRequests)
	service.mu.Unlock()
	stateErr := errors.Join(
		saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs),
		saveRetryState(filepath.Join(service.paths.StateDirectory, "retry.json"), retryRequests, config.MaxTrackedJobs),
	)
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
	service.mu.RLock()
	retryRequest, retryAvailable := service.retryRequests[id]
	service.mu.RUnlock()
	if !retryAvailable {
		return AddResult{}, ErrRetryMetadataMissing
	}
	retryRequest = cloneAddRequest(retryRequest)
	downloadDirectory := config.DownloadDirectory
	if retryRequest.DestinationDirectory != "" {
		downloadDirectory = retryRequest.DestinationDirectory
	}
	free, err := availableDiskBytes(downloadDirectory)
	if err != nil {
		return AddResult{}, fmt.Errorf("inspect free disk space before retry: %w", err)
	}
	if free < uint64(config.MinimumFreeDiskBytes) {
		return AddResult{}, ErrInsufficientDisk
	}
	expected := retryRequest.SHA256
	newID, queueErr := runtime.Engine.Retry(ctx, id, retryRequest, config)
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
	delete(service.checksums, id)
	service.checksums[newID] = expected
	delete(service.retryRequests, id)
	service.retryRequests[newID] = cloneAddRequest(retryRequest)
	checksums := cloneChecksums(service.checksums)
	retryRequests := cloneRetryRequests(service.retryRequests)
	service.mu.Unlock()
	stateErr := errors.Join(
		saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs),
		saveRetryState(filepath.Join(service.paths.StateDirectory, "retry.json"), retryRequests, config.MaxTrackedJobs),
	)
	verification := "not_requested"
	if expected != "" {
		verification = "pending"
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
	delete(service.retryRequests, id)
	checksums := cloneChecksums(service.checksums)
	retryRequests := cloneRetryRequests(service.retryRequests)
	service.mu.Unlock()
	stateErr := errors.Join(
		saveVerificationState(service.paths.VerificationFile, checksums, config.MaxTrackedJobs),
		saveRetryState(filepath.Join(service.paths.StateDirectory, "retry.json"), retryRequests, config.MaxTrackedJobs),
	)
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
	config := service.config
	service.mu.Unlock()

	cleanupErr := service.pruneCompletedRetryState(ctx, runtime, config)
	err := runtime.Stop(ctx)
	select {
	case <-runtime.Done:
		service.finishRuntime(runtime, true)
	default:
		// Runtime.Stop may return because the caller cancelled while its bounded
		// cleanup continues. Keep the process lock until monitor observes exit.
	}
	return errors.Join(cleanupErr, err)
}

func (service *Service) pruneCompletedRetryState(ctx context.Context, runtime *Runtime, config HostConfig) error {
	snapshot, err := runtime.Engine.Snapshot(ctx, config.MaxTrackedJobs)
	if err != nil {
		return fmt.Errorf("inspect completed transfers before shutdown: %w", err)
	}
	service.mu.Lock()
	before := cloneRetryRequests(service.retryRequests)
	changed := service.pruneCompletedRetryRequestsLocked(snapshot.Jobs)
	after := cloneRetryRequests(service.retryRequests)
	service.mu.Unlock()
	if !changed {
		return nil
	}
	if err := saveRetryState(filepath.Join(service.paths.StateDirectory, "retry.json"), after, config.MaxTrackedJobs); err != nil {
		service.mu.Lock()
		service.retryRequests = before
		service.mu.Unlock()
		return fmt.Errorf("remove completed transfer retry metadata before shutdown: %w", err)
	}
	return nil
}

func (service *Service) reconcileStateLocked(snapshot EngineSnapshot) bool {
	seen := make(map[string]struct{}, len(snapshot.Jobs))
	completed := make(map[string]struct{}, len(snapshot.Jobs))
	for _, job := range snapshot.Jobs {
		seen[job.ID] = struct{}{}
		if job.Status == JobCompleted {
			completed[job.ID] = struct{}{}
		}
	}
	exhaustive := snapshot.Metrics.TotalCount <= len(snapshot.Jobs)
	for id := range service.checksums {
		if _, exists := seen[id]; !exists && exhaustive {
			delete(service.checksums, id)
		}
	}
	retryStateChanged := false
	for id := range service.retryRequests {
		_, exists := seen[id]
		_, completedSuccessfully := completed[id]
		if (!exists && exhaustive) || completedSuccessfully {
			delete(service.retryRequests, id)
			retryStateChanged = true
		}
	}
	return retryStateChanged
}

func (service *Service) pruneCompletedRetryRequestsLocked(jobs []Job) bool {
	completed := make(map[string]struct{}, len(jobs))
	for _, job := range jobs {
		if job.Status == JobCompleted {
			completed[job.ID] = struct{}{}
		}
	}
	changed := false
	for id := range service.retryRequests {
		if _, completedSuccessfully := completed[id]; completedSuccessfully {
			delete(service.retryRequests, id)
			changed = true
		}
	}
	return changed
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

	request.DestinationDirectory = strings.TrimSpace(request.DestinationDirectory)
	if request.DestinationDirectory != "" {
		if len(request.DestinationDirectory) > maxDestinationLength || !filepath.IsAbs(request.DestinationDirectory) || containsControl(request.DestinationDirectory) {
			return AddRequest{}, errors.New("destination directory must be a bounded absolute path without control characters")
		}
		request.DestinationDirectory = filepath.Clean(request.DestinationDirectory)
	}

	request.UserAgent = strings.TrimSpace(request.UserAgent)
	if len(request.UserAgent) > maxUserAgentLength || containsControl(request.UserAgent) {
		return AddRequest{}, fmt.Errorf("per-job user agent must be at most %d characters without control characters", maxUserAgentLength)
	}

	if len(request.Headers) > maxRequestHeaders {
		return AddRequest{}, fmt.Errorf("at most %d per-job request headers are allowed", maxRequestHeaders)
	}
	headerBytes := 0
	seenHeaders := make(map[string]struct{}, len(request.Headers))
	normalizedHeaders := make([]RequestHeader, 0, len(request.Headers))
	for _, header := range request.Headers {
		name := strings.TrimSpace(header.Name)
		value := strings.TrimSpace(header.Value)
		lowerName := strings.ToLower(name)
		if name == "" || len(name) > maxHeaderNameLength || !validHeaderName(name) {
			return AddRequest{}, errors.New("request header names must use bounded HTTP token characters")
		}
		if len(value) > maxHeaderValueLength || containsControl(value) {
			return AddRequest{}, errors.New("request header values must be bounded and must not contain control characters")
		}
		if _, exists := seenHeaders[lowerName]; exists {
			return AddRequest{}, errors.New("request header names must be unique")
		}
		if forbiddenPerJobHeader(lowerName) {
			return AddRequest{}, errors.New("that request header is controlled by ProtoPeek or aria2c")
		}
		headerBytes += len(name) + len(value)
		if headerBytes > maxHeaderBytes {
			return AddRequest{}, fmt.Errorf("per-job request headers must total at most %d bytes", maxHeaderBytes)
		}
		seenHeaders[lowerName] = struct{}{}
		normalizedHeaders = append(normalizedHeaders, RequestHeader{Name: name, Value: value})
	}
	request.Headers = normalizedHeaders
	request.Sources = sources
	return request, nil
}

func validHeaderName(value string) bool {
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			strings.ContainsRune("!#$%&'*+-.^_`|~", character)) {
			return false
		}
	}
	return value != ""
}

func forbiddenPerJobHeader(name string) bool {
	switch name {
	case "connection", "content-length", "host", "proxy-connection", "transfer-encoding", "user-agent":
		return true
	default:
		return false
	}
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
