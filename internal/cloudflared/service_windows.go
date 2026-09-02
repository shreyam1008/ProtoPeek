//go:build windows

package cloudflared

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func observeCanonicalService(ctx context.Context) (ServiceObservation, error) {
	result := ServiceObservation{Manager: "Windows SCM", Label: "Cloudflared", State: "not-installed"}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	manager, err := openWindowsServiceManager(windows.SC_MANAGER_CONNECT)
	if err != nil {
		result.State = "unknown"
		result.Detail = "The Windows Service Control Manager could not be queried."
		return result, fmt.Errorf("connect to Windows Service Control Manager: %w", classifyWindowsActionError(err))
	}
	defer manager.Disconnect()
	service, err := openWindowsCloudflaredService(manager, windows.SERVICE_QUERY_STATUS|windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) || errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
			return result, nil
		}
		result.State = "unknown"
		result.Detail = "The canonical Windows service could not be queried."
		return result, fmt.Errorf("open Cloudflared service: %w", classifyWindowsActionError(err))
	}
	defer service.Close()
	result.Present = true
	result.State = "unknown"
	if status, queryErr := service.Query(); queryErr == nil {
		result.PID = int(status.ProcessId)
		result.State = windowsServiceState(status.State)
	} else {
		if errors.Is(queryErr, windows.ERROR_ACCESS_DENIED) || errors.Is(queryErr, syscall.ERROR_ACCESS_DENIED) {
			return result, fmt.Errorf("read Cloudflared service state: %w", classifyWindowsActionError(queryErr))
		}
		result.Detail = "Service exists, but its runtime state could not be read."
	}
	config, configErr := service.Config()
	if configErr != nil {
		return result, fmt.Errorf("read Cloudflared service definition: %w", classifyWindowsActionError(configErr))
	}
	args, parseErr := windows.DecomposeCommandLine(config.BinaryPathName)
	if parseErr != nil || len(args) == 0 {
		result.Detail = "Service command exists, but its arguments could not be parsed safely."
		return result, nil
	}
	parsed := observationFromArgs(result.Manager, result.Label, args)
	result = mergeServiceObservation(result, parsed)
	if result.Detail == "" {
		result.Detail = "Observed from the canonical Windows service definition."
	}
	return result, nil
}

func performCanonicalServiceAction(ctx context.Context, action ServiceAction) error {
	manager, err := openWindowsServiceManager(windows.SC_MANAGER_CONNECT)
	if err != nil {
		return classifyWindowsActionError(err)
	}
	defer manager.Disconnect()

	access := uint32(windows.SERVICE_QUERY_STATUS)
	switch action {
	case ServiceActionStart:
		access |= windows.SERVICE_START
	case ServiceActionStop:
		access |= windows.SERVICE_STOP
	case ServiceActionRestart:
		access |= windows.SERVICE_START | windows.SERVICE_STOP
	default:
		return errors.New("invalid canonical service action")
	}
	service, err := openWindowsCloudflaredService(manager, access)
	if err != nil {
		return classifyWindowsActionError(err)
	}
	defer service.Close()

	switch action {
	case ServiceActionStart:
		if err := service.Start(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return classifyWindowsActionError(err)
		}
		return waitForWindowsServiceState(ctx, service, svc.Running)
	case ServiceActionStop:
		if _, err := service.Control(svc.Stop); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
			return classifyWindowsActionError(err)
		}
		return waitForWindowsServiceState(ctx, service, svc.Stopped)
	case ServiceActionRestart:
		status, err := service.Query()
		if err != nil {
			return classifyWindowsActionError(err)
		}
		if status.State != svc.Stopped {
			if _, err := service.Control(svc.Stop); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
				return classifyWindowsActionError(err)
			}
			if err := waitForWindowsServiceState(ctx, service, svc.Stopped); err != nil {
				return err
			}
		}
		if err := service.Start(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return classifyWindowsActionError(err)
		}
		return waitForWindowsServiceState(ctx, service, svc.Running)
	}
	return errors.New("invalid canonical service action")
}

func openWindowsServiceManager(access uint32) (*mgr.Mgr, error) {
	handle, err := windows.OpenSCManager(nil, nil, access)
	if err != nil {
		return nil, err
	}
	return &mgr.Mgr{Handle: handle}, nil
}

func openWindowsCloudflaredService(manager *mgr.Mgr, access uint32) (*mgr.Service, error) {
	name, err := syscall.UTF16PtrFromString("Cloudflared")
	if err != nil {
		return nil, err
	}
	handle, err := windows.OpenService(manager.Handle, name, access)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: "Cloudflared", Handle: handle}, nil
}

func waitForWindowsServiceState(ctx context.Context, service *mgr.Service, wanted svc.State) error {
	ticker := time.NewTicker(125 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := service.Query()
		if err != nil {
			return classifyWindowsActionError(err)
		}
		if status.State == wanted {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func classifyWindowsActionError(err error) error {
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) || errors.Is(err, syscall.ERROR_ACCESS_DENIED) {
		return fmt.Errorf("%w: Windows SCM denied access", errElevationRequired)
	}
	return err
}

func canonicalManualServiceAction(action ServiceAction, _ ServiceObservation) (string, string) {
	command := ""
	switch action {
	case ServiceActionStart:
		command = "Start-Service -Name Cloudflared"
	case ServiceActionStop:
		command = "Stop-Service -Name Cloudflared"
	case ServiceActionRestart:
		command = "Restart-Service -Name Cloudflared"
	}
	return command, "Open PowerShell as Administrator and run the command. Windows handles the UAC prompt; ProtoPeek never asks for a password."
}

func CurrentPrivilegeEvidence() PrivilegeEvidence {
	return PrivilegeEvidence{
		ProcessElevated:   windows.GetCurrentProcessToken().IsElevated(),
		Mechanism:         "Windows UAC",
		ServiceActionNote: "Service actions commonly require an Administrator process. If Windows denies access, use the provided command in elevated PowerShell; ProtoPeek never asks for a password.",
	}
}

func platformServiceConfigCandidates(service ServiceObservation) []configPathCandidate {
	if !service.Present || strings.TrimSpace(service.ConfigPath) != "" {
		return nil
	}
	windowsRoot, err := windows.GetWindowsDirectory()
	if err != nil || strings.TrimSpace(windowsRoot) == "" {
		return nil
	}
	serviceHome := filepath.Join(filepath.Clean(windowsRoot), "System32", "config", "systemprofile", ".cloudflared")
	return []configPathCandidate{
		{path: filepath.Join(serviceHome, "config.yml"), source: "system-service-default"},
		{path: filepath.Join(serviceHome, "config.yaml"), source: "system-service-default"},
	}
}

func windowsServiceState(state svc.State) string {
	switch state {
	case svc.Stopped:
		return "stopped"
	case svc.StartPending:
		return "starting"
	case svc.StopPending:
		return "stopping"
	case svc.Running:
		return "running"
	case svc.Paused:
		return "paused"
	default:
		return "unknown"
	}
}
