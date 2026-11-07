package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
)

// adaptiveLauncher preserves existing queues: it never silently replaces an
// aria2 session or a native session with the other engine.
type adaptiveLauncher struct{ aria *Aria2Launcher }

func newAdaptiveLauncher() Launcher { return &adaptiveLauncher{aria: NewAria2Launcher()} }

func nonemptyRegular(path string) (bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, fmt.Errorf("transfer session is not a regular file")
	}
	return info.Size() > 0, nil
}

var ErrNativeQueuePending = errors.New("built-in downloads remain: clear the configured aria2 path in Settings, start the downloader, and finish or remove those jobs before selecting aria2 again")
var ErrNativeHistoryFull = errors.New("download history is full: remove old completed history before switching engines")

func nativeSessionState(path string) (bool, bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if !info.Mode().IsRegular() || info.Size() > nativeStateLimit {
		return false, false, errors.New("native transfer session is not a bounded regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return false, false, err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return false, false, errors.New("native transfer session changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, nativeStateLimit+1))
	if err != nil || len(data) > nativeStateLimit {
		return false, false, errors.New("could not read bounded native transfer session")
	}
	// Read just the top-level fields here; the selected native engine performs
	// full strict validation before loading any job.
	var state struct {
		Version           int               `json:"version"`
		Jobs              []json.RawMessage `json:"jobs"`
		PreservedPartials []json.RawMessage `json:"preservedPartials,omitempty"`
	}
	if err := DecodeStrictJSON(data, &state); err != nil || state.Version != 1 {
		return false, false, errors.New("invalid native transfer session")
	}
	unfinished := false
	for _, raw := range state.Jobs {
		var item struct {
			Job          Job    `json:"job"`
			CommitSHA256 string `json:"commitSha256"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return false, false, errors.New("invalid native transfer job")
		}
		if item.Job.Status != JobCompleted || item.CommitSHA256 != "" {
			unfinished = true
		}
	}
	return len(state.Jobs) > 0, unfinished, nil
}

// Retire completed native queue records only after their sanitized history is
// durable. Both writes are atomic and idempotent if interrupted in between.
func archiveNativeCompletions(ctx context.Context, config HostConfig, paths Paths) error {
	e := &nativeEngine{path: filepath.Join(paths.StateDirectory, "session.native.json"), config: config, promote: safepromote.Rename, syncDir: syncDirectory}
	if err := e.load(ctx); err != nil {
		return err
	}
	historyPath := filepath.Join(paths.StateDirectory, "completed.json")
	history, err := readCompletedHistory(historyPath)
	if err != nil {
		return err
	}
	seen := make(map[string]Job, len(history))
	for _, job := range history {
		seen[job.ID] = job
	}
	changed := false
	for _, record := range e.state.Jobs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if record.Job.Status != JobCompleted || record.CommitSHA256 != "" {
			return ErrNativeQueuePending
		}
		if existing, ok := seen[record.Job.ID]; ok {
			if existing.Name != record.Job.Name || existing.OutputPath != record.Job.OutputPath || existing.Source != redactSource(record.Job.Source) {
				return errors.New("native completion conflicts with existing history; both were preserved")
			}
			continue
		}
		job := record.Job
		job.ExpectedSHA256 = record.Request.SHA256
		if job.ExpectedSHA256 != "" && job.Verification != "verified" {
			return errors.New("native completion has incomplete checksum evidence")
		}
		item := completedRecord(job, time.Now().UTC().Format(time.RFC3339Nano))
		if !validCompletedRecord(item) {
			return errors.New("invalid native completion; history was preserved")
		}
		history = append([]Job{item}, history...)
		seen[item.ID] = item
		changed = true
	}
	if len(history) > maxCompletedHistory {
		return ErrNativeHistoryFull
	}
	data, err := json.Marshal(completedHistory{Version: 1, Jobs: history})
	if err != nil {
		return err
	}
	if len(data) > maxCompletedHistoryBytes {
		return ErrNativeHistoryFull
	}
	if changed {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := writeCompletedHistory(historyPath, history); err != nil {
			return fmt.Errorf("save native completion history before switching: %w", err)
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	e.state.Jobs = nil
	if err := e.saveLocked(); err != nil {
		return fmt.Errorf("save native queue before switching: %w", err)
	}
	return nil
}

func (l *adaptiveLauncher) Start(ctx context.Context, config HostConfig, paths Paths) (*Runtime, error) {
	nativePath := filepath.Join(paths.StateDirectory, "session.native.json")
	native, unfinished, err := nativeSessionState(nativePath)
	if err != nil {
		return nil, err
	}
	legacy, err := nonemptyRegular(paths.SessionFile)
	if err != nil {
		return nil, err
	}
	explicit := strings.TrimSpace(config.Aria2Path) != ""
	if native && unfinished {
		if explicit {
			return nil, ErrNativeQueuePending
		}
		runtime, err := newNativeLauncher().Start(ctx, config, paths)
		if err == nil && legacy {
			runtime.EngineNote = "Built-in downloads are active. The existing aria2 queue is preserved; finish or remove these jobs before switching engines."
		}
		return runtime, err
	}
	if native && !explicit && !legacy {
		return newNativeLauncher().Start(ctx, config, paths)
	}
	binary, resolveErr := l.aria.resolve(config.Aria2Path)
	if resolveErr == nil {
		if native {
			if err := archiveNativeCompletions(ctx, config, paths); err != nil {
				return nil, err
			}
		}
		// Pin the result for this launch so PATH cannot change between selection
		// and execution.
		copy := *l.aria
		copy.resolve = func(string) (string, error) { return binary, nil }
		return copy.Start(ctx, config, paths)
	}
	if explicit || legacy {
		return nil, resolveErr
	}
	if !errors.Is(resolveErr, ErrAria2NotFound) && !errors.Is(resolveErr, bundledaria2.ErrCompanionMissing) {
		return nil, resolveErr
	}
	return newNativeLauncher().Start(ctx, config, paths)
}
