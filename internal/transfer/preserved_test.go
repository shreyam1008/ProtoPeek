package transfer

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func addPreservedFixture(t *testing.T, e *nativeEngine, directory string) string {
	t.Helper()
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, ".protopeek-deadbeef-0000000000000001-preserved.part")
	if err := os.WriteFile(path, []byte("user-owned bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	// Empty identity reproduces an unavailable/unsupported filesystem identity.
	e.state.PreservedPartials = append(e.state.PreservedPartials, nativePreservedPartial{PreservedPartial: PreservedPartial{JobID: "deadbeef", Path: path, SizeBytes: 16}})
	err := e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func assertPreservedFile(t *testing.T, path string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "user-owned bytes" {
		t.Fatalf("retained file changed: %q %v", got, err)
	}
}

func TestForgetPreservedWhileNativeRunningNeverTouchesFile(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	if err := s.ForgetPreserved(context.Background(), "relative"); !errors.Is(err, ErrPreservedInvalid) {
		t.Fatalf("invalid: %v", err)
	}
	if err := s.ForgetPreserved(context.Background(), path+".unlisted"); !errors.Is(err, ErrPreservedNotFound) {
		t.Fatalf("unlisted: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.ForgetPreserved(ctx, path); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled: %v", err)
	}
	if err := s.ForgetPreserved(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	assertPreservedFile(t, path)
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("snapshot: %#v %v", snapshot.PreservedPartials, err)
	}
	if err := s.ForgetPreserved(context.Background(), path); !errors.Is(err, ErrPreservedNotFound) {
		t.Fatalf("duplicate: %v", err)
	}
}

func TestForgetPreservedStoppedRespectsOtherProcessAndUnknownIdentity(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err := s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	lease, err := (FileLocker{}).TryLock(p.LockFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetPreserved(context.Background(), path); !errors.Is(err, ErrLockHeld) {
		t.Fatalf("other process lock: %v", err)
	}
	if err := lease.Release(); err != nil {
		t.Fatal(err)
	}
	assertPreservedFile(t, path)
	if err := s.ForgetPreserved(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	assertPreservedFile(t, path)
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("stopped: %#v %v", snapshot.PreservedPartials, err)
	}
}

func TestForgetMissingPreservedWithUnknownDirectoryIdentity(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err := s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 1 {
		t.Fatalf("unknown identity was silently pruned: %#v %v", snapshot.PreservedPartials, err)
	}
	if err := s.ForgetPreserved(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("explicit recovery failed: %#v %v", snapshot.PreservedPartials, err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file unexpectedly recreated: %v", err)
	}
}

func TestForgetPreservedWithAriaEngineRunning(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err := s.Shutdown(ctx)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	c.Aria2Path = "fake-aria2"
	if err := NewConfigStore(p.ConfigFile).Save(c); err != nil {
		t.Fatal(err)
	}
	process := newFakeManagedProcess()
	aria := NewAria2Launcher()
	aria.resolve = func(string) (string, error) { return "fake-aria2", nil }
	aria.reservePort = func() (int, error) { return 6800, nil }
	aria.randomToken = func() (string, error) { return "test-secret", nil }
	aria.startProcess = func(string, []string, io.Writer, io.Writer) (managedProcess, error) { return process, nil }
	aria.newRPC = func(string, string) aria2RPC { return &fakeAriaRPC{version: "1.37.0"} }
	other, err := NewServiceWithDependencies(c, p, &adaptiveLauncher{aria: aria}, FileLocker{})
	if err != nil {
		t.Fatal(err)
	}
	health, err := other.Start(context.Background())
	if err != nil || health.Engine != "aria2" {
		t.Fatalf("start: %#v %v", health, err)
	}
	defer func() {
		process.exit(nil)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := other.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	}()
	if err := other.ForgetPreserved(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	assertPreservedFile(t, path)
	snapshot, err := other.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("aria snapshot: %#v %v", snapshot.PreservedPartials, err)
	}
}

func TestForgetPreservedReportsUncertainPersistence(t *testing.T) {
	c, p := nativeFixture(t)
	s := nativeService(t, c, p)
	e := s.runtime.Engine.(*nativeEngine)
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	state := filepath.Join(p.StateDirectory, "session.native.json")
	backup := state + ".backup"
	if err := os.Rename(state, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetPreserved(context.Background(), path); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("persistence: %v", err)
	}
	assertPreservedFile(t, path)
	if _, err := s.Snapshot(context.Background()); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("uncertainty concealed: %v", err)
	}
	if err := os.Remove(state); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, state); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("recovery: %#v %v", snapshot.PreservedPartials, err)
	}
	assertPreservedFile(t, path)
}

func TestForgetPreservedKeepsLeaseWhenAriaExits(t *testing.T) {
	c, p := nativeFixture(t)
	if err := os.MkdirAll(p.StateDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	e := &nativeEngine{path: filepath.Join(p.StateDirectory, "session.native.json"), config: c, state: nativeState{Version: 1}}
	path := addPreservedFixture(t, e, c.DownloadDirectory)
	engine := &fakeEngine{}
	exitEvent := make(chan struct{})
	errCalled := make(chan struct{})
	runtime := &Runtime{Engine: engine, EngineName: "aria2", Done: exitEvent, Stop: func(context.Context) error { return nil }, Err: func() error { close(errCalled); return nil }, observeCompletions: true}
	s, err := NewServiceWithDependencies(c, p, &fakeLauncher{runtime: runtime}, FileLocker{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Wait for the observer's initial idle snapshot so the only operation that
	// can hold operationMu below is the requested ledger mutation.
	deadline := time.Now().Add(3 * time.Second)
	for {
		engine.mu.Lock()
		seen := len(engine.calls) > 0
		engine.mu.Unlock()
		if seen {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("observer did not become idle")
		}
		time.Sleep(time.Millisecond)
	}
	s.queueMu.Lock()
	queueHeld := true
	defer func() {
		if queueHeld {
			s.queueMu.Unlock()
		}
	}()
	forgot := make(chan error, 1)
	go func() { forgot <- s.ForgetPreserved(context.Background(), path) }()
	deadline = time.Now().Add(3 * time.Second)
	for {
		if s.operationMu.TryLock() {
			s.operationMu.Unlock()
		} else {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("forget did not enter operation lock")
		}
		time.Sleep(time.Millisecond)
	}
	// An unbuffered event confirms the observer actually received the exit.
	select {
	case exitEvent <- struct{}{}:
	case <-time.After(3 * time.Second):
		t.Fatal("observer did not receive exit")
	}
	select {
	case <-errCalled:
		t.Fatal("monitor released the lease during ledger mutation")
	case <-time.After(100 * time.Millisecond):
	}
	if lease, err := (FileLocker{}).TryLock(p.LockFile); !errors.Is(err, ErrLockHeld) {
		if lease != nil {
			_ = lease.Release()
		}
		t.Fatalf("second process acquired lease: %v", err)
	}
	s.queueMu.Unlock()
	queueHeld = false
	select {
	case err := <-forgot:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("forget did not finish")
	}
	select {
	case <-errCalled:
	case <-time.After(3 * time.Second):
		t.Fatal("monitor did not finalize")
	}
	deadline = time.Now().Add(3 * time.Second)
	for {
		lease, err := (FileLocker{}).TryLock(p.LockFile)
		if err == nil {
			_ = lease.Release()
			break
		}
		if !errors.Is(err, ErrLockHeld) || time.Now().After(deadline) {
			t.Fatalf("lease was not released: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
	assertPreservedFile(t, path)
	snapshot, err := s.Snapshot(context.Background())
	if err != nil || len(snapshot.PreservedPartials) != 0 {
		t.Fatalf("ledger update lost: %#v %v", snapshot.PreservedPartials, err)
	}
}
