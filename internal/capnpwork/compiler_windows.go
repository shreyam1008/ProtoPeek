//go:build windows

package capnpwork

import (
	"os/exec"
	"syscall"
)

func hideCompiler(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
