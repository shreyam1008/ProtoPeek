//go:build !windows

package cloudflared

import "os/exec"

func configureToolProcess(command *exec.Cmd) {}
