// Package netbird observes and controls an existing local NetBird daemon through
// its installed CLI. It never installs a client, reads keys or starts a daemon.
package netbird

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const maxOutput = 1 << 20

type Runner func(context.Context, string, ...string) ([]byte, error)
type Service struct {
	Find        func() (string, error)
	Run         Runner
	Environment func() []string
}

func New() *Service { return &Service{Find: findClient, Run: runClient, Environment: os.Environ} }

func findClient() (string, error) {
	if path, err := exec.LookPath("netbird"); err == nil {
		return path, nil
	}
	paths := []string{}
	if runtime.GOOS == "windows" {
		if root := os.Getenv("ProgramFiles"); filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(root, "NetBird", "netbird.exe"))
		}
	} else if runtime.GOOS == "darwin" {
		paths = append(paths, "/usr/local/bin/netbird", "/opt/homebrew/bin/netbird")
	}
	for _, path := range paths {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("NetBird CLI was not found. Install the official client and inspect again")
}

func cleanEnvironment(input []string) (kept, names []string) {
	seen := map[string]bool{}
	for _, item := range input {
		name, _, _ := strings.Cut(item, "=")
		upper := strings.ToUpper(name)
		if strings.HasPrefix(upper, "NB_") || strings.HasPrefix(upper, "WT_") {
			if !seen[upper] {
				if len(names) < 64 {
					names = append(names, text(upper, 128))
				}
				seen[upper] = true
			}
		} else {
			kept = append(kept, item)
		}
	}
	sort.Strings(names)
	return kept, names
}

type boundedOutput struct {
	data     bytes.Buffer
	limit    int
	cancel   context.CancelFunc
	exceeded bool
}

func (output *boundedOutput) Write(data []byte) (int, error) {
	if len(data) > output.limit-output.data.Len() {
		output.exceeded = true
		output.cancel()
		return 0, errors.New("NetBird output limit exceeded")
	}
	return output.data.Write(data)
}

func runClient(parent context.Context, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	command := exec.CommandContext(ctx, path, args...)
	command.Env, _ = cleanEnvironment(os.Environ())
	configureProcess(command)
	command.WaitDelay = time.Second
	stdout := &boundedOutput{limit: maxOutput, cancel: cancel}
	stderr := &boundedOutput{limit: 16 << 10, cancel: cancel}
	command.Stdout, command.Stderr = stdout, stderr
	err := command.Run()
	if parent.Err() != nil {
		return nil, parent.Err()
	}
	if stdout.exceeded || stderr.exceeded {
		return nil, errors.New("NetBird output exceeded its limit; command stopped")
	}
	// Native output can contain SSO links, setup keys or provider URLs. Never reflect it in API errors.
	if err != nil {
		return nil, errors.New("NetBird CLI failed. Check its installed app, daemon and permissions; no elevation was attempted")
	}
	return stdout.data.Bytes(), nil
}
