package transfer

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrAria2NotFound = errors.New("aria2c executable not found")

const (
	defaultStartupTimeout = 10 * time.Second
	defaultPollInterval   = 150 * time.Millisecond
	maxStartupErrorBytes  = 16 * 1024
)

type managedProcess interface {
	Done() <-chan struct{}
	Err() error
	Kill() error
}

type Aria2Launcher struct {
	resolve        func(string) (string, error)
	reservePort    func() (int, error)
	randomToken    func() (string, error)
	startProcess   func(string, []string, io.Writer, io.Writer) (managedProcess, error)
	newRPC         func(string, string) aria2RPC
	startupTimeout time.Duration
	pollInterval   time.Duration
}

func NewAria2Launcher() *Aria2Launcher {
	return &Aria2Launcher{
		resolve:      resolveAria2Binary,
		reservePort:  reserveLoopbackPort,
		randomToken:  randomRPCToken,
		startProcess: startExecProcess,
		newRPC: func(endpoint, secret string) aria2RPC {
			return newRPCClient(endpoint, secret)
		},
		startupTimeout: defaultStartupTimeout,
		pollInterval:   defaultPollInterval,
	}
}

func (launcher *Aria2Launcher) Start(ctx context.Context, config HostConfig, paths Paths) (*Runtime, error) {
	if err := ValidateHostConfig(config); err != nil {
		return nil, err
	}
	if err := ValidatePaths(paths); err != nil {
		return nil, err
	}
	binary, err := launcher.resolve(config.Aria2Path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(config.DownloadDirectory, 0o755); err != nil {
		return nil, fmt.Errorf("create download directory: %w", err)
	}
	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return nil, fmt.Errorf("create transfer state directory: %w", err)
	}
	if err := ensureSessionFile(paths.SessionFile); err != nil {
		return nil, err
	}

	port, err := launcher.reservePort()
	if err != nil {
		return nil, err
	}
	secret, err := launcher.randomToken()
	if err != nil {
		return nil, err
	}
	secretFile, err := writeRPCSecretFile(paths.StateDirectory, secret)
	if err != nil {
		return nil, err
	}
	defer os.Remove(secretFile)

	args := buildAria2Arguments(config, paths, port, secretFile)
	stderr := &limitedBuffer{limit: maxStartupErrorBytes}
	process, err := launcher.startProcess(binary, args, io.Discard, stderr)
	if err != nil {
		return nil, fmt.Errorf("start aria2c: %w", err)
	}

	rpc := launcher.newRPC(fmt.Sprintf("http://127.0.0.1:%d/jsonrpc", port), secret)
	version, err := launcher.waitUntilReady(ctx, process, rpc)
	if err != nil {
		_ = process.Kill()
		<-process.Done()
		if detail := strings.TrimSpace(stderr.String()); detail != "" {
			return nil, fmt.Errorf("%w: %s", err, detail)
		}
		return nil, err
	}

	stopper := newRuntimeStopper(process, rpc)
	return &Runtime{
		Engine:        &aria2Engine{rpc: rpc},
		BinaryPath:    binary,
		EngineVersion: version,
		Done:          process.Done(),
		Stop:          stopper.Stop,
		Err:           process.Err,
	}, nil
}

func (launcher *Aria2Launcher) waitUntilReady(ctx context.Context, process managedProcess, rpc aria2RPC) (string, error) {
	timeout := launcher.startupTimeout
	if timeout <= 0 {
		timeout = defaultStartupTimeout
	}
	poll := launcher.pollInterval
	if poll <= 0 {
		poll = defaultPollInterval
	}
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(poll)
	defer ticker.Stop()

	for {
		probeCtx, cancel := context.WithTimeout(ctx, minDuration(time.Second, timeout))
		version, err := rpc.GetVersion(probeCtx)
		cancel()
		if err == nil {
			return version, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-process.Done():
			if err := process.Err(); err != nil {
				return "", fmt.Errorf("aria2c exited during startup: %w", err)
			}
			return "", errors.New("aria2c exited during startup")
		case <-deadline.C:
			return "", errors.New("aria2c local RPC did not become ready before the startup deadline")
		case <-ticker.C:
		}
	}
}

func resolveAria2Binary(explicit string) (string, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" {
		path, err := exec.LookPath(explicit)
		if err != nil {
			return "", fmt.Errorf("%w at configured path %q", ErrAria2NotFound, explicit)
		}
		return filepath.Abs(path)
	}
	path, err := exec.LookPath("aria2c")
	if err != nil {
		return "", fmt.Errorf("%w in PATH", ErrAria2NotFound)
	}
	return filepath.Abs(path)
}

func reserveLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve aria2 RPC port: %w", err)
	}
	defer listener.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("resolve aria2 RPC port")
	}
	return address.Port, nil
}

func randomRPCToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate aria2 RPC token: %w", err)
	}
	return hex.EncodeToString(value), nil
}

func writeRPCSecretFile(directory, secret string) (string, error) {
	file, err := os.CreateTemp(directory, ".aria2-rpc-*.conf")
	if err != nil {
		return "", fmt.Errorf("create private aria2 RPC config: %w", err)
	}
	path := file.Name()
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			_ = os.Remove(path)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return "", fmt.Errorf("protect private aria2 RPC config: %w", err)
	}
	if _, err := file.WriteString("rpc-secret=" + secret + "\n"); err != nil {
		return "", fmt.Errorf("write private aria2 RPC config: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sync private aria2 RPC config: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close private aria2 RPC config: %w", err)
	}
	ok = true
	return path, nil
}

func ensureSessionFile(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open aria2 session file: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return fmt.Errorf("protect aria2 session file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close aria2 session file: %w", err)
	}
	return nil
}

func buildAria2Arguments(config HostConfig, paths Paths, port int, secretFile string) []string {
	arguments := []string{
		"--conf-path=" + secretFile,
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		"--rpc-listen-port=" + strconv.Itoa(port),
		"--dir=" + config.DownloadDirectory,
		"--max-concurrent-downloads=" + strconv.Itoa(config.MaxActiveJobs),
		"--max-connection-per-server=" + strconv.Itoa(config.MaxConnectionsPerHost),
		"--split=" + strconv.Itoa(config.Split),
		"--min-split-size=" + strconv.FormatInt(config.MinSplitSizeBytes, 10),
		"--max-overall-download-limit=" + strconv.FormatInt(config.MaxDownloadBytesPerSecond, 10),
		"--continue=" + boolString(config.ContinuePartialDownloads),
		"--always-resume=" + boolString(config.ContinuePartialDownloads),
		"--auto-file-renaming=" + boolString(config.AutoRenameConflictingFiles),
		"--allow-overwrite=" + boolString(config.AllowOverwriteExistingFiles),
		"--check-certificate=" + boolString(!config.AllowInsecureTLS),
		"--user-agent=" + config.UserAgent,
		"--summary-interval=0",
		"--console-log-level=warn",
		"--max-download-result=" + strconv.Itoa(config.MaxTrackedJobs),
		"--input-file=" + paths.SessionFile,
		"--save-session=" + paths.SessionFile,
		"--save-session-interval=30",
		"--force-save=true",
	}
	return arguments
}

type execProcess struct {
	command *exec.Cmd
	done    chan struct{}
	mu      sync.RWMutex
	err     error
}

func startExecProcess(path string, arguments []string, stdout, stderr io.Writer) (managedProcess, error) {
	command := exec.Command(path, arguments...)
	configureManagedProcess(command)
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	process := &execProcess{command: command, done: make(chan struct{})}
	go func() {
		err := command.Wait()
		process.mu.Lock()
		process.err = err
		process.mu.Unlock()
		close(process.done)
	}()
	return process, nil
}

func (process *execProcess) Done() <-chan struct{} { return process.done }

func (process *execProcess) Err() error {
	process.mu.RLock()
	defer process.mu.RUnlock()
	return process.err
}

func (process *execProcess) Kill() error {
	if process.command.Process == nil {
		return nil
	}
	err := process.command.Process.Kill()
	if errors.Is(err, os.ErrProcessDone) {
		return nil
	}
	return err
}

type runtimeStopper struct {
	process managedProcess
	rpc     aria2RPC
	once    sync.Once
	done    chan struct{}
	mu      sync.RWMutex
	err     error
}

func newRuntimeStopper(process managedProcess, rpc aria2RPC) *runtimeStopper {
	return &runtimeStopper{process: process, rpc: rpc, done: make(chan struct{})}
}

func (stopper *runtimeStopper) Stop(ctx context.Context) error {
	stopper.once.Do(func() {
		go stopper.stop()
	})
	select {
	case <-stopper.done:
		stopper.mu.RLock()
		defer stopper.mu.RUnlock()
		return stopper.err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (stopper *runtimeStopper) stop() {
	defer close(stopper.done)
	rpcCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	saveErr := stopper.rpc.SaveSession(rpcCtx)
	shutdownErr := stopper.rpc.Shutdown(rpcCtx)
	cancel()

	var processErr error
	select {
	case <-stopper.process.Done():
		processErr = stopper.process.Err()
	case <-time.After(3 * time.Second):
		killErr := stopper.process.Kill()
		<-stopper.process.Done()
		processErr = errors.Join(killErr, stopper.process.Err())
	}
	// A successful shutdown commonly makes exec.Cmd.Wait return an ExitError on
	// some aria2/platform combinations, so only surface it when RPC shutdown
	// also failed. Save-session failures remain visible.
	if shutdownErr == nil {
		processErr = nil
	}
	stopper.mu.Lock()
	stopper.err = errors.Join(saveErr, shutdownErr, processErr)
	stopper.mu.Unlock()
}

type limitedBuffer struct {
	mu    sync.Mutex
	limit int
	data  bytes.Buffer
}

func (buffer *limitedBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	written := len(value)
	remaining := buffer.limit - buffer.data.Len()
	if remaining > 0 {
		if len(value) > remaining {
			value = value[:remaining]
		}
		_, _ = buffer.data.Write(value)
	}
	return written, nil
}

func (buffer *limitedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.data.String()
}

func minDuration(left, right time.Duration) time.Duration {
	if left < right {
		return left
	}
	return right
}
