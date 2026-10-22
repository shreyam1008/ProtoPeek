//go:build !windows

package netbird

import "os/exec"

func configureProcess(command *exec.Cmd) {}
