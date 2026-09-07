//go:build !windows

package tailnet

import "os/exec"

func configureProcess(command *exec.Cmd) {}
