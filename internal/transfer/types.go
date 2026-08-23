package transfer

import (
	"context"
	"time"
)

const (
	// HostConfigVersion is the only host configuration schema this build can
	// read and write. Future migrations must be explicit rather than silently
	// discarding fields from a newer file.
	HostConfigVersion = 1

	maxSourcesPerAdd = 16
	maxSourceLength  = 8 * 1024

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
	AutoRenameConflictingFiles  bool   `json:"autoRenameConflictingFiles"`
	AllowOverwriteExistingFiles bool   `json:"allowOverwriteExistingFiles"`
	AllowInsecureTLS            bool   `json:"allowInsecureTls"`
	UserAgent                   string `json:"userAgent"`
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
	ObservedAt time.Time  `json:"observedAt"`
	Health     Health     `json:"health"`
	Config     HostConfig `json:"config"`
	Metrics    Metrics    `json:"metrics"`
	Jobs       []Job      `json:"jobs"`
}

type AddRequest struct {
	// Sources are mirrors for one logical download, not separate queue items.
	Sources    []string `json:"sources"`
	OutputName string   `json:"outputName,omitempty"`
	SHA256     string   `json:"sha256,omitempty"`
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
	Retry(ctx context.Context, id string, config HostConfig, expectedSHA256 string) (string, error)
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
