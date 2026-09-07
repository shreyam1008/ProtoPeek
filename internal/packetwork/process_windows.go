//go:build windows

package packetwork

import (
	"os/exec"
	"syscall"
)

func hideCapture(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
