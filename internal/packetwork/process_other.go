//go:build !windows

package packetwork

import "os/exec"

func hideCapture(cmd *exec.Cmd) {}
