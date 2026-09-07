//go:build windows

package cloudflared

import (
	"os/exec"
	"syscall"
)

func configureToolProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
