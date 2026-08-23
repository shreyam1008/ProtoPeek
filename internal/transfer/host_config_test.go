package transfer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestConfigureAndSaveRoundTripsAndAppliesOnlyAfterSave(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	config := serviceConfigForTest(t, service)
	updated := config
	updated.MaxActiveJobs = 6
	updated.MaxConnectionsPerHost = 12

	saved, revision, err := service.ConfigureAndSavePatch(HostConfigRevision(config), HostConfigPatch{
		MaxActiveJobs:         intPointer(6),
		MaxConnectionsPerHost: intPointer(12),
	})
	if err != nil {
		t.Fatalf("configure and save patch: %v", err)
	}
	if saved != updated || revision != HostConfigRevision(updated) {
		t.Fatalf("saved=%#v revision=%q, want=%#v revision=%q", saved, revision, updated, HostConfigRevision(updated))
	}
	loaded, exists, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load saved config: %v", err)
	}
	if !exists || loaded != updated {
		t.Fatalf("saved config = %#v exists=%v, want %#v", loaded, exists, updated)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after configure: %v", err)
	}
	if snapshot.Config != updated || snapshot.ConfigRevision != HostConfigRevision(updated) {
		t.Fatalf("active config = %#v revision=%q, want %#v revision=%q", snapshot.Config, snapshot.ConfigRevision, updated, HostConfigRevision(updated))
	}
}

func TestConfigureAndSaveRefusesRunningEngineWithoutWriting(t *testing.T) {
	t.Parallel()
	service, _, _, control, paths := testService(t, &fakeEngine{})
	original := serviceConfigForTest(t, service)
	if err := NewConfigStore(paths.ConfigFile).Save(original); err != nil {
		t.Fatalf("save original config: %v", err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatalf("start engine: %v", err)
	}
	defer func() {
		control.exit(nil)
		_ = service.Shutdown(context.Background())
	}()

	if _, _, err := service.ConfigureAndSavePatch(HostConfigRevision(original), HostConfigPatch{MaxActiveJobs: intPointer(9)}); !errors.Is(err, ErrHostConfigRunning) {
		t.Fatalf("running configure error = %v, want ErrHostConfigRunning", err)
	}
	loaded, exists, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load unchanged config: %v", err)
	}
	if !exists || loaded != original {
		t.Fatalf("disk config after running refusal = %#v exists=%v, want %#v", loaded, exists, original)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after running refusal: %v", err)
	}
	if snapshot.Config != original {
		t.Fatalf("active config after running refusal = %#v, want %#v", snapshot.Config, original)
	}
}

func TestConfigureAndSaveValidationFailureDoesNotWriteOrApply(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	original := serviceConfigForTest(t, service)
	if err := NewConfigStore(paths.ConfigFile).Save(original); err != nil {
		t.Fatalf("save original config: %v", err)
	}
	if _, _, err := service.ConfigureAndSavePatch(HostConfigRevision(original), HostConfigPatch{MaxActiveJobs: intPointer(17)}); err == nil {
		t.Fatal("invalid config unexpectedly succeeded")
	}
	loaded, _, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load config after validation failure: %v", err)
	}
	if loaded != original {
		t.Fatalf("disk config after validation failure = %#v, want %#v", loaded, original)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after validation failure: %v", err)
	}
	if snapshot.Config != original {
		t.Fatalf("active config after validation failure = %#v, want %#v", snapshot.Config, original)
	}
}

func TestConfigureAndSaveCrossFieldValidationFailureDoesNotWriteOrApply(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	original := serviceConfigForTest(t, service)
	original.MaxActiveJobs = 4
	original.MaxQueuedJobs = 4
	original.MaxTrackedJobs = 4
	if err := service.Configure(original); err != nil {
		t.Fatalf("configure bounded original: %v", err)
	}
	if err := NewConfigStore(paths.ConfigFile).Save(original); err != nil {
		t.Fatalf("save bounded original: %v", err)
	}
	if _, _, err := service.ConfigureAndSavePatch(HostConfigRevision(original), HostConfigPatch{MaxActiveJobs: intPointer(6)}); !errors.Is(err, ErrInvalidHostConfig) {
		t.Fatalf("cross-field configure error = %v, want ErrInvalidHostConfig", err)
	}
	loaded, _, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load config after cross-field validation failure: %v", err)
	}
	if loaded != original {
		t.Fatalf("disk config after cross-field validation failure = %#v, want %#v", loaded, original)
	}
	service.mu.RLock()
	active := service.config
	service.mu.RUnlock()
	if active != original {
		t.Fatalf("active config after cross-field validation failure = %#v, want %#v", active, original)
	}
}

func TestConfigureAndSaveFailureLeavesActiveConfigUnchanged(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	blockedParent := filepath.Join(root, "config-file")
	if err := os.WriteFile(blockedParent, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	config := DefaultHostConfig()
	config.DownloadDirectory = root
	paths := Paths{
		ConfigFile:       filepath.Join(blockedParent, "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	service, _, _ := newServiceForPaths(t, config, paths, &fakeEngine{})
	if _, _, err := service.ConfigureAndSavePatch(HostConfigRevision(config), HostConfigPatch{MaxActiveJobs: intPointer(8)}); err == nil {
		t.Fatal("save failure unexpectedly succeeded")
	}
	service.mu.RLock()
	active := service.config
	service.mu.RUnlock()
	if active != config {
		t.Fatalf("active config after save failure = %#v, want %#v", active, config)
	}
}

func TestConfigureAndSaveRefusesHeldLockWithoutWriting(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = root
	paths := Paths{
		ConfigFile:       filepath.Join(root, "config", "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatalf("save original config: %v", err)
	}
	holder, err := (FileLocker{}).TryLock(paths.LockFile)
	if err != nil {
		t.Fatalf("hold transfer lock: %v", err)
	}
	defer func() { _ = holder.Release() }()
	service, _, _ := newServiceForPaths(t, config, paths, &fakeEngine{})
	service.locker = FileLocker{}
	if _, _, err := service.ConfigureAndSavePatch(HostConfigRevision(config), HostConfigPatch{MaxActiveJobs: intPointer(8)}); !errors.Is(err, ErrLockHeld) {
		t.Fatalf("held-lock configure error = %v, want ErrLockHeld", err)
	}
	loaded, _, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load unchanged config: %v", err)
	}
	if loaded != config {
		t.Fatalf("disk config after held-lock refusal = %#v, want %#v", loaded, config)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after held-lock refusal: %v", err)
	}
	if snapshot.Config != config {
		t.Fatalf("active config after held-lock refusal = %#v, want %#v", snapshot.Config, config)
	}
}

func TestHostConfigPatchUsesDiskDefaultsWhenConfigIsAbsent(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	custom := DefaultHostConfig()
	custom.DownloadDirectory = filepath.Join(root, "custom-downloads")
	paths := Paths{
		ConfigFile:       filepath.Join(root, "config", "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	service, _, _ := newServiceForPaths(t, custom, paths, &fakeEngine{})
	defaults := DefaultHostConfig()
	saved, revision, err := service.ConfigureAndSavePatch(HostConfigRevision(defaults), HostConfigPatch{MaxActiveJobs: intPointer(6)})
	if err != nil {
		t.Fatalf("patch with absent config: %v", err)
	}
	want := defaults
	want.MaxActiveJobs = 6
	if saved != want || revision != HostConfigRevision(want) {
		t.Fatalf("absent-config patch = %#v revision=%q, want %#v revision=%q", saved, revision, want, HostConfigRevision(want))
	}
	if saved.DownloadDirectory == custom.DownloadDirectory {
		t.Fatal("absent config reused stale process-local download directory")
	}
}

func TestStartReloadsFreshDiskConfigBeforeLaunch(t *testing.T) {
	t.Parallel()
	service, launcher, _, control, paths := testService(t, &fakeEngine{})
	defer func() {
		control.exit(nil)
		_ = service.Shutdown(context.Background())
	}()
	fresh := serviceConfigForTest(t, service)
	fresh.MaxActiveJobs = 11
	fresh.MaxQueuedJobs = 77
	if err := NewConfigStore(paths.ConfigFile).Save(fresh); err != nil {
		t.Fatalf("save fresh disk config: %v", err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	launcher.mu.Lock()
	launched := launcher.lastConfig
	launcher.mu.Unlock()
	if launched != fresh {
		t.Fatalf("launcher received stale config = %#v, want %#v", launched, fresh)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after fresh start: %v", err)
	}
	if snapshot.Config != fresh || snapshot.ConfigRevision != HostConfigRevision(fresh) {
		t.Fatalf("fresh start snapshot = %#v revision=%q", snapshot.Config, snapshot.ConfigRevision)
	}
}

func TestStartUsesDefaultsAfterDiskConfigIsDeleted(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	custom := DefaultHostConfig()
	custom.DownloadDirectory = filepath.Join(root, "custom-downloads")
	paths := Paths{
		ConfigFile:       filepath.Join(root, "config", "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	service, control, _ := newServiceForPaths(t, custom, paths, &fakeEngine{})
	launcher := service.launcher.(*fakeLauncher)
	if err := NewConfigStore(paths.ConfigFile).Save(custom); err != nil {
		t.Fatalf("save custom config: %v", err)
	}
	if err := os.Remove(paths.ConfigFile); err != nil {
		t.Fatalf("remove config: %v", err)
	}
	defer func() {
		control.exit(nil)
		_ = service.Shutdown(context.Background())
	}()
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatalf("start after deletion: %v", err)
	}
	launcher.mu.Lock()
	launched := launcher.lastConfig
	launcher.mu.Unlock()
	defaults := DefaultHostConfig()
	if launched != defaults {
		t.Fatalf("launcher received stale config after deletion = %#v, want defaults %#v", launched, defaults)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after default start: %v", err)
	}
	if snapshot.Config != defaults || snapshot.ConfigRevision != HostConfigRevision(defaults) {
		t.Fatalf("default start snapshot = %#v revision=%q", snapshot.Config, snapshot.ConfigRevision)
	}
}

func TestStoppedSnapshotReloadsExternalSaveAndAllowsNextPatch(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	initial := serviceConfigForTest(t, service)
	if err := NewConfigStore(paths.ConfigFile).Save(initial); err != nil {
		t.Fatalf("save initial config: %v", err)
	}
	first, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("initial snapshot: %v", err)
	}
	external := initial
	external.MaxActiveJobs = 9
	external.MaxQueuedJobs = 321
	if err := NewConfigStore(paths.ConfigFile).Save(external); err != nil {
		t.Fatalf("save external config: %v", err)
	}
	refreshed, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("refresh snapshot: %v", err)
	}
	if refreshed.Config != external || refreshed.ConfigRevision != HostConfigRevision(external) || refreshed.ConfigRevision == first.ConfigRevision {
		t.Fatalf("external snapshot = %#v revision=%q; first=%q", refreshed.Config, refreshed.ConfigRevision, first.ConfigRevision)
	}
	saved, revision, err := service.ConfigureAndSavePatch(refreshed.ConfigRevision, HostConfigPatch{MaxConnectionsPerHost: intPointer(12)})
	if err != nil {
		t.Fatalf("patch after external refresh: %v", err)
	}
	want := external
	want.MaxConnectionsPerHost = 12
	if saved != want || revision != HostConfigRevision(want) {
		t.Fatalf("patched config=%#v revision=%q, want=%#v revision=%q", saved, revision, want, HostConfigRevision(want))
	}
	if err := os.Remove(paths.ConfigFile); err != nil {
		t.Fatalf("remove external config: %v", err)
	}
	defaults := DefaultHostConfig()
	deleted, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after external deletion: %v", err)
	}
	if deleted.Config != defaults || deleted.ConfigRevision != HostConfigRevision(defaults) {
		t.Fatalf("deleted-config snapshot = %#v revision=%q, want defaults %#v revision=%q", deleted.Config, deleted.ConfigRevision, defaults, HostConfigRevision(defaults))
	}
}

func TestStoppedSnapshotSerializesDiskReloadWithPatch(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	initial := serviceConfigForTest(t, service)
	external := initial
	external.MaxActiveJobs = 9
	if err := NewConfigStore(paths.ConfigFile).Save(external); err != nil {
		t.Fatalf("save external config: %v", err)
	}
	startedReading := make(chan struct{})
	releaseRead := make(chan struct{})
	var readCount atomic.Int32
	service.configStore.readFile = func(path string) ([]byte, error) {
		data, err := readConfigFile(path)
		if readCount.Add(1) == 1 {
			close(startedReading)
			<-releaseRead
		}
		return data, err
	}
	type snapshotResult struct {
		snapshot Snapshot
		err      error
	}
	snapshotDone := make(chan snapshotResult, 1)
	go func() {
		snapshot, err := service.Snapshot(context.Background())
		snapshotDone <- snapshotResult{snapshot: snapshot, err: err}
	}()
	<-startedReading
	patchDone := make(chan error, 1)
	go func() {
		_, _, err := service.ConfigureAndSavePatch(HostConfigRevision(external), HostConfigPatch{MaxConnectionsPerHost: intPointer(12)})
		patchDone <- err
	}()
	select {
	case err := <-patchDone:
		t.Fatalf("patch crossed in-flight snapshot reload: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseRead)
	result := <-snapshotDone
	if result.err != nil {
		t.Fatalf("serialized snapshot: %v", result.err)
	}
	if err := <-patchDone; err != nil {
		t.Fatalf("patch after serialized snapshot: %v", err)
	}
	final, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("final snapshot: %v", err)
	}
	if final.Config.MaxActiveJobs != external.MaxActiveJobs || final.Config.MaxConnectionsPerHost != 12 {
		t.Fatalf("final config lost serialized update: %#v", final.Config)
	}
}

func TestHostConfigPatchConflictPreservesNewerDiskConfig(t *testing.T) {
	t.Parallel()
	service, _, _, _, paths := testService(t, &fakeEngine{})
	initial := serviceConfigForTest(t, service)
	if err := NewConfigStore(paths.ConfigFile).Save(initial); err != nil {
		t.Fatalf("save initial config: %v", err)
	}
	stale, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("stale snapshot: %v", err)
	}
	newer := initial
	newer.MaxActiveJobs = 10
	if err := NewConfigStore(paths.ConfigFile).Save(newer); err != nil {
		t.Fatalf("save newer config: %v", err)
	}
	if _, _, err := service.ConfigureAndSavePatch(stale.ConfigRevision, HostConfigPatch{MaxConnectionsPerHost: intPointer(12)}); !errors.Is(err, ErrHostConfigConflict) {
		t.Fatalf("stale patch error = %v, want ErrHostConfigConflict", err)
	}
	loaded, _, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load newer config: %v", err)
	}
	if loaded != newer {
		t.Fatalf("disk config after conflict = %#v, want %#v", loaded, newer)
	}
}

func TestHostConfigPatchPreservesHiddenFieldsAndNoOpBytes(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = root
	config.MaxQueuedJobs = 333
	config.MaxTrackedJobs = 777
	config.Split = 13
	config.MinSplitSizeBytes = 2 << 20
	config.UserAgent = "hidden-but-supported-by-config"
	for _, bytes := range []int64{1, 123456} {
		config.MaxDownloadBytesPerSecond = bytes
		config.MinimumFreeDiskBytes = bytes
		paths := Paths{
			ConfigFile:       filepath.Join(root, "config", "transfers-"+string(rune('a'+bytes%2))+".json"),
			StateDirectory:   filepath.Join(root, "state"),
			SessionFile:      filepath.Join(root, "state", "session.aria2"),
			VerificationFile: filepath.Join(root, "state", "verification.json"),
			LockFile:         filepath.Join(root, "state", "engine.lock"),
		}
		if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
			t.Fatalf("save %d-byte config: %v", bytes, err)
		}
		service, _, _ := newServiceForPaths(t, config, paths, &fakeEngine{})
		snapshot, err := service.Snapshot(context.Background())
		if err != nil {
			t.Fatalf("snapshot %d-byte config: %v", bytes, err)
		}
		if snapshot.Config.MaxDownloadBytesPerSecond != bytes || snapshot.Config.MinimumFreeDiskBytes != bytes {
			t.Fatalf("snapshot byte values = %d/%d, want %d/%d", snapshot.Config.MaxDownloadBytesPerSecond, snapshot.Config.MinimumFreeDiskBytes, bytes, bytes)
		}
		saved, revision, err := service.ConfigureAndSavePatch(snapshot.ConfigRevision, HostConfigPatch{})
		if err != nil {
			t.Fatalf("no-op %d-byte patch: %v", bytes, err)
		}
		if saved != config || revision != snapshot.ConfigRevision {
			t.Fatalf("no-op %d-byte result = %#v revision=%q", bytes, saved, revision)
		}
	}

	paths := Paths{
		ConfigFile:       filepath.Join(root, "config", "hidden.json"),
		StateDirectory:   filepath.Join(root, "state-hidden"),
		SessionFile:      filepath.Join(root, "state-hidden", "session.aria2"),
		VerificationFile: filepath.Join(root, "state-hidden", "verification.json"),
		LockFile:         filepath.Join(root, "state-hidden", "engine.lock"),
	}
	if err := NewConfigStore(paths.ConfigFile).Save(config); err != nil {
		t.Fatalf("save hidden config: %v", err)
	}
	service, _, _ := newServiceForPaths(t, config, paths, &fakeEngine{})
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("hidden snapshot: %v", err)
	}
	if _, _, err := service.ConfigureAndSavePatch(snapshot.ConfigRevision, HostConfigPatch{MaxActiveJobs: intPointer(6)}); err != nil {
		t.Fatalf("hidden-field patch: %v", err)
	}
	loaded, _, err := NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		t.Fatalf("load hidden-field patch: %v", err)
	}
	if loaded.MaxQueuedJobs != config.MaxQueuedJobs || loaded.MaxTrackedJobs != config.MaxTrackedJobs || loaded.Split != config.Split || loaded.MinSplitSizeBytes != config.MinSplitSizeBytes || loaded.UserAgent != config.UserAgent {
		t.Fatalf("hidden fields changed: %#v", loaded)
	}
}

func TestConfigCommitDurabilityWarningKeepsDiskAndMemoryConsistent(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	config := DefaultHostConfig()
	config.DownloadDirectory = root
	paths := Paths{
		ConfigFile:       filepath.Join(root, "config", "transfers.json"),
		StateDirectory:   filepath.Join(root, "state"),
		SessionFile:      filepath.Join(root, "state", "session.aria2"),
		VerificationFile: filepath.Join(root, "state", "verification.json"),
		LockFile:         filepath.Join(root, "state", "engine.lock"),
	}
	store := NewConfigStore(paths.ConfigFile)
	if err := store.Save(config); err != nil {
		t.Fatalf("save original config: %v", err)
	}
	service, _, _ := newServiceForPaths(t, config, paths, &fakeEngine{})
	service.configStore.syncDir = func(string) error { return errors.New("injected directory sync failure") }
	updated, revision, err := service.ConfigureAndSavePatch(HostConfigRevision(config), HostConfigPatch{MaxActiveJobs: intPointer(6)})
	if !errors.Is(err, ErrConfigCommitDurability) {
		t.Fatalf("durability error = %v, want ErrConfigCommitDurability", err)
	}
	if updated.MaxActiveJobs != 6 || revision != HostConfigRevision(updated) {
		t.Fatalf("committed result = %#v revision=%q", updated, revision)
	}
	service.mu.RLock()
	active := service.config
	service.mu.RUnlock()
	loaded, _, loadErr := NewConfigStore(paths.ConfigFile).Load()
	if loadErr != nil || active != loaded || loaded.MaxActiveJobs != 6 {
		t.Fatalf("disk/memory split: active=%#v disk=%#v err=%v", active, loaded, loadErr)
	}
}

func serviceConfigForTest(t *testing.T, service *Service) HostConfig {
	t.Helper()
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("read service config: %v", err)
	}
	return snapshot.Config
}

func intPointer(value int) *int {
	return &value
}
