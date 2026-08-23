package transfer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	minSplitSizeBytes         = int64(1 << 20)
	maxSplitSizeBytes         = int64(1 << 30)
	maxBandwidthBytesPerSec   = int64(1 << 40)
	maxMinimumFreeDiskBytes   = int64(1 << 50)
	maxUserAgentLength        = 256
	defaultMinimumFreeDisk    = int64(512 << 20)
	defaultMinSplitSize       = int64(1 << 20)
	defaultMaxTrackedJobs     = 512
	defaultMaxQueuedJobs      = 128
	defaultMaxActiveJobs      = 4
	defaultConnectionsPerHost = 8
)

func DefaultHostConfig() HostConfig {
	return HostConfig{
		Version:                     HostConfigVersion,
		DownloadDirectory:           defaultDownloadDirectory(),
		MaxActiveJobs:               defaultMaxActiveJobs,
		MaxQueuedJobs:               defaultMaxQueuedJobs,
		MaxTrackedJobs:              defaultMaxTrackedJobs,
		MaxConnectionsPerHost:       defaultConnectionsPerHost,
		Split:                       defaultConnectionsPerHost,
		MinSplitSizeBytes:           defaultMinSplitSize,
		MinimumFreeDiskBytes:        defaultMinimumFreeDisk,
		ContinuePartialDownloads:    true,
		AlwaysResume:                true,
		FileAllocation:              "prealloc",
		AutoRenameConflictingFiles:  true,
		AllowOverwriteExistingFiles: false,
		AllowInsecureTLS:            false,
		UserAgent:                   "ProtoPeek",
	}
}

func DefaultPaths() (Paths, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return Paths{}, fmt.Errorf("resolve user config directory: %w", err)
	}
	root = filepath.Join(root, "protopeek")
	state := filepath.Join(root, "transfers")
	return Paths{
		ConfigFile:       filepath.Join(root, "transfers.json"),
		StateDirectory:   state,
		SessionFile:      filepath.Join(state, "session.aria2"),
		VerificationFile: filepath.Join(state, "verification.json"),
		LockFile:         filepath.Join(state, "engine.lock"),
	}, nil
}

func ValidateHostConfig(config HostConfig) error {
	if config.Version != HostConfigVersion {
		return fmt.Errorf("unsupported transfer config version %d (supported: %d)", config.Version, HostConfigVersion)
	}
	if strings.TrimSpace(config.DownloadDirectory) == "" {
		return errors.New("download directory is required")
	}
	if !filepath.IsAbs(config.DownloadDirectory) {
		return errors.New("download directory must be an absolute path")
	}
	if containsControl(config.DownloadDirectory) || containsControl(config.Aria2Path) {
		return errors.New("configured paths must not contain control characters")
	}
	if config.MaxActiveJobs < 1 || config.MaxActiveJobs > 16 {
		return errors.New("max active jobs must be between 1 and 16")
	}
	if config.MaxQueuedJobs < 1 || config.MaxQueuedJobs > 4096 {
		return errors.New("max queued jobs must be between 1 and 4096")
	}
	if config.MaxTrackedJobs < config.MaxActiveJobs || config.MaxTrackedJobs > 4096 {
		return errors.New("max tracked jobs must be at least max active jobs and no more than 4096")
	}
	if config.MaxQueuedJobs > config.MaxTrackedJobs {
		return errors.New("max queued jobs must not exceed max tracked jobs")
	}
	if config.MaxConnectionsPerHost < 1 || config.MaxConnectionsPerHost > 16 {
		return errors.New("max connections per host must be between 1 and 16")
	}
	if config.Split < 1 || config.Split > 16 {
		return errors.New("split must be between 1 and 16")
	}
	if config.MinSplitSizeBytes < minSplitSizeBytes || config.MinSplitSizeBytes > maxSplitSizeBytes {
		return fmt.Errorf("minimum split size must be between %d and %d bytes", minSplitSizeBytes, maxSplitSizeBytes)
	}
	if config.MaxDownloadBytesPerSecond < 0 || config.MaxDownloadBytesPerSecond > maxBandwidthBytesPerSec {
		return fmt.Errorf("download bandwidth limit must be between 0 and %d bytes per second", maxBandwidthBytesPerSec)
	}
	if config.MinimumFreeDiskBytes < 0 || config.MinimumFreeDiskBytes > maxMinimumFreeDiskBytes {
		return fmt.Errorf("minimum free disk reserve must be between 0 and %d bytes", maxMinimumFreeDiskBytes)
	}
	switch config.FileAllocation {
	case "none", "prealloc", "trunc", "falloc":
	default:
		return errors.New("file allocation must be none, prealloc, trunc, or falloc")
	}
	if config.AllowOverwriteExistingFiles && config.AutoRenameConflictingFiles {
		return errors.New("overwrite and auto-rename cannot both be enabled")
	}
	if len(config.UserAgent) > maxUserAgentLength || containsControl(config.UserAgent) {
		return fmt.Errorf("user agent must be at most %d characters without control characters", maxUserAgentLength)
	}
	return nil
}

func ValidatePaths(paths Paths) error {
	for label, path := range map[string]string{
		"config file":       paths.ConfigFile,
		"state directory":   paths.StateDirectory,
		"session file":      paths.SessionFile,
		"verification file": paths.VerificationFile,
		"lock file":         paths.LockFile,
	} {
		if path == "" || !filepath.IsAbs(path) {
			return fmt.Errorf("%s must be an absolute path", label)
		}
		if containsControl(path) {
			return fmt.Errorf("%s must not contain control characters", label)
		}
	}
	return nil
}

type ConfigStore struct {
	mu   sync.RWMutex
	path string
}

func NewConfigStore(path string) *ConfigStore {
	return &ConfigStore{path: path}
}

func (store *ConfigStore) Path() string {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.path
}

// Load returns defaults without writing them when the host config is absent.
// This keeps startup and read-only snapshots free of surprising disk writes.
func (store *ConfigStore) Load() (config HostConfig, exists bool, err error) {
	store.mu.RLock()
	path := store.path
	store.mu.RUnlock()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultHostConfig(), false, nil
		}
		return HostConfig{}, false, fmt.Errorf("read transfer config: %w", err)
	}

	// Version 1 has gained additive fields over time. Decode onto the current
	// defaults so a config written by an earlier v1 build keeps working while
	// unknown fields and future schema versions still fail closed.
	config = DefaultHostConfig()
	config.Version = 0
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return HostConfig{}, true, fmt.Errorf("decode transfer config: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return HostConfig{}, true, err
	}
	if err := ValidateHostConfig(config); err != nil {
		return HostConfig{}, true, fmt.Errorf("validate transfer config: %w", err)
	}
	return config, true, nil
}

func (store *ConfigStore) Save(config HostConfig) error {
	if err := ValidateHostConfig(config); err != nil {
		return err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create transfer config directory: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode transfer config: %w", err)
	}

	temporary, err := os.CreateTemp(directory, ".transfers-*.json")
	if err != nil {
		return fmt.Errorf("create temporary transfer config: %w", err)
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()

	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("protect temporary transfer config: %w", err)
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write temporary transfer config: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary transfer config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary transfer config: %w", err)
	}
	if err := os.Rename(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace transfer config: %w", err)
	}
	committed = true
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode transfer config: multiple JSON values are not allowed")
		}
		return fmt.Errorf("decode transfer config trailer: %w", err)
	}
	return nil
}

func defaultDownloadDirectory() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			return cwd
		}
		return string(filepath.Separator)
	}
	downloads := filepath.Join(home, "Downloads")
	if info, err := os.Stat(downloads); err == nil && info.IsDir() {
		return downloads
	}
	return home
}
