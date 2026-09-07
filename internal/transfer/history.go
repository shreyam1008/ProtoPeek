package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"time"
)

const maxCompletedHistory = 512
const maxCompletedHistoryBytes = 2 << 20

type completedHistory struct {
	Version int   `json:"version"`
	Jobs    []Job `json:"jobs"`
}

func readCompletedHistory(path string) ([]Job, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return []Job{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("completed history must be a regular file")
	}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return []Job{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxCompletedHistoryBytes {
		return nil, errors.New("completed history must be a regular file of at most 2 MiB")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxCompletedHistoryBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxCompletedHistoryBytes {
		return nil, errors.New("completed history exceeds 2 MiB")
	}
	var state completedHistory
	if err := DecodeStrictJSON(data, &state); err != nil {
		return nil, err
	}
	if state.Version != 1 || len(state.Jobs) > maxCompletedHistory {
		return nil, errors.New("unsupported or oversized completed history")
	}
	seen := make(map[string]bool, len(state.Jobs))
	for i, job := range state.Jobs {
		if seen[job.ID] || !validCompletedRecord(job) {
			return nil, errors.New("invalid completed history record")
		}
		if _, err := time.Parse(time.RFC3339Nano, job.CompletedAt); err != nil {
			return nil, errors.New("invalid completed history timestamp")
		}
		seen[job.ID] = true
		state.Jobs[i] = completedRecord(job, job.CompletedAt)
	}
	return state.Jobs, nil
}

func validCompletedRecord(job Job) bool {
	return validJobID(job.ID) && job.Status == JobCompleted && len(job.OutputPath) <= maxDestinationLength &&
		len(job.Directory) <= maxDestinationLength && len(job.Name) <= 512 && len(job.Source) <= maxSourceLength &&
		len(job.ExpectedSHA256) <= 64 && len(job.Verification) <= 32 && job.CompletedBytes >= 0 && job.TotalBytes >= 0
}

// Construct a fresh allowlist. Request headers, URI credentials/query strings,
// retry data, raw provider errors and response bodies never enter history.
func completedRecord(job Job, at string) Job {
	return Job{ID: job.ID, Name: job.Name, Status: JobCompleted, Directory: job.Directory, OutputPath: job.OutputPath,
		Source: redactSource(job.Source), TotalBytes: job.TotalBytes, CompletedBytes: job.CompletedBytes,
		ProgressPercent: 100, ExpectedSHA256: job.ExpectedSHA256, Verification: job.Verification,
		Historical: true, CompletedAt: at}
}

func writeCompletedHistory(path string, jobs []Job) error {
	data, err := json.Marshal(completedHistory{Version: 1, Jobs: jobs})
	if err != nil {
		return err
	}
	if len(data) > maxCompletedHistoryBytes {
		return errors.New("completed history exceeds 2 MiB")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".completed-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0o600); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	return syncDirectory(dir)
}

// Call with queueMu held. At most one process owns an active transfer engine.
func (service *Service) loadHistory(force bool) error {
	if service.historyLoaded && !force {
		return nil
	}
	jobs, err := readCompletedHistory(filepath.Join(service.paths.StateDirectory, "completed.json"))
	if err != nil {
		return fmt.Errorf("read completed history: %w", err)
	}
	service.completed = jobs
	service.historyLoaded = true
	return nil
}

func (service *Service) rememberCompleted(jobs []Job) error {
	if err := service.loadHistory(false); err != nil {
		return err
	}
	updated := slices.Clone(service.completed)
	seen := make(map[string]bool, len(updated))
	for _, job := range updated {
		seen[job.ID] = true
	}
	for _, job := range jobs {
		if job.Status != JobCompleted || seen[job.ID] {
			continue
		}
		service.mu.RLock()
		expected := service.checksums[job.ID]
		service.mu.RUnlock()
		if expected != "" {
			job.ExpectedSHA256 = expected
			job.Verification = "verified"
		}
		record := completedRecord(job, service.now().UTC().Format(time.RFC3339Nano))
		if !validCompletedRecord(record) {
			return errors.New("invalid completed transfer; history preserved")
		}
		updated = append([]Job{record}, updated...)
		seen[job.ID] = true
	}
	if len(updated) > maxCompletedHistory {
		updated = updated[:maxCompletedHistory]
	}
	if slices.Equal(updated, service.completed) {
		return nil
	}
	// Trim the oldest entries to the byte budget as well as the record budget.
	for len(updated) > 0 {
		data, _ := json.Marshal(completedHistory{Version: 1, Jobs: updated})
		if len(data) <= maxCompletedHistoryBytes {
			break
		}
		updated = updated[:len(updated)-1]
	}
	if err := writeCompletedHistory(filepath.Join(service.paths.StateDirectory, "completed.json"), updated); err != nil {
		return fmt.Errorf("save completed history: %w", err)
	}
	service.completed = updated
	return nil
}

func (service *Service) appendHistory(snapshot *Snapshot) {
	seen := make(map[string]bool, len(snapshot.Jobs))
	for _, job := range snapshot.Jobs {
		seen[job.ID] = true
	}
	for _, job := range service.completed {
		if len(snapshot.Jobs) >= snapshot.Config.MaxTrackedJobs {
			break
		}
		if !seen[job.ID] {
			snapshot.Jobs = append(snapshot.Jobs, job)
			snapshot.Metrics.CompletedCount++
			snapshot.Metrics.TotalCount++
		}
	}
}

// ForgetCompleted removes only a completed queue/history record, never a file.
func (service *Service) ForgetCompleted(ctx context.Context, id string) error {
	if !validJobID(id) {
		return errors.New("invalid transfer job id")
	}
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	service.mu.RLock()
	runtime, config := service.runtime, service.config
	service.mu.RUnlock()
	if err := service.loadHistory(runtime == nil); err != nil {
		return err
	}
	if runtime != nil {
		snapshot, err := runtime.Engine.Snapshot(ctx, config.MaxTrackedJobs)
		if err != nil {
			return err
		}
		for _, job := range snapshot.Jobs {
			if job.ID != id {
				continue
			}
			if job.Status != JobCompleted {
				return errors.New("only completed history can be forgotten")
			}
			if err := runtime.Engine.Cancel(ctx, id); err != nil {
				return err
			}
		}
	}
	updated := make([]Job, 0, len(service.completed))
	for _, job := range service.completed {
		if job.ID != id {
			updated = append(updated, job)
		}
	}
	if err := writeCompletedHistory(filepath.Join(service.paths.StateDirectory, "completed.json"), updated); err != nil {
		return err
	}
	service.completed = updated
	return nil
}
