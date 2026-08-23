package transfer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigStoreMissingIsReadOnly(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "nested", "transfers.json")
	store := NewConfigStore(path)

	config, exists, err := store.Load()
	if err != nil {
		t.Fatalf("load missing config: %v", err)
	}
	if exists {
		t.Fatal("missing config reported as existing")
	}
	if config.Version != HostConfigVersion {
		t.Fatalf("default version = %d", config.Version)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("read-only load created a directory or returned unexpected error: %v", err)
	}
}

func TestDefaultPathsKeepVerificationMetadataBesideSession(t *testing.T) {
	t.Parallel()
	paths, err := DefaultPaths()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(paths.VerificationFile) != paths.StateDirectory || filepath.Dir(paths.SessionFile) != paths.StateDirectory {
		t.Fatalf("paths = %#v", paths)
	}
	if filepath.Base(paths.VerificationFile) != "verification.json" {
		t.Fatalf("verification file = %q", paths.VerificationFile)
	}
}

func TestConfigStoreRoundTripAndPermissions(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "protopeek", "transfers.json")
	store := NewConfigStore(path)
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	config.MaxActiveJobs = 7
	config.MaxQueuedJobs = 80
	config.MaxTrackedJobs = 200
	config.MaxDownloadBytesPerSecond = 12 << 20

	if err := store.Save(config); err != nil {
		t.Fatalf("save config: %v", err)
	}
	loaded, exists, err := store.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !exists || loaded != config {
		t.Fatalf("round trip = %#v, exists=%v; want %#v", loaded, exists, config)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat config: %v", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("config permissions = %o; want user-only", info.Mode().Perm())
	}
}

func TestConfigStoreDefaultsFieldsAddedWithinVersionOne(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	path := filepath.Join(directory, "transfers.json")
	store := NewConfigStore(path)
	config := DefaultHostConfig()
	config.DownloadDirectory = directory
	if err := store.Save(config); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	legacy := strings.ReplaceAll(string(data), "  \"alwaysResume\": true,\n", "")
	legacy = strings.ReplaceAll(legacy, "  \"fileAllocation\": \"prealloc\",\n", "")
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	loaded, exists, err := store.Load()
	if err != nil {
		t.Fatalf("load earlier v1 config: %v", err)
	}
	if !exists || !loaded.AlwaysResume || loaded.FileAllocation != "prealloc" {
		t.Fatalf("additive defaults = %#v, exists=%v", loaded, exists)
	}
}

func TestConfigStoreRejectsFutureAndUnknownFields(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	path := filepath.Join(directory, "transfers.json")
	base := DefaultHostConfig()
	base.DownloadDirectory = directory
	store := NewConfigStore(path)
	if err := os.WriteFile(path, []byte(`{"downloadDirectory":"/tmp"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "unsupported transfer config version 0") {
		t.Fatalf("missing version error = %v", err)
	}

	if err := os.WriteFile(path, []byte(`{"version":99}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "unsupported transfer config version") {
		t.Fatalf("future version error = %v", err)
	}

	if err := store.Save(base); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), "\n}", ",\n  \"futureField\": true\n}", 1))
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown field error = %v", err)
	}
}

func TestValidateHostConfigEnforcesResourceBounds(t *testing.T) {
	t.Parallel()
	config := DefaultHostConfig()
	config.MaxActiveJobs = 17
	if err := ValidateHostConfig(config); err == nil {
		t.Fatal("expected active-job bound error")
	}
	config = DefaultHostConfig()
	config.AllowOverwriteExistingFiles = true
	if err := ValidateHostConfig(config); err == nil {
		t.Fatal("expected conflicting overwrite policy error")
	}
}
