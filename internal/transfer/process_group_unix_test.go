//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package transfer

import (
	"io"
	"syscall"
	"testing"
)

func TestManagedProcessUsesSeparateTerminalProcessGroup(t *testing.T) {
	t.Parallel()
	process, err := startExecProcess("sh", []string{"-c", "while :; do sleep 1; done"}, io.Discard, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	managed, ok := process.(*execProcess)
	if !ok || managed.command.Process == nil {
		_ = process.Kill()
		t.Fatal("managed process did not expose a started child")
	}
	defer func() {
		_ = process.Kill()
		<-process.Done()
	}()
	childGroup, err := syscall.Getpgid(managed.command.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	if childGroup == syscall.Getpgrp() {
		t.Fatalf("child process group = parent process group %d", childGroup)
	}
}
