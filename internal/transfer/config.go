package transfer

import (
	"bytes"
	"crypto/sha256"
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
	maxConfigFileBytes        = 16 << 10
	maxConfigPathLength       = 4 << 10
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
	if len(config.Aria2Path) > maxConfigPathLength || len(config.DownloadDirectory) > maxConfigPathLength {
		return fmt.Errorf("configured paths must be at most %d bytes", maxConfigPathLength)
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

// ValidateHostConfigPatch checks field-local bounds before a request reaches
// the service. Cross-field constraints are rechecked after the patch is
// applied to the freshly reloaded disk config.
func ValidateHostConfigPatch(patch HostConfigPatch) error {
	if patch.DownloadDirectory != nil {
		if len(*patch.DownloadDirectory) > maxConfigPathLength {
			return fmt.Errorf("configured paths must be at most %d bytes", maxConfigPathLength)
		}
		if strings.TrimSpace(*patch.DownloadDirectory) == "" {
			return errors.New("download directory is required")
		}
		if !filepath.IsAbs(*patch.DownloadDirectory) {
			return errors.New("download directory must be an absolute path")
		}
	}
	if patch.Aria2Path != nil && len(*patch.Aria2Path) > maxConfigPathLength {
		return fmt.Errorf("configured paths must be at most %d bytes", maxConfigPathLength)
	}
	if patch.Aria2Path != nil && containsControl(*patch.Aria2Path) {
		return errors.New("configured paths must not contain control characters")
	}
	if patch.DownloadDirectory != nil && containsControl(*patch.DownloadDirectory) {
		return errors.New("configured paths must not contain control characters")
	}
	if patch.MaxActiveJobs != nil && (*patch.MaxActiveJobs < 1 || *patch.MaxActiveJobs > 16) {
		return errors.New("max active jobs must be between 1 and 16")
	}
	if patch.MaxConnectionsPerHost != nil && (*patch.MaxConnectionsPerHost < 1 || *patch.MaxConnectionsPerHost > 16) {
		return errors.New("max connections per host must be between 1 and 16")
	}
	if patch.MaxDownloadBytesPerSecond != nil && (*patch.MaxDownloadBytesPerSecond < 0 || *patch.MaxDownloadBytesPerSecond > maxBandwidthBytesPerSec) {
		return fmt.Errorf("download bandwidth limit must be between 0 and %d bytes per second", maxBandwidthBytesPerSec)
	}
	if patch.MinimumFreeDiskBytes != nil && (*patch.MinimumFreeDiskBytes < 0 || *patch.MinimumFreeDiskBytes > maxMinimumFreeDiskBytes) {
		return fmt.Errorf("minimum free disk reserve must be between 0 and %d bytes", maxMinimumFreeDiskBytes)
	}
	if patch.FileAllocation != nil {
		switch *patch.FileAllocation {
		case "none", "prealloc", "trunc", "falloc":
		default:
			return errors.New("file allocation must be none, prealloc, trunc, or falloc")
		}
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
	mu       sync.RWMutex
	path     string
	readFile func(string) ([]byte, error)
	syncDir  func(string) error
}

func NewConfigStore(path string) *ConfigStore {
	return &ConfigStore{path: path, readFile: readConfigFile, syncDir: syncDirectory}
}

func (store *ConfigStore) Path() string {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.path
}

// Load returns defaults without writing them when the host config is absent.
// This keeps startup and read-only snapshots free of surprising disk writes.
func (store *ConfigStore) Load() (config HostConfig, exists bool, err error) {
	config, exists, _, err = store.LoadWithRevision()
	return config, exists, err
}

// LoadWithRevision returns the normalized config and its deterministic hash.
// The revision is derived from the decoded full config, so formatting-only
// rewrites do not create false optimistic-concurrency conflicts.
func (store *ConfigStore) LoadWithRevision() (config HostConfig, exists bool, revision string, err error) {
	store.mu.RLock()
	path, readFile := store.path, store.readFile
	store.mu.RUnlock()
	if readFile == nil {
		readFile = readConfigFile
	}

	data, err := readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			config := DefaultHostConfig()
			return config, false, HostConfigRevision(config), nil
		}
		return HostConfig{}, false, "", fmt.Errorf("read transfer config: %w", err)
	}

	// Version 1 has gained additive fields over time. Decode onto the current
	// defaults so a config written by an earlier v1 build keeps working while
	// unknown fields and future schema versions still fail closed.
	config = DefaultHostConfig()
	config.Version = 0
	if err := decodeStrictJSON(data, &config); err != nil {
		return HostConfig{}, true, "", fmt.Errorf("decode transfer config: %w", err)
	}
	if err := ValidateHostConfig(config); err != nil {
		return HostConfig{}, true, "", fmt.Errorf("validate transfer config: %w", err)
	}
	return config, true, HostConfigRevision(config), nil
}

// readConfigFile keeps the private host-settings file bounded and refuses
// filesystem objects that are not the regular file written by ConfigStore.
// Lstat deliberately rejects symlinks: this endpoint controls executable and
// filesystem paths, so following a link would make its trust boundary depend
// on an unrelated path owner.
func readConfigFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("transfer config must be a regular file")
	}
	if info.Size() > maxConfigFileBytes {
		return nil, fmt.Errorf("transfer config exceeds %d-byte limit", maxConfigFileBytes)
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !openedInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("transfer config must be a regular file")
	}
	if !os.SameFile(info, openedInfo) {
		return nil, fmt.Errorf("transfer config changed while being opened")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxConfigFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxConfigFileBytes {
		return nil, fmt.Errorf("transfer config exceeds %d-byte limit", maxConfigFileBytes)
	}
	return data, nil
}

var ErrConfigCommitDurability = errors.New("transfer config was replaced but directory durability could not be confirmed")

// ConfigCommitError reports a post-rename directory-sync failure. The target
// file has already been replaced when this error is returned; callers must
// apply the new config in memory and surface the durability uncertainty rather
// than pretending that the old disk state remains authoritative.
type ConfigCommitError struct {
	err error
}

// NewConfigCommitError is used by boundary tests and adapters that need to
// model the post-rename directory-sync uncertainty without recreating a file
// operation. The rename has already committed when this error is returned.
func NewConfigCommitError(cause error) *ConfigCommitError {
	if cause == nil {
		cause = errors.New("directory sync failed")
	}
	return &ConfigCommitError{err: cause}
}

func (err *ConfigCommitError) Error() string {
	return fmt.Sprintf("%s: %v", ErrConfigCommitDurability, err.err)
}

func (err *ConfigCommitError) Unwrap() error {
	return err.err
}

func (err *ConfigCommitError) Is(target error) bool {
	return target == ErrConfigCommitDurability
}

func (store *ConfigStore) Save(config HostConfig) error {
	if err := ValidateHostConfig(config); err != nil {
		return err
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	syncDir := store.syncDir
	if syncDir == nil {
		syncDir = syncDirectory
	}

	data, err := marshalHostConfig(config)
	if err != nil {
		return fmt.Errorf("encode transfer config: %w", err)
	}

	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create transfer config directory: %w", err)
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
	if _, err := temporary.Write(data); err != nil {
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
	if err := syncDir(directory); err != nil {
		return NewConfigCommitError(fmt.Errorf("sync transfer config directory: %w", err))
	}
	return nil
}

func marshalHostConfig(config HostConfig) ([]byte, error) {
	if err := ValidateHostConfig(config); err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')
	if len(data) > maxConfigFileBytes {
		return nil, fmt.Errorf("serialized transfer config exceeds %d-byte limit", maxConfigFileBytes)
	}
	return data, nil
}

// HostConfigRevision is the deterministic optimistic-concurrency token for a
// complete normalized host config. JSON struct-field order is stable here and
// omitempty preserves the same meaning for an empty optional executable path.
func HostConfigRevision(config HostConfig) string {
	data, _ := json.Marshal(config)
	digest := sha256.Sum256(data)
	return fmt.Sprintf("%x", digest[:])
}

func decodeStrictJSON(data []byte, destination any) error {
	if err := rejectDuplicateJSONKeys(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	return ensureJSONEOF(decoder)
}

// DecodeStrictJSON validates one JSON value, rejects duplicate object keys and
// unknown fields, and refuses trailing values. Standalone HTTP handlers use the
// same decoder as the private ConfigStore format so request and disk parsing
// have identical fail-closed semantics.
func DecodeStrictJSON(data []byte, destination any) error {
	return decodeStrictJSON(data, destination)
}

func rejectDuplicateJSONKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := walkJSONValue(decoder); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func walkJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, isDelimiter := token.(json.Delim)
	if !isDelimiter {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make([]string, 0, 8)
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return err
			}
			keyString, ok := key.(string)
			if !ok {
				return errors.New("JSON object key is not a string")
			}
			for _, previous := range seen {
				// encoding/json matches struct fields case-insensitively. Treat
				// aliases such as maxActiveJobs/MaxActiveJobs as duplicates too,
				// so strict decoding never accepts two spellings for one field.
				if strings.EqualFold(previous, keyString) {
					return fmt.Errorf("duplicate JSON field %q", keyString)
				}
			}
			seen = append(seen, keyString)
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return fmt.Errorf("unexpected JSON delimiter %q", delimiter)
	}
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
