package tunnels

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/cloudflared"
)

type observer interface {
	Inspect(context.Context) (cloudflared.Observation, error)
}

type serviceActor interface {
	ServiceAction(context.Context, cloudflared.ServiceActionRequest) (cloudflared.ServiceActionResult, error)
}

type releaseChecker interface {
	LatestRelease(context.Context, cloudflared.ToolObservation) (cloudflared.ReleaseObservation, error)
}

// Service has no goroutines or background polling. Every observation is tied
// to an explicit browser or CLI request.
type Service struct {
	observer       observer
	serviceActor   serviceActor
	releaseChecker releaseChecker
	now            func() time.Time
}

func NewService() *Service {
	return NewServiceWithHTTPClient(http.DefaultClient)
}

// NewServiceWithHTTPClient allows release-check transport injection while
// retaining ProtoPeek's fixed timeout and redirect policy.
func NewServiceWithHTTPClient(client *http.Client) *Service {
	inspector := cloudflared.NewInspectorWithHTTPClient(client)
	return &Service{observer: inspector, serviceActor: inspector, releaseChecker: inspector, now: time.Now}
}

func (service *Service) Capabilities(context.Context) Capabilities {
	manager, managerSupported := platformServiceManager()
	managerReason := ""
	if !managerSupported {
		managerReason = "Canonical service discovery is not implemented for this operating system."
	}
	privilege := cloudflared.CurrentPrivilegeEvidence()
	return Capabilities{
		SchemaVersion:      SchemaVersion,
		Scope:              Scope,
		ScopeNotice:        ScopeNotice,
		Platform:           runtime.GOOS,
		ServiceManager:     manager,
		ManualRefresh:      Capability{Supported: true},
		ServiceObservation: Capability{Supported: managerSupported, Reason: managerReason},
		ConfigInspection:   Capability{Supported: true},
		RoutePlanPreview:   Capability{Supported: true, Reason: "Plans stay in the browser; this release never writes them to the host."},
		ServiceControl:     Capability{Supported: managerSupported, Reason: serviceControlReason(managerSupported)},
		ConfigMutation:     Capability{Supported: false, Reason: "This beta is read-only. It can preview a route, but cannot apply it."},
		AccountConnection:  Capability{Supported: false, Reason: "Cloudflare account sessions arrive after local inspection is proven safe."},
		BackgroundPolling:  Capability{Supported: false, Reason: "Inspection runs only when you choose Inspect this host or Refresh."},
		Install:            installGuidance(runtime.GOOS, runtime.GOARCH, privilege),
	}
}

func (service *Service) LatestRelease(ctx context.Context) (Release, error) {
	result := Release{SchemaVersion: SchemaVersion, Status: "unknown", SupportStatus: "unknown", DownloadsURL: cloudflared.DownloadsURL, ReleaseURL: cloudflared.ReleasesURL + "/latest"}
	observed, err := service.observer.Inspect(ctx)
	if err != nil {
		return result, err
	}
	if service.releaseChecker == nil {
		result.CheckedAt = service.now().UTC()
		result.Note = "Latest-release checks are unavailable in this runtime."
		return result, nil
	}
	checked, err := service.releaseChecker.LatestRelease(ctx, observed.Cloudflared)
	if err != nil {
		return result, err
	}
	result.CheckedAt = checked.CheckedAt
	result.InstalledVersion = checked.InstalledVersion
	result.LatestVersion = checked.LatestVersion
	result.Status = checked.Status
	result.SupportStatus = checked.SupportStatus
	result.ReleaseURL = checked.ReleaseURL
	result.DownloadsURL = checked.DownloadsURL
	result.Note = checked.Note
	if !checked.PublishedAt.IsZero() {
		published := checked.PublishedAt
		result.PublishedAt = &published
	}
	return result, nil
}

func (service *Service) ServiceAction(ctx context.Context, request ServiceActionRequest) (ServiceActionResponse, error) {
	result := ServiceActionResponse{
		SchemaVersion: SchemaVersion,
		Status:        "failed",
		Message:       "Canonical cloudflared service control is unavailable in this runtime.",
		ObservedAt:    service.now().UTC(),
	}
	if service.serviceActor == nil {
		return result, nil
	}
	acted, err := service.serviceActor.ServiceAction(ctx, cloudflared.ServiceActionRequest{
		Action:        cloudflared.ServiceAction(request.Action),
		ExpectedState: request.ExpectedState,
		Confirmed:     request.Confirmed,
	})
	if err != nil {
		return result, err
	}
	result.Action = string(acted.Action)
	result.Status = acted.Status
	result.Message = acted.Message
	result.ElevationRequired = acted.ElevationRequired
	result.ElevationMechanism = acted.ElevationMechanism
	result.ManualCommand = acted.ManualCommand
	result.Service = mapRuntime(acted.Service)
	result.ObservedAt = acted.ObservedAt
	return result, nil
}

func serviceControlReason(supported bool) string {
	if !supported {
		return "Canonical service control is not implemented for this operating system."
	}
	return "Start, stop, and restart target only the canonical cloudflared service and require confirmation plus an unchanged observed state."
}

func installGuidance(platform, architecture string, privilege cloudflared.PrivilegeEvidence) InstallGuidance {
	guidance := InstallGuidance{
		Platform:           platform,
		Architecture:       architecture,
		DownloadsURL:       cloudflared.DownloadsURL,
		ReleasesURL:        cloudflared.ReleasesURL,
		ServiceDocsURL:     cloudflared.ServiceDocsURL,
		ProcessElevated:    privilege.ProcessElevated,
		ElevationMechanism: privilege.Mechanism,
		ElevationNotice:    privilege.ServiceActionNote,
		Commands:           []InstallCommand{},
	}
	switch platform {
	case "windows":
		guidance.Commands = append(guidance.Commands,
			InstallCommand{ID: "winget", Label: "Install with WinGet", Command: "winget install --id Cloudflare.cloudflared", RequiresElevation: false},
			InstallCommand{ID: "service-install", Label: "Install the Windows service", Command: "cloudflared.exe service install", RequiresElevation: true},
		)
	case "darwin":
		guidance.Commands = append(guidance.Commands,
			InstallCommand{ID: "homebrew", Label: "Install with Homebrew", Command: "brew install cloudflared", RequiresElevation: false},
			InstallCommand{ID: "service-install-user", Label: "Install the login LaunchAgent", Command: "cloudflared service install", RequiresElevation: false},
			InstallCommand{ID: "service-install-system", Label: "Install the boot LaunchDaemon", Command: "sudo cloudflared service install", RequiresElevation: true},
		)
	case "linux":
		guidance.Commands = append(guidance.Commands,
			InstallCommand{ID: "apt", Label: "Install after adding Cloudflare's apt repository", Command: "sudo apt-get update && sudo apt-get install cloudflared", RequiresElevation: true},
			InstallCommand{ID: "dnf", Label: "Install after adding Cloudflare's rpm repository", Command: "sudo dnf install cloudflared", RequiresElevation: true},
			InstallCommand{ID: "homebrew", Label: "Install with Homebrew", Command: "brew install cloudflared", RequiresElevation: false},
			InstallCommand{ID: "service-install", Label: "Install the systemd service", Command: "sudo cloudflared service install", RequiresElevation: true},
		)
	}
	return guidance
}

func (service *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	result := Snapshot{
		SchemaVersion: SchemaVersion,
		Scope:         Scope,
		ScopeNotice:   ScopeNotice,
		ObservedAt:    service.now().UTC(),
		Status:        "ok",
		ConfigSources: []ConfigSource{},
		Deployments:   []Deployment{},
		Notes:         []string{},
	}
	observed, err := service.observer.Inspect(ctx)
	if err != nil {
		return result, err
	}
	result.Cloudflared = mapTool(observed.Cloudflared)
	result.Wrangler = mapTool(observed.Wrangler)
	result.Docker = mapTool(observed.Docker)
	result.Service = mapRuntime(observed.Service)
	result.Notes = append(result.Notes, observed.Notes...)

	serviceRepresented := false
	boundConfigSourceID := ""
	var boundConfig *cloudflared.ConfigCandidate
	for _, candidate := range observed.Configs {
		configSourceID := configSourceStableID(candidate.Path)
		result.ConfigSources = append(result.ConfigSources, ConfigSource{
			ID:                      configSourceID,
			Path:                    candidate.Path,
			Source:                  candidate.Source,
			Exists:                  candidate.Exists,
			Readable:                candidate.Readable,
			Regular:                 candidate.Regular,
			Symlink:                 candidate.Symlink,
			Valid:                   candidate.Valid,
			Effective:               candidate.Effective,
			BoundToCanonicalService: candidate.BoundToCanonicalService,
			ServiceBinding:          fallback(candidate.ServiceBinding, "none"),
			ManagementMode:          candidate.ManagementMode,
			Tunnel:                  candidate.Tunnel,
			CredentialsPath:         candidate.CredentialsPath,
			Revision:                candidate.Revision,
			CatchAllPresent:         candidate.CatchAllPresent,
			RouteCount:              len(candidate.Routes),
			Warnings:                append([]string{}, candidate.Warnings...),
		})
		if candidate.BoundToCanonicalService {
			candidateCopy := candidate
			boundConfig = &candidateCopy
			boundConfigSourceID = configSourceID
		}
		if candidate.Readable && candidate.Valid {
			result.Deployments = append(result.Deployments, deploymentFromConfig(candidate, observed.Service, configSourceID))
			if candidate.BoundToCanonicalService {
				serviceRepresented = true
			}
		}
	}

	if observed.Service.Present && !serviceRepresented {
		result.Deployments = append(result.Deployments, deploymentFromService(observed.Service, boundConfig, boundConfigSourceID))
	}
	if !observed.Cloudflared.Found && !observed.Service.Present && observed.Service.State == "not-installed" {
		if len(result.Deployments) == 0 {
			result.Status = "unavailable"
			result.Notes = append(result.Notes, "cloudflared was not found in the canonical service definition or on PATH.")
		} else {
			result.Status = "partial"
			result.Notes = append(result.Notes, "Local cloudflared configs were observed, but no runnable binary or canonical service was found.")
		}
	} else if !observed.Cloudflared.Found {
		result.Status = "partial"
		result.Notes = append(result.Notes, "The canonical service was observed, but its cloudflared executable could not be verified.")
	} else if len(result.Notes) > 0 {
		result.Status = "partial"
	}
	return result, nil
}

func deploymentFromConfig(config cloudflared.ConfigCandidate, service cloudflared.ServiceObservation, configSourceID string) Deployment {
	name := strings.TrimSpace(config.Tunnel)
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(config.Path), filepath.Ext(config.Path))
	}
	if name == "config" && config.BoundToCanonicalService && service.Label != "" {
		name = service.Label
	}
	driver := "config-only"
	status := "observed"
	statusDetail := "Readable local config; it is not bound to the canonical cloudflared service."
	runtime := Runtime{State: "not-applicable", Detail: "This config source has no canonical-service runtime association."}
	if config.BoundToCanonicalService && service.Present {
		driver = "system-service"
		status = service.State
		statusDetail = service.Detail
		runtime = mapRuntime(service)
	}
	routes := make([]Route, 0, len(config.Routes))
	for index, route := range config.Routes {
		routes = append(routes, Route{
			ID:       stableID(config.Path, fmt.Sprintf("%d", index), route.Hostname, route.Path, route.Service),
			Hostname: route.Hostname,
			Path:     route.Path,
			Service:  route.Service,
			Protocol: route.Protocol,
			CatchAll: route.CatchAll,
		})
	}
	credentialSource := "none observed"
	if config.CredentialsPath != "" {
		credentialSource = "credentials file: " + config.CredentialsPath
	} else if config.BoundToCanonicalService && service.CredentialSource != "" {
		credentialSource = service.CredentialSource
	}
	return Deployment{
		ID:                      stableID("config-deployment", stablePath(config.Path), name),
		Name:                    name,
		Driver:                  driver,
		ManagementMode:          "local",
		ConfigurationAuthority:  "Local YAML",
		Status:                  status,
		StatusDetail:            statusDetail,
		ConfigPath:              config.Path,
		ConfigRevision:          config.Revision,
		CredentialSource:        credentialSource,
		ConfigSourceID:          configSourceID,
		BoundToCanonicalService: config.BoundToCanonicalService,
		ServiceBinding:          fallback(config.ServiceBinding, "none"),
		Routes:                  routes,
		Runtime:                 runtime,
		Warnings:                append([]string{}, config.Warnings...),
	}
}

func deploymentFromService(service cloudflared.ServiceObservation, config *cloudflared.ConfigCandidate, configSourceID string) Deployment {
	mode := "unknown"
	authority := "Service definition"
	if strings.Contains(strings.ToLower(service.CredentialSource), "token") {
		mode = "remote"
		authority = "Cloudflare account"
	} else if configSourceID != "" {
		mode = "local"
		authority = "Local YAML"
	}
	name := service.Label
	if name == "" {
		name = "cloudflared"
	}
	deployment := Deployment{
		ID:                      stableID("system-service", service.Manager, service.Label),
		Name:                    name,
		Driver:                  "system-service",
		ManagementMode:          mode,
		ConfigurationAuthority:  authority,
		Status:                  service.State,
		StatusDetail:            service.Detail,
		CredentialSource:        fallback(service.CredentialSource, "none observed"),
		ConfigSourceID:          configSourceID,
		BoundToCanonicalService: true,
		ServiceBinding:          "service-definition",
		Routes:                  []Route{},
		Runtime:                 mapRuntime(service),
		Warnings:                []string{"No effective local YAML was proven from the service definition."},
	}
	if config != nil {
		deployment.ConfigPath = config.Path
		deployment.ConfigRevision = config.Revision
		deployment.ServiceBinding = fallback(config.ServiceBinding, "service-definition")
		deployment.Warnings = append([]string{}, config.Warnings...)
		if !config.Readable || !config.Valid {
			deployment.Warnings = append(deployment.Warnings, "The bound config source could not be represented as a valid local deployment.")
		}
	}
	return deployment
}

func mapTool(value cloudflared.ToolObservation) Tool {
	return Tool{Found: value.Found, Path: value.Path, Version: value.Version, Note: value.Note}
}

func mapRuntime(value cloudflared.ServiceObservation) Runtime {
	return Runtime{
		Manager:        value.Manager,
		Label:          value.Label,
		Present:        value.Present,
		State:          value.State,
		Detail:         value.Detail,
		PID:            value.PID,
		ExecutablePath: value.ExecutablePath,
	}
}

func stableID(values ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(hash[:8])
}

func configSourceStableID(path string) string {
	return stableID("config-source", stablePath(path))
}

func stablePath(path string) string {
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path
}

func fallback(value, other string) string {
	if strings.TrimSpace(value) == "" {
		return other
	}
	return value
}

func platformServiceManager() (string, bool) {
	switch runtime.GOOS {
	case "linux":
		return "systemd", true
	case "windows":
		return "Windows SCM", true
	case "darwin":
		return "launchd", true
	default:
		return "unsupported", false
	}
}
