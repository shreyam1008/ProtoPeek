//go:build !windows && !linux && !darwin

package cloudflared

import (
	"context"
	"errors"
)

func observeCanonicalService(ctx context.Context) (ServiceObservation, error) {
	if err := ctx.Err(); err != nil {
		return ServiceObservation{}, err
	}
	return ServiceObservation{Manager: "unsupported", Label: "cloudflared", State: "unknown", Detail: "Canonical service discovery is unavailable on this operating system."}, nil
}

func performCanonicalServiceAction(context.Context, ServiceAction) error {
	return errors.New("canonical service control is unavailable on this operating system")
}

func canonicalManualServiceAction(ServiceAction, ServiceObservation) (string, string) {
	return "", "Canonical cloudflared service control is unavailable on this operating system."
}

func CurrentPrivilegeEvidence() PrivilegeEvidence {
	return PrivilegeEvidence{Mechanism: "unsupported", ServiceActionNote: "Canonical cloudflared service control is unavailable on this operating system."}
}

func platformServiceConfigCandidates(ServiceObservation) []configPathCandidate {
	return []configPathCandidate{
		{path: "/etc/cloudflared/config.yml", source: "system-default"},
		{path: "/etc/cloudflared/config.yaml", source: "system-default"},
		{path: "/usr/local/etc/cloudflared/config.yml", source: "system-default"},
		{path: "/usr/local/etc/cloudflared/config.yaml", source: "system-default"},
	}
}
