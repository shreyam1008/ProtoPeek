//go:build !windows

package standalone

import "os/exec"

func configureNmapProcess(*exec.Cmd) {}
