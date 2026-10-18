package transfer

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConfiguredAria2PathHandlesUnavailableService(t *testing.T) {
	t.Parallel()
	var service *Service
	if path, err := service.ConfiguredAria2Path(); err == nil || path != "" {
		t.Fatalf("nil service = %q %v", path, err)
	}
}

func TestConfiguredAria2PathReadsDiskWithoutEngineOrStateWrites(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	config := DefaultHostConfig()
	config.Aria2Path = filepath.Join(dir, "from-memory")
	store := NewConfigStore(filepath.Join(dir, "config.json"))
	engine := &fakeEngine{}
	service := &Service{config: config}
	path, err := service.ConfiguredAria2Path()
	if err != nil || path != config.Aria2Path {
		t.Fatalf("memory config = %q %v", path, err)
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
		t.Fatalf("read created state: %v %v", entries, err)
	}
	service.configStore = store
	if path, err := service.ConfiguredAria2Path(); err != nil || path != "" {
		t.Fatalf("absent saved config must use startup defaults: %q %v", path, err)
	}
	diskConfig := config
	diskConfig.Aria2Path = filepath.Join(dir, "from-disk")
	if err := store.Save(diskConfig); err != nil {
		t.Fatal(err)
	}
	path, err = service.ConfiguredAria2Path()
	if err != nil || path != diskConfig.Aria2Path || service.config.Aria2Path != config.Aria2Path {
		t.Fatalf("read-only disk config = %q %v; memory %#v", path, err, service.config)
	}
	service.runtime = &Runtime{Engine: engine}
	path, err = service.ConfiguredAria2Path()
	if err != nil || path != config.Aria2Path || len(engine.calls) != 0 {
		t.Fatalf("running config = %q %v; calls %v", path, err, engine.calls)
	}
}

func TestConfiguredAria2PathDoesNotWaitForEngineOperation(t *testing.T) {
	t.Parallel()
	service := &Service{config: DefaultHostConfig(), starting: true}
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	done := make(chan error, 1)
	go func() {
		_, err := service.ConfiguredAria2Path()
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("metadata read waited for the engine operation lock")
	}
}

func TestConfiguredAria2PathRejectsMalformedSavedSettings(t *testing.T) {
	t.Parallel()
	file := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(file, []byte("not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &Service{config: DefaultHostConfig(), configStore: NewConfigStore(file)}
	if path, err := service.ConfiguredAria2Path(); err == nil || path != "" {
		t.Fatalf("malformed settings accepted: %q %v", path, err)
	}
}
