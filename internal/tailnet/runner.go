// Package tailnet adapts the installed Tailscale client. It does not implement
// WireGuard, persist credentials, or run a background monitor.
package tailnet

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const maxOutput = 4 << 20

type Runner func(context.Context, string, ...string) ([]byte, error)

type Service struct {
	Find func() (string, error)
	Run  Runner
}

func New() *Service { return &Service{Find: findClient, Run: runClient} }

func findClient() (string, error) {
	if path, err := exec.LookPath("tailscale"); err == nil {
		return path, nil
	}
	var paths []string
	switch runtime.GOOS {
	case "windows":
		if root := os.Getenv("ProgramFiles"); filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(root, "Tailscale", "tailscale.exe"))
		}
	case "darwin":
		paths = append(paths, "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale")
	}
	for _, path := range paths {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("tailscale was not found. Install the official client and refresh; ProtoPeek uses its existing login and daemon")
}

type limitedOutput struct {
	data     bytes.Buffer
	limit    int
	exceeded bool
	cancel   context.CancelFunc
}

func (output *limitedOutput) Write(data []byte) (int, error) {
	if len(data) > output.limit-output.data.Len() {
		output.exceeded = true
		output.cancel()
		return 0, errors.New("tailscale output limit exceeded")
	}
	return output.data.Write(data)
}

func runClient(parent context.Context, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	command := exec.CommandContext(ctx, path, args...)
	configureProcess(command)
	command.WaitDelay = time.Second
	stdout := &limitedOutput{limit: maxOutput, cancel: cancel}
	stderr := &limitedOutput{limit: 16 << 10, cancel: cancel}
	command.Stdout, command.Stderr = stdout, stderr
	err := command.Run()
	if parent.Err() != nil {
		return nil, parent.Err()
	}
	if stdout.exceeded || stderr.exceeded {
		return nil, errors.New("tailscale output exceeded its limit; command stopped")
	}
	if err != nil {
		detail := strings.TrimSpace(stderr.data.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("tailscale: %s", text(detail, 2048))
	}
	return stdout.data.Bytes(), nil
}
