package cloudflared

import "time"

type PrivilegeEvidence struct {
	ProcessElevated   bool
	Mechanism         string
	ServiceActionNote string
}

// ToolObservation contains only non-secret executable metadata.
type ToolObservation struct {
	Found   bool   `json:"found"`
	Path    string `json:"path"`
	Version string `json:"version"`
	Note    string `json:"note"`
}

// ServiceObservation describes the one canonical cloudflared service for the host.
// Raw command lines and token values intentionally never cross this boundary.
type ServiceObservation struct {
	Manager           string `json:"manager"`
	Label             string `json:"label"`
	Present           bool   `json:"present"`
	State             string `json:"state"`
	Detail            string `json:"detail"`
	PID               int    `json:"pid"`
	ExecutablePath    string `json:"executablePath"`
	ConfigPath        string `json:"configPath"`
	CredentialSource  string `json:"credentialSource"`
	actionTarget      string
	definitionPath    string
	loaded            bool
	argumentsObserved bool
}

// IngressRoute is a redacted view of a cloudflared ingress rule.
type IngressRoute struct {
	Hostname string `json:"hostname"`
	Path     string `json:"path"`
	Service  string `json:"service"`
	Protocol string `json:"protocol"`
	CatchAll bool   `json:"catchAll"`
}

// ConfigCandidate records bounded metadata for one documented or explicit config path.
type ConfigCandidate struct {
	Path                    string         `json:"path"`
	Source                  string         `json:"source"`
	Exists                  bool           `json:"exists"`
	Readable                bool           `json:"readable"`
	Regular                 bool           `json:"regular"`
	Symlink                 bool           `json:"symlink"`
	Valid                   bool           `json:"valid"`
	Effective               bool           `json:"effective"`
	BoundToCanonicalService bool           `json:"boundToCanonicalService"`
	ServiceBinding          string         `json:"serviceBinding"`
	ManagementMode          string         `json:"managementMode"`
	Tunnel                  string         `json:"tunnel"`
	CredentialsPath         string         `json:"credentialsPath"`
	Revision                string         `json:"revision"`
	CatchAllPresent         bool           `json:"catchAllPresent"`
	Routes                  []IngressRoute `json:"routes"`
	Warnings                []string       `json:"warnings"`
}

// Observation is a single explicit, bounded host inspection.
type Observation struct {
	Cloudflared ToolObservation    `json:"cloudflared"`
	Wrangler    ToolObservation    `json:"wrangler"`
	Docker      ToolObservation    `json:"docker"`
	Service     ServiceObservation `json:"service"`
	Configs     []ConfigCandidate  `json:"configs"`
	Notes       []string           `json:"notes"`
}

// ServiceAction is deliberately closed: callers cannot supply a service name,
// executable, argument, or arbitrary command.
type ServiceAction string

const (
	ServiceActionStart   ServiceAction = "start"
	ServiceActionStop    ServiceAction = "stop"
	ServiceActionRestart ServiceAction = "restart"
)

// ServiceActionRequest carries the two safety gates required before changing
// the canonical cloudflared service.
type ServiceActionRequest struct {
	Action        ServiceAction
	ExpectedState string
	Confirmed     bool
}

// ServiceActionResult describes a real attempt against the canonical service.
// Status is one of not-installed, unchanged, completed, stale, failed, or
// elevation-required.
type ServiceActionResult struct {
	Action             ServiceAction
	Status             string
	Message            string
	ElevationRequired  bool
	ElevationMechanism string
	ManualCommand      string
	Service            ServiceObservation
	ObservedAt         time.Time
}

// ReleaseObservation is a bounded view of the official latest GitHub release.
type ReleaseObservation struct {
	CheckedAt        time.Time
	InstalledVersion string
	LatestVersion    string
	Status           string
	SupportStatus    string
	PublishedAt      time.Time
	ReleaseURL       string
	DownloadsURL     string
	Note             string
}
