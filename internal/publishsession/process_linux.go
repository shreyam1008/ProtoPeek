package publishsession

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

func hideProcess(*exec.Cmd)          {}
func publishingPlatformError() error { return nil }

type linuxChild struct {
	command  *exec.Cmd
	done     chan struct{}
	err      error
	mu       sync.Mutex
	stopping bool
}

func (c *linuxChild) Wait() error { <-c.done; return c.err }
func (c *linuxChild) Kill() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopping {
		return os.ErrProcessDone
	}
	return killLinuxGroup(c.command.Process.Pid)
}
func (c *linuxChild) PID() int { return c.command.Process.Pid }

func killLinuxGroup(pid int) error {
	err := syscall.Kill(-pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return os.ErrProcessDone
	}
	return err
}

func launch(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
	tool := ""
	if len(args) > 0 {
		switch args[0] {
		case "tunnel":
			tool = "cloudflared"
		case "serve", "funnel":
			tool = "tailscale"
		}
	}
	canonical, err := validatePublishingExecutable(path, tool)
	if err != nil {
		return nil, err
	}
	return launchValidated(ctx, canonical, args, output)
}

// Only launch calls this in production, after admitting a direct native vendor
// command. Native fixture tests exercise OS ownership here without adding a
// production exemption for test binaries or arbitrary ELF wrappers.
func launchValidated(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
	canonical, err := validateLinuxELF(path)
	if err != nil {
		return nil, err
	}
	type startResult struct {
		value *linuxChild
		err   error
	}
	ready := make(chan startResult, 1)
	go func() {
		// Pdeathsig follows the creating OS thread. Keep it alive through Wait.
		// Go's fork/exec also handles the parent-PID race. Supported native
		// vendor commands stay foreground; arbitrary launchers are not admitted.
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		cmd := command(ctx, canonical, args, output)
		cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL, Setpgid: true}
		value := &linuxChild{command: cmd, done: make(chan struct{})}
		cmd.Cancel = value.Kill
		if err := cmd.Start(); err != nil {
			ready <- startResult{err: err}
			return
		}
		ready <- startResult{value: value}
		// Observe exit without reaping. The unreaped direct child reserves its
		// PID/PGID until group cleanup and the Kill guard are committed together.
		// Cmd.Wait must run after unlocking: its context watcher can call Kill.
		var info unix.Siginfo
		var waitErr error
		for {
			waitErr = unix.Waitid(unix.P_PID, cmd.Process.Pid, &info, unix.WEXITED|unix.WNOWAIT, nil)
			if !errors.Is(waitErr, unix.EINTR) {
				break
			}
		}
		value.mu.Lock()
		if waitErr == nil {
			if err := killLinuxGroup(cmd.Process.Pid); err != nil && !errors.Is(err, os.ErrProcessDone) {
				waitErr = err
			}
		}
		value.stopping = true
		value.mu.Unlock()
		if waitErr != nil {
			// Do not signal a possibly reused process group when exit ownership
			// cannot be observed. Go's Process handle can still stop its own child.
			_ = cmd.Process.Kill()
		}
		value.err = cmd.Wait()
		if waitErr != nil {
			value.err = errors.Join(value.err, errProcessOwnershipUnconfirmed, waitErr)
		}
		close(value.done)
	}()
	result := <-ready
	return result.value, result.err
}
