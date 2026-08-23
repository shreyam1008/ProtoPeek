//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package transfer

import (
	"os/exec"
	"syscall"
)

// configureManagedProcess keeps terminal-generated signals on the ProtoPeek
// process. ProtoPeek then owns the bounded save-session and shutdown sequence
// instead of racing aria2c's independent SIGINT handling.
func configureManagedProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
