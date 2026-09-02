//go:build windows

package cloudflared

import (
	"context"
	"errors"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func TestCanonicalServiceObservationDoesNotRequireAdministratorRights(t *testing.T) {
	observation, err := observeCanonicalService(context.Background())
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) || errors.Is(err, syscall.ERROR_ACCESS_DENIED) {
		t.Fatalf("read-only observation requested excessive SCM access: %v", err)
	}
	if err != nil {
		t.Fatalf("read-only observation failed: %v", err)
	}
	if observation.Manager != "Windows SCM" || observation.Label != "Cloudflared" {
		t.Fatalf("unexpected canonical identity: %#v", observation)
	}
}

func TestWindowsAccessDeniedMapsToElevation(t *testing.T) {
	if !errors.Is(classifyWindowsActionError(windows.ERROR_ACCESS_DENIED), errElevationRequired) {
		t.Fatal("Windows access denied was not classified as elevation-required")
	}
}
