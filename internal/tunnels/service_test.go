package tunnels

import (
	"context"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/cloudflared"
)

type fakeObserver struct{ value cloudflared.Observation }

func (observer fakeObserver) Inspect(context.Context) (cloudflared.Observation, error) {
	return observer.value, nil
}

type fakeReleaseChecker struct {
	value cloudflared.ReleaseObservation
}

func (checker fakeReleaseChecker) LatestRelease(context.Context, cloudflared.ToolObservation) (cloudflared.ReleaseObservation, error) {
	return checker.value, nil
}

type fakeServiceActor struct {
	value cloudflared.ServiceActionResult
}

func (actor fakeServiceActor) ServiceAction(context.Context, cloudflared.ServiceActionRequest) (cloudflared.ServiceActionResult, error) {
	return actor.value, nil
}

func TestSnapshotMergesEffectiveConfigAndCanonicalService(t *testing.T) {
	t.Parallel()
	observedAt := time.Date(2026, time.September, 2, 9, 30, 0, 0, time.UTC)
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Cloudflared: cloudflared.ToolObservation{Found: true, Path: "/usr/bin/cloudflared", Version: "cloudflared version test"},
			Service:     cloudflared.ServiceObservation{Manager: "systemd", Label: "cloudflared.service", Present: true, State: "running", PID: 2184, ConfigPath: "/etc/cloudflared/config.yml"},
			Configs: []cloudflared.ConfigCandidate{{
				Path: "/etc/cloudflared/config.yml", Source: "service-argument", Exists: true, Readable: true, Regular: true, Valid: true, Effective: true, BoundToCanonicalService: true, ServiceBinding: "service-argument", ManagementMode: "local", Tunnel: "homelab-main", CredentialsPath: "/etc/cloudflared/invalid-test.json", Revision: strings.Repeat("a", 64), CatchAllPresent: true,
				Routes: []cloudflared.IngressRoute{{Hostname: "api.example.test", Service: "http://localhost:8080", Protocol: "http"}, {Service: "http_status:404", Protocol: "http_status", CatchAll: true}},
			}},
		}},
		now: func() time.Time { return observedAt },
	}

	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ObservedAt != observedAt || len(snapshot.Deployments) != 1 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	deployment := snapshot.Deployments[0]
	if deployment.Name != "homelab-main" || deployment.Status != "running" || deployment.ConfigurationAuthority != "Local YAML" || len(deployment.Routes) != 2 {
		t.Fatalf("unexpected deployment: %#v", deployment)
	}
	if deployment.Runtime.PID != 2184 || deployment.ConfigRevision != strings.Repeat("a", 64) {
		t.Fatalf("missing runtime/config evidence: %#v", deployment)
	}
	if len(snapshot.ConfigSources) != 1 || deployment.ConfigSourceID != snapshot.ConfigSources[0].ID || snapshot.ConfigSources[0].RouteCount != 2 || !snapshot.ConfigSources[0].CatchAllPresent {
		t.Fatalf("config association/count evidence is ambiguous: deployment=%#v sources=%#v", deployment, snapshot.ConfigSources)
	}
}

func TestTokenServiceIsRemoteManagedWithoutLeakingToken(t *testing.T) {
	t.Parallel()
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Service: cloudflared.ServiceObservation{Manager: "Windows SCM", Label: "Cloudflared", Present: true, State: "stopped", CredentialSource: "literal tunnel token (redacted)"},
		}},
		now: time.Now,
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Deployments) != 1 || snapshot.Deployments[0].ManagementMode != "remote" || snapshot.Deployments[0].ConfigurationAuthority != "Cloudflare account" {
		t.Fatalf("unexpected remote deployment: %#v", snapshot.Deployments)
	}
}

func TestCapabilitiesIncludeOfficialInstallGuidanceAndPrivilegeEvidence(t *testing.T) {
	t.Parallel()
	capabilities := NewService().Capabilities(context.Background())
	if capabilities.Install.Platform != runtime.GOOS || capabilities.Install.Architecture != runtime.GOARCH {
		t.Fatalf("wrong platform guidance: %#v", capabilities.Install)
	}
	if capabilities.Install.DownloadsURL != cloudflared.DownloadsURL || capabilities.Install.ReleasesURL != cloudflared.ReleasesURL || capabilities.Install.ServiceDocsURL != cloudflared.ServiceDocsURL {
		t.Fatalf("wrong official links: %#v", capabilities.Install)
	}
	if capabilities.Install.ElevationMechanism == "" || capabilities.Install.ElevationNotice == "" {
		t.Fatalf("missing privilege evidence: %#v", capabilities.Install)
	}
	if _, supported := platformServiceManager(); supported && (!capabilities.ServiceControl.Supported || len(capabilities.Install.Commands) == 0) {
		t.Fatalf("missing service management guidance: %#v", capabilities)
	}
}

func TestReleaseAndServiceActionMapBoundedBackendContracts(t *testing.T) {
	t.Parallel()
	checkedAt := time.Date(2026, time.September, 2, 12, 30, 0, 0, time.UTC)
	publishedAt := time.Date(2026, time.September, 1, 8, 0, 0, 0, time.UTC)
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{Cloudflared: cloudflared.ToolObservation{Found: true, Version: "2026.8.3"}}},
		releaseChecker: fakeReleaseChecker{value: cloudflared.ReleaseObservation{
			CheckedAt: checkedAt, InstalledVersion: "2026.8.3", LatestVersion: "2026.9.1", Status: "update-available", SupportStatus: "supported", PublishedAt: publishedAt, ReleaseURL: cloudflared.ReleasesURL + "/tag/2026.9.1", DownloadsURL: cloudflared.DownloadsURL,
		}},
		serviceActor: fakeServiceActor{value: cloudflared.ServiceActionResult{
			Action: cloudflared.ServiceActionRestart, Status: "elevation-required", Message: "Elevation required.", ElevationRequired: true, ElevationMechanism: "sudo", ManualCommand: "sudo systemctl restart cloudflared.service", Service: cloudflared.ServiceObservation{Present: true, State: "running"}, ObservedAt: checkedAt,
		}},
		now: func() time.Time { return checkedAt },
	}
	release, err := service.LatestRelease(context.Background())
	if err != nil || release.Status != "update-available" || release.SupportStatus != "supported" || release.PublishedAt == nil || *release.PublishedAt != publishedAt {
		t.Fatalf("release=%#v err=%v", release, err)
	}
	action, err := service.ServiceAction(context.Background(), ServiceActionRequest{Action: "restart", ExpectedState: "running", Confirmed: true})
	if err != nil || action.Status != "elevation-required" || !action.ElevationRequired || action.Service.State != "running" || action.ObservedAt != checkedAt {
		t.Fatalf("action=%#v err=%v", action, err)
	}
}

func TestNonEffectiveConfigDeploymentNeverInheritsCanonicalRuntime(t *testing.T) {
	t.Parallel()
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Service: cloudflared.ServiceObservation{Manager: "systemd", Label: "cloudflared.service", Present: true, State: "running", PID: 9001, CredentialSource: "credentials file: /etc/cloudflared/service.json"},
			Configs: []cloudflared.ConfigCandidate{
				{Path: "/etc/cloudflared/config.yml", Source: "service-argument", Exists: true, Readable: true, Regular: true, Valid: true, Effective: true, BoundToCanonicalService: true, ServiceBinding: "service-argument", ManagementMode: "local", Tunnel: "bound", Routes: []cloudflared.IngressRoute{{Hostname: "bound.example.test", Service: "http://localhost:8080"}}},
				{Path: "/home/test/.cloudflared/config.yml", Source: "user-default", Exists: true, Readable: true, Regular: true, Valid: true, Effective: false, ManagementMode: "local", Tunnel: "draft", Routes: []cloudflared.IngressRoute{{Hostname: "draft.example.test", Service: "http://localhost:9000"}}},
			},
		}},
		now: time.Now,
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil || len(snapshot.Deployments) != 2 || len(snapshot.ConfigSources) != 2 {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
	byName := map[string]Deployment{}
	for _, deployment := range snapshot.Deployments {
		byName[deployment.Name] = deployment
	}
	bound := byName["bound"]
	draft := byName["draft"]
	if !bound.BoundToCanonicalService || !bound.Runtime.Present || bound.Runtime.PID != 9001 || bound.Driver != "system-service" {
		t.Fatalf("bound deployment lost canonical runtime: %#v", bound)
	}
	if draft.BoundToCanonicalService || draft.Runtime.Present || draft.Runtime.PID != 0 || draft.Runtime.State != "not-applicable" || draft.Driver != "config-only" || draft.Status != "observed" {
		t.Fatalf("detached config inherited canonical runtime: %#v", draft)
	}
	if strings.Contains(draft.CredentialSource, "service.json") {
		t.Fatalf("detached config inherited service credential metadata: %#v", draft)
	}
	sourceByID := map[string]ConfigSource{}
	for _, source := range snapshot.ConfigSources {
		sourceByID[source.ID] = source
	}
	for _, deployment := range snapshot.Deployments {
		source, ok := sourceByID[deployment.ConfigSourceID]
		if !ok || source.Path != deployment.ConfigPath || source.BoundToCanonicalService != deployment.BoundToCanonicalService {
			t.Fatalf("deployment/source association is not exact: deployment=%#v source=%#v", deployment, source)
		}
	}
}

func TestRemoteManagedServiceStaysSeparateFromLocalConfigs(t *testing.T) {
	t.Parallel()
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Service: cloudflared.ServiceObservation{Manager: "Windows SCM", Label: "Cloudflared", Present: true, State: "running", PID: 41, CredentialSource: "literal tunnel token (redacted)"},
			Configs: []cloudflared.ConfigCandidate{{Path: `C:\Users\test\.cloudflared\config.yml`, Source: "service-argument", Exists: true, Readable: true, Regular: true, Valid: true, Effective: true, ManagementMode: "local", Tunnel: "local-file", Routes: []cloudflared.IngressRoute{{Hostname: "local.example.test", Service: "http://localhost:8080"}}}},
		}},
		now: time.Now,
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil || len(snapshot.Deployments) != 2 {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
	var remote, local Deployment
	for _, deployment := range snapshot.Deployments {
		if deployment.ManagementMode == "remote" {
			remote = deployment
		} else {
			local = deployment
		}
	}
	if !remote.BoundToCanonicalService || remote.Runtime.PID != 41 || remote.ConfigSourceID != "" || len(remote.Routes) != 0 || remote.ConfigurationAuthority != "Cloudflare account" {
		t.Fatalf("remote service was conflated with local config: %#v", remote)
	}
	if local.BoundToCanonicalService || local.Runtime.Present || local.ConfigSourceID == "" || len(local.Routes) != 1 {
		t.Fatalf("local config was conflated with remote service: %#v", local)
	}
}

func TestConfigWithoutRunnableCloudflaredIsPartialNotUnavailable(t *testing.T) {
	t.Parallel()
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Cloudflared: cloudflared.ToolObservation{Found: false},
			Service:     cloudflared.ServiceObservation{Manager: "systemd", Label: "cloudflared.service", State: "not-installed"},
			Configs: []cloudflared.ConfigCandidate{{
				Path: "/home/test/.cloudflared/config.yml", Source: "user-default", Exists: true, Readable: true, Regular: true, Valid: true, Effective: true, ManagementMode: "local", Tunnel: "config-only",
			}},
		}},
		now: time.Now,
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil || snapshot.Status != "partial" || len(snapshot.Deployments) != 1 || snapshot.Deployments[0].BoundToCanonicalService {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
	if len(snapshot.Notes) == 0 || !strings.Contains(snapshot.Notes[len(snapshot.Notes)-1], "no runnable binary") {
		t.Fatalf("missing tool-gap evidence: %#v", snapshot.Notes)
	}
}

func TestInvalidBoundConfigStillAssociatesWithCanonicalServiceDeployment(t *testing.T) {
	t.Parallel()
	service := &Service{
		observer: fakeObserver{value: cloudflared.Observation{
			Cloudflared: cloudflared.ToolObservation{Found: true, Path: "/usr/bin/cloudflared", Version: "2026.8.3"},
			Service:     cloudflared.ServiceObservation{Manager: "systemd", Label: "cloudflared.service", Present: true, State: "stopped", ConfigPath: "/etc/cloudflared/config.yml"},
			Configs: []cloudflared.ConfigCandidate{{
				Path: "/etc/cloudflared/config.yml", Source: "service-argument", Exists: true, Readable: true, Regular: true, Valid: false, Effective: true, BoundToCanonicalService: true, ServiceBinding: "service-argument", Warnings: []string{"YAML parse failed"},
			}},
		}},
		now: time.Now,
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil || len(snapshot.Deployments) != 1 || len(snapshot.ConfigSources) != 1 {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
	deployment := snapshot.Deployments[0]
	if !deployment.BoundToCanonicalService || deployment.ConfigSourceID != snapshot.ConfigSources[0].ID || deployment.ConfigPath != snapshot.ConfigSources[0].Path || deployment.Runtime.State != "stopped" {
		t.Fatalf("bound invalid config association was lost: deployment=%#v source=%#v", deployment, snapshot.ConfigSources[0])
	}
	if len(deployment.Warnings) < 2 {
		t.Fatalf("missing invalid-bound-config warning: %#v", deployment.Warnings)
	}
}

func TestDetachedDefaultNamedConfigDoesNotBorrowServiceLabel(t *testing.T) {
	t.Parallel()
	deployment := deploymentFromConfig(
		cloudflared.ConfigCandidate{Path: "/home/test/.cloudflared/config.yml", Readable: true, Valid: true},
		cloudflared.ServiceObservation{Label: "cloudflared.service", Present: true, State: "running", PID: 77},
		"source-id",
	)
	if deployment.Name != "config" || deployment.Runtime.Present || deployment.Runtime.PID != 0 || deployment.BoundToCanonicalService {
		t.Fatalf("detached config borrowed canonical identity/runtime: %#v", deployment)
	}
}
