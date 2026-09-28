//go:build windows

package standalone

import (
	"context"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/windows"
)

func readNetworkNeighborRecords(ctx context.Context) ([]networkNeighborRecord, error) {
	directory, err := windows.GetSystemDirectory()
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, filepath.Join(directory, "arp.exe"), "-a")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	raw, err := runNetworkNeighborCommand(command)
	if err != nil {
		return nil, err
	}
	return parseWindowsNetworkNeighbors(string(raw)), nil
}
