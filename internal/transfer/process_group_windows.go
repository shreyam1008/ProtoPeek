//go:build windows

package transfer

import (
	"os/exec"
	"syscall"
)

// A distinct process group prevents console Ctrl-C from independently killing
// aria2c before ProtoPeek can save its session and request graceful shutdown.
func configureManagedProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}
