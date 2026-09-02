package tunnels

import "time"

const (
	SchemaVersion = 1
	Scope         = "local-host"
	ScopeNotice   = "ProtoPeek inspects only documented cloudflared locations and the canonical local service. Secrets are never returned."
)

type Capability struct {
	Supported bool   `json:"supported"`
	Reason    string `json:"reason"`
}

type InstallCommand struct {
	ID                string `json:"id"`
	Label             string `json:"label"`
	Command           string `json:"command"`
	RequiresElevation bool   `json:"requiresElevation"`
}

type InstallGuidance struct {
	Platform           string           `json:"platform"`
	Architecture       string           `json:"architecture"`
	DownloadsURL       string           `json:"downloadsUrl"`
	ReleasesURL        string           `json:"releasesUrl"`
	ServiceDocsURL     string           `json:"serviceDocsUrl"`
	ProcessElevated    bool             `json:"processElevated"`
	ElevationMechanism string           `json:"elevationMechanism"`
	ElevationNotice    string           `json:"elevationNotice"`
	Commands           []InstallCommand `json:"commands"`
}

type Capabilities struct {
	SchemaVersion      int             `json:"schemaVersion"`
	Scope              string          `json:"scope"`
	ScopeNotice        string          `json:"scopeNotice"`
	Platform           string          `json:"platform"`
	ServiceManager     string          `json:"serviceManager"`
	ManualRefresh      Capability      `json:"manualRefresh"`
	ServiceObservation Capability      `json:"serviceObservation"`
	ConfigInspection   Capability      `json:"configInspection"`
	RoutePlanPreview   Capability      `json:"routePlanPreview"`
	ServiceControl     Capability      `json:"serviceControl"`
	ConfigMutation     Capability      `json:"configMutation"`
	AccountConnection  Capability      `json:"accountConnection"`
	BackgroundPolling  Capability      `json:"backgroundPolling"`
	Install            InstallGuidance `json:"install"`
}

type Release struct {
	SchemaVersion    int        `json:"schemaVersion"`
	CheckedAt        time.Time  `json:"checkedAt"`
	InstalledVersion string     `json:"installedVersion"`
	LatestVersion    string     `json:"latestVersion"`
	Status           string     `json:"status"`
	SupportStatus    string     `json:"supportStatus"`
	PublishedAt      *time.Time `json:"publishedAt,omitempty"`
	ReleaseURL       string     `json:"releaseUrl"`
	DownloadsURL     string     `json:"downloadsUrl"`
	Note             string     `json:"note"`
}

type ServiceActionRequest struct {
	Action        string `json:"action"`
	ExpectedState string `json:"expectedState"`
	Confirmed     bool   `json:"confirmed"`
}

type ServiceActionResponse struct {
	SchemaVersion      int       `json:"schemaVersion"`
	Action             string    `json:"action"`
	Status             string    `json:"status"`
	Message            string    `json:"message"`
	ElevationRequired  bool      `json:"elevationRequired"`
	ElevationMechanism string    `json:"elevationMechanism"`
	ManualCommand      string    `json:"manualCommand"`
	Service            Runtime   `json:"service"`
	ObservedAt         time.Time `json:"observedAt"`
}

type Tool struct {
	Found   bool   `json:"found"`
	Path    string `json:"path"`
	Version string `json:"version"`
	Note    string `json:"note"`
}

type Runtime struct {
	Manager        string `json:"manager"`
	Label          string `json:"label"`
	Present        bool   `json:"present"`
	State          string `json:"state"`
	Detail         string `json:"detail"`
	PID            int    `json:"pid"`
	ExecutablePath string `json:"executablePath"`
}

type Route struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	Path     string `json:"path"`
	Service  string `json:"service"`
	Protocol string `json:"protocol"`
	CatchAll bool   `json:"catchAll"`
}

type ConfigSource struct {
	ID                      string   `json:"id"`
	Path                    string   `json:"path"`
	Source                  string   `json:"source"`
	Exists                  bool     `json:"exists"`
	Readable                bool     `json:"readable"`
	Regular                 bool     `json:"regular"`
	Symlink                 bool     `json:"symlink"`
	Valid                   bool     `json:"valid"`
	Effective               bool     `json:"effective"`
	BoundToCanonicalService bool     `json:"boundToCanonicalService"`
	ServiceBinding          string   `json:"serviceBinding"`
	ManagementMode          string   `json:"managementMode"`
	Tunnel                  string   `json:"tunnel"`
	CredentialsPath         string   `json:"credentialsPath"`
	Revision                string   `json:"revision"`
	CatchAllPresent         bool     `json:"catchAllPresent"`
	RouteCount              int      `json:"routeCount"`
	Warnings                []string `json:"warnings"`
}

type Deployment struct {
	ID                      string   `json:"id"`
	Name                    string   `json:"name"`
	Driver                  string   `json:"driver"`
	ManagementMode          string   `json:"managementMode"`
	ConfigurationAuthority  string   `json:"configurationAuthority"`
	Status                  string   `json:"status"`
	StatusDetail            string   `json:"statusDetail"`
	ConfigPath              string   `json:"configPath"`
	ConfigRevision          string   `json:"configRevision"`
	CredentialSource        string   `json:"credentialSource"`
	ConfigSourceID          string   `json:"configSourceId"`
	BoundToCanonicalService bool     `json:"boundToCanonicalService"`
	ServiceBinding          string   `json:"serviceBinding"`
	Routes                  []Route  `json:"routes"`
	Runtime                 Runtime  `json:"runtime"`
	Warnings                []string `json:"warnings"`
}

type Snapshot struct {
	SchemaVersion int            `json:"schemaVersion"`
	Scope         string         `json:"scope"`
	ScopeNotice   string         `json:"scopeNotice"`
	ObservedAt    time.Time      `json:"observedAt"`
	Status        string         `json:"status"`
	Cloudflared   Tool           `json:"cloudflared"`
	Wrangler      Tool           `json:"wrangler"`
	Docker        Tool           `json:"docker"`
	Service       Runtime        `json:"service"`
	ConfigSources []ConfigSource `json:"configSources"`
	Deployments   []Deployment   `json:"deployments"`
	Notes         []string       `json:"notes"`
}
