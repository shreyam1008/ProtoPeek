//go:build windows

package standalone

import (
	"os/exec"
	"syscall"
)

func configureNmapProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
