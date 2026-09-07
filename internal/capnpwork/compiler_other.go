//go:build !windows

package capnpwork

import "os/exec"

func hideCompiler(*exec.Cmd) {}
