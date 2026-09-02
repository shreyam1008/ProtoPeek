package cloudflared

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseConfigReturnsRoutesWithoutCredentialContents(t *testing.T) {
	t.Parallel()
	config := ConfigCandidate{Routes: []IngressRoute{}, Warnings: []string{}}
	parseConfig([]byte(`
tunnel: homelab-main
credentials-file: /var/lib/cloudflared/invalid-test-credential.json
ingress:
  - hostname: api.example.test
    service: http://localhost:8080
  - hostname: grpc.example.test
    service: h2c://localhost:50051
  - service: http_status:404
`), &config)

	if !config.Valid || config.Tunnel != "homelab-main" || config.CredentialsPath != "/var/lib/cloudflared/invalid-test-credential.json" {
		t.Fatalf("unexpected parsed config: %#v", config)
	}
	if len(config.Routes) != 3 || !config.Routes[2].CatchAll || !config.CatchAllPresent {
		t.Fatalf("unexpected routes: %#v", config.Routes)
	}
	if config.Routes[0].Protocol != "http" || config.Routes[1].Protocol != "h2c" {
		t.Fatalf("unexpected protocols: %#v", config.Routes)
	}
}

func TestPreferredServiceExecutableMustExist(t *testing.T) {
	t.Parallel()
	missing := filepath.Join(t.TempDir(), "cloudflared-missing")
	tool := inspectTool(context.Background(), "cloudflared", missing)
	if tool.Found || tool.Path != filepath.Clean(missing) || !strings.Contains(tool.Note, "unavailable") {
		t.Fatalf("unexpected tool evidence: %#v", tool)
	}
}

func TestRouteServiceAndInvocationSecretsAreRedacted(t *testing.T) {
	t.Parallel()
	service := redactService("https://invalid-user:invalid-password@localhost:8443/api?token=invalid-token&mode=test#invalid-fragment")
	for _, secret := range []string{"invalid-user", "invalid-password", "invalid-token", "test", "invalid-fragment"} {
		if strings.Contains(service, secret) {
			t.Fatalf("redacted service contains %q: %s", secret, service)
		}
	}
	if !strings.Contains(service, "token=redacted") || !strings.Contains(service, "mode=redacted") || !strings.Contains(service, "#redacted") {
		t.Fatalf("redacted service lost useful context: %s", service)
	}

	observed := observationFromArgs("systemd", "cloudflared.service", []string{
		"/usr/bin/cloudflared", "tunnel", "run", "--token", "invalid.synthetic.token",
	})
	if observed.CredentialSource != "literal tunnel token (redacted)" || strings.Contains(observed.CredentialSource, "invalid.synthetic.token") {
		t.Fatalf("credential source was not redacted: %#v", observed)
	}
}

func TestParseConfigWarnsWhenFinalCatchAllIsMissing(t *testing.T) {
	t.Parallel()
	config := ConfigCandidate{Routes: []IngressRoute{}, Warnings: []string{}}
	parseConfig([]byte("ingress:\n  - hostname: api.example.test\n    service: http://localhost:8080\n"), &config)
	if config.CatchAllPresent || len(config.Warnings) == 0 {
		t.Fatalf("expected missing catch-all evidence: %#v", config)
	}
}

func TestConfigBindingUsesOnlyCanonicalServiceEvidence(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		service    ServiceObservation
		configs    []ConfigCandidate
		wantBound  int
		wantEffect int
	}{
		{
			name:    "systemd default ignores user config",
			service: ServiceObservation{Manager: "systemd", Present: true, State: "running", argumentsObserved: true},
			configs: []ConfigCandidate{
				{Path: "/home/test/.cloudflared/config.yml", Source: "user-default", Exists: true, Readable: true, Valid: true},
				{Path: "/etc/cloudflared/config.yml", Source: "system-default", Exists: true, Readable: true, Valid: true},
			},
			wantBound: 1, wantEffect: 1,
		},
		{
			name:      "explicit unreadable config remains binding evidence",
			service:   ServiceObservation{Manager: "systemd", Present: true, State: "stopped", ConfigPath: "/etc/cloudflared/private.yml"},
			configs:   []ConfigCandidate{{Path: "/etc/cloudflared/private.yml", Source: "service-argument", Exists: true}},
			wantBound: 0, wantEffect: 0,
		},
		{
			name:      "remote token never adopts local config",
			service:   ServiceObservation{Manager: "systemd", Present: true, State: "running", ConfigPath: "/etc/cloudflared/config.yml", CredentialSource: "literal tunnel token (redacted)"},
			configs:   []ConfigCandidate{{Path: "/etc/cloudflared/config.yml", Source: "service-argument", Exists: true, Readable: true, Valid: true}},
			wantBound: -1, wantEffect: 0,
		},
		{
			name:      "no service selects local default without binding",
			service:   ServiceObservation{Manager: "systemd", State: "not-installed"},
			configs:   []ConfigCandidate{{Path: "/home/test/.cloudflared/config.yml", Source: "user-default", Exists: true, Readable: true, Valid: true}},
			wantBound: -1, wantEffect: 0,
		},
		{
			name:       "unreadable service arguments do not infer a default",
			service:    ServiceObservation{Manager: "systemd", Present: true, State: "running"},
			configs:    []ConfigCandidate{{Path: "/etc/cloudflared/config.yml", Source: "system-default", Exists: true, Readable: true, Valid: true}},
			wantBound:  -1,
			wantEffect: -1,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			markConfigAssociations(test.configs, test.service)
			for index, config := range test.configs {
				if config.BoundToCanonicalService != (index == test.wantBound) {
					t.Fatalf("config %d binding=%v wantBound=%d configs=%#v", index, config.BoundToCanonicalService, test.wantBound, test.configs)
				}
				if config.Effective != (index == test.wantEffect) {
					t.Fatalf("config %d effective=%v wantEffect=%d configs=%#v", index, config.Effective, test.wantEffect, test.configs)
				}
			}
		})
	}
}
