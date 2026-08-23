package transfer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"
)

const (
	// HostConfigVersion is the only host configuration schema this build can
	// read and write. Future migrations must be explicit rather than silently
	// discarding fields from a newer file.
	HostConfigVersion = 1

	maxSourcesPerAdd     = 16
	maxSourceLength      = 8 * 1024
	maxRequestHeaders    = 16
	maxHeaderNameLength  = 128
	maxHeaderValueLength = 4 * 1024
	maxHeaderBytes       = 16 * 1024
	maxDestinationLength = 4 * 1024

	PersistenceWarningMessage = "The transfer action succeeded, but its resumable local state could not be fully saved. Refresh to confirm current state and keep ProtoPeek running until active work finishes."
)

type HostConfig struct {
	Version                     int    `json:"version"`
	Aria2Path                   string `json:"aria2Path,omitempty"`
	DownloadDirectory           string `json:"downloadDirectory"`
	MaxActiveJobs               int    `json:"maxActiveJobs"`
	MaxQueuedJobs               int    `json:"maxQueuedJobs"`
	MaxTrackedJobs              int    `json:"maxTrackedJobs"`
	MaxConnectionsPerHost       int    `json:"maxConnectionsPerHost"`
	Split                       int    `json:"split"`
	MinSplitSizeBytes           int64  `json:"minSplitSizeBytes"`
	MaxDownloadBytesPerSecond   int64  `json:"maxDownloadBytesPerSecond"`
	MinimumFreeDiskBytes        int64  `json:"minimumFreeDiskBytes"`
	ContinuePartialDownloads    bool   `json:"continuePartialDownloads"`
	AlwaysResume                bool   `json:"alwaysResume"`
	FileAllocation              string `json:"fileAllocation"`
	AutoRenameConflictingFiles  bool   `json:"autoRenameConflictingFiles"`
	AllowOverwriteExistingFiles bool   `json:"allowOverwriteExistingFiles"`
	AllowInsecureTLS            bool   `json:"allowInsecureTls"`
	UserAgent                   string `json:"userAgent"`
}

// HostConfigPatch is the browser-owned allowlist for host/runtime settings.
// Pointer fields preserve the distinction between an omitted field (keep the
// current value) and an explicit zero/false/empty-string update. Fields that
// are intentionally not exposed here remain preserved from the on-disk
// configuration when a patch is applied.
type HostConfigPatch struct {
	Aria2Path                   *string `json:"aria2Path,omitempty"`
	DownloadDirectory           *string `json:"downloadDirectory,omitempty"`
	MaxActiveJobs               *int    `json:"maxActiveJobs,omitempty"`
	MaxConnectionsPerHost       *int    `json:"maxConnectionsPerHost,omitempty"`
	MaxDownloadBytesPerSecond   *int64  `json:"maxDownloadBytesPerSecond,omitempty"`
	MinimumFreeDiskBytes        *int64  `json:"minimumFreeDiskBytes,omitempty"`
	ContinuePartialDownloads    *bool   `json:"continuePartialDownloads,omitempty"`
	AlwaysResume                *bool   `json:"alwaysResume,omitempty"`
	FileAllocation              *string `json:"fileAllocation,omitempty"`
	AutoRenameConflictingFiles  *bool   `json:"autoRenameConflictingFiles,omitempty"`
	AllowOverwriteExistingFiles *bool   `json:"allowOverwriteExistingFiles,omitempty"`
	AllowInsecureTLS            *bool   `json:"allowInsecureTls,omitempty"`
}

// HostConfigPatchRequest is deliberately flat so strict JSON decoding can
// reject every field outside the expected revision and the allowlisted patch.
type HostConfigPatchRequest struct {
	ExpectedRevision string `json:"expectedRevision"`
	HostConfigPatch
}

// UnmarshalJSON keeps the flat request shape while distinguishing an omitted
// pointer field from an explicit null. Null is never a valid host-setting
// mutation: omission preserves the hidden/current value, whereas null would
// otherwise silently look like omission to encoding/json.
func (request *HostConfigPatchRequest) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return fmt.Errorf("host config request must be a JSON object")
	}
	*request = HostConfigPatchRequest{}
	for name, raw := range fields {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("json: host config field %q cannot be null", name)
		}
		var destination any
		switch name {
		case "expectedRevision":
			destination = &request.ExpectedRevision
		case "aria2Path":
			destination = &request.Aria2Path
		case "downloadDirectory":
			destination = &request.DownloadDirectory
		case "maxActiveJobs":
			destination = &request.MaxActiveJobs
		case "maxConnectionsPerHost":
			destination = &request.MaxConnectionsPerHost
		case "maxDownloadBytesPerSecond":
			destination = &request.MaxDownloadBytesPerSecond
		case "minimumFreeDiskBytes":
			destination = &request.MinimumFreeDiskBytes
		case "continuePartialDownloads":
			destination = &request.ContinuePartialDownloads
		case "alwaysResume":
			destination = &request.AlwaysResume
		case "fileAllocation":
			destination = &request.FileAllocation
		case "autoRenameConflictingFiles":
			destination = &request.AutoRenameConflictingFiles
		case "allowOverwriteExistingFiles":
			destination = &request.AllowOverwriteExistingFiles
		case "allowInsecureTls":
			destination = &request.AllowInsecureTLS
		default:
			return fmt.Errorf("json: unknown field %q", name)
		}
		if err := json.Unmarshal(raw, destination); err != nil {
			return err
		}
	}
	return nil
}

func (patch HostConfigPatch) Empty() bool {
	return patch.Aria2Path == nil &&
		patch.DownloadDirectory == nil &&
		patch.MaxActiveJobs == nil &&
		patch.MaxConnectionsPerHost == nil &&
		patch.MaxDownloadBytesPerSecond == nil &&
		patch.MinimumFreeDiskBytes == nil &&
		patch.ContinuePartialDownloads == nil &&
		patch.AlwaysResume == nil &&
		patch.FileAllocation == nil &&
		patch.AutoRenameConflictingFiles == nil &&
		patch.AllowOverwriteExistingFiles == nil &&
		patch.AllowInsecureTLS == nil
}

func (patch HostConfigPatch) Apply(config HostConfig) HostConfig {
	if patch.Aria2Path != nil {
		config.Aria2Path = *patch.Aria2Path
	}
	if patch.DownloadDirectory != nil {
		config.DownloadDirectory = *patch.DownloadDirectory
	}
	if patch.MaxActiveJobs != nil {
		config.MaxActiveJobs = *patch.MaxActiveJobs
	}
	if patch.MaxConnectionsPerHost != nil {
		config.MaxConnectionsPerHost = *patch.MaxConnectionsPerHost
	}
	if patch.MaxDownloadBytesPerSecond != nil {
		config.MaxDownloadBytesPerSecond = *patch.MaxDownloadBytesPerSecond
	}
	if patch.MinimumFreeDiskBytes != nil {
		config.MinimumFreeDiskBytes = *patch.MinimumFreeDiskBytes
	}
	if patch.ContinuePartialDownloads != nil {
		config.ContinuePartialDownloads = *patch.ContinuePartialDownloads
	}
	if patch.AlwaysResume != nil {
		config.AlwaysResume = *patch.AlwaysResume
	}
	if patch.FileAllocation != nil {
		config.FileAllocation = *patch.FileAllocation
	}
	if patch.AutoRenameConflictingFiles != nil {
		config.AutoRenameConflictingFiles = *patch.AutoRenameConflictingFiles
	}
	if patch.AllowOverwriteExistingFiles != nil {
		config.AllowOverwriteExistingFiles = *patch.AllowOverwriteExistingFiles
	}
	if patch.AllowInsecureTLS != nil {
		config.AllowInsecureTLS = *patch.AllowInsecureTLS
	}
	return config
}

type Paths struct {
	ConfigFile       string
	StateDirectory   string
	SessionFile      string
	VerificationFile string
	LockFile         string
}

type Health struct {
	Ready         bool   `json:"ready"`
	Status        string `json:"status"`
	Message       string `json:"message"`
	BinaryPath    string `json:"binaryPath,omitempty"`
	EngineVersion string `json:"engineVersion,omitempty"`
}

type JobStatus string

const (
	JobQueued      JobStatus = "queued"
	JobDownloading JobStatus = "downloading"
	JobPaused      JobStatus = "paused"
	JobCompleted   JobStatus = "completed"
	JobFailed      JobStatus = "failed"
	JobCancelled   JobStatus = "cancelled"
	JobUnknown     JobStatus = "unknown"
)

type Job struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Status          JobStatus `json:"status"`
	Directory       string    `json:"directory,omitempty"`
	OutputPath      string    `json:"outputPath,omitempty"`
	Source          string    `json:"source,omitempty"`
	TotalBytes      int64     `json:"totalBytes"`
	CompletedBytes  int64     `json:"completedBytes"`
	ProgressPercent float64   `json:"progressPercent"`
	BytesPerSecond  int64     `json:"bytesPerSecond"`
	Connections     int       `json:"connections"`
	ETASeconds      int64     `json:"etaSeconds"`
	ErrorCode       string    `json:"errorCode,omitempty"`
	ErrorMessage    string    `json:"errorMessage,omitempty"`
	ExpectedSHA256  string    `json:"expectedSha256,omitempty"`
	ActualSHA256    string    `json:"actualSha256,omitempty"`
	VerifiedBytes   int64     `json:"verifiedBytes,omitempty"`
	Verification    string    `json:"verificationStatus"`
	VerifyMessage   string    `json:"verificationMessage,omitempty"`
	RetryAvailable  bool      `json:"retryAvailable"`
	RetryReason     string    `json:"retryUnavailableReason,omitempty"`
}

type Metrics struct {
	ActiveCount    int   `json:"activeCount"`
	QueuedCount    int   `json:"queuedCount"`
	PausedCount    int   `json:"pausedCount"`
	CompletedCount int   `json:"completedCount"`
	FailedCount    int   `json:"failedCount"`
	CancelledCount int   `json:"cancelledCount"`
	TotalCount     int   `json:"totalCount"`
	BytesPerSecond int64 `json:"bytesPerSecond"`
}

type Snapshot struct {
	ObservedAt     time.Time  `json:"observedAt"`
	Health         Health     `json:"health"`
	Config         HostConfig `json:"config"`
	ConfigRevision string     `json:"configRevision"`
	Metrics        Metrics    `json:"metrics"`
	Jobs           []Job      `json:"jobs"`
}

type AddRequest struct {
	// Sources are mirrors for one logical download, not separate queue items.
	Sources              []string        `json:"sources"`
	OutputName           string          `json:"outputName,omitempty"`
	SHA256               string          `json:"sha256,omitempty"`
	DestinationDirectory string          `json:"destinationDirectory,omitempty"`
	Headers              []RequestHeader `json:"headers,omitempty"`
	UserAgent            string          `json:"userAgent,omitempty"`
}

// RequestHeader is a bounded per-job HTTP request header. Header values are
// deliberately write-only: transfer snapshots and mutation results never
// return them to the browser or CLI.
type RequestHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type AddResult struct {
	ID                 string `json:"id"`
	ExpectedSHA256     string `json:"expectedSha256,omitempty"`
	Verification       string `json:"verificationStatus"`
	PersistenceWarning string `json:"persistenceWarning,omitempty"`
}

type MutationResult struct {
	PersistenceWarning string `json:"persistenceWarning,omitempty"`
}

type EngineSnapshot struct {
	Jobs []Job
	// PendingCount is the engine-wide queued-or-paused count. It is kept
	// separately from the public metrics because Jobs may be intentionally
	// truncated to MaxTrackedJobs, while admission limits must still account
	// for every pending item in a restored aria2 session.
	PendingCount int
	Metrics      Metrics
}

// Engine is the shared transfer contract used by the browser API and CLI.
// Implementations must never delete downloaded or partially downloaded files.
type Engine interface {
	Snapshot(ctx context.Context, maxTracked int) (EngineSnapshot, error)
	Add(ctx context.Context, request AddRequest, config HostConfig) (string, error)
	Pause(ctx context.Context, id string) error
	Resume(ctx context.Context, id string) error
	Retry(ctx context.Context, id string, request AddRequest, config HostConfig) (string, error)
	Cancel(ctx context.Context, id string) error
	SaveSession(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

type Runtime struct {
	Engine        Engine
	BinaryPath    string
	EngineVersion string
	Done          <-chan struct{}
	Stop          func(context.Context) error
	Err           func() error
}

type Launcher interface {
	Start(ctx context.Context, config HostConfig, paths Paths) (*Runtime, error)
}

type Lock interface {
	Release() error
}

type Locker interface {
	TryLock(path string) (Lock, error)
}
