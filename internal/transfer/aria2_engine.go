package transfer

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

type aria2Engine struct {
	rpc                   aria2RPC
	sessionRewritePending bool
	scrubbedCompleted     map[string]struct{}
}

func (engine *aria2Engine) Snapshot(ctx context.Context, maxTracked int) (EngineSnapshot, error) {
	if maxTracked < 1 {
		return EngineSnapshot{}, errors.New("max tracked jobs must be positive")
	}
	active, err := engine.rpc.TellActive(ctx)
	if err != nil {
		return EngineSnapshot{}, err
	}
	if len(active) > maxTracked {
		active = active[:maxTracked]
	}
	remaining := maxTracked - len(active)

	waiting := []aria2Status{}
	if remaining > 0 {
		waiting, err = engine.rpc.TellWaiting(ctx, 0, remaining)
		if err != nil {
			return EngineSnapshot{}, err
		}
		if len(waiting) > remaining {
			waiting = waiting[:remaining]
		}
		remaining -= len(waiting)
	}

	// Fetch the complete bounded result set independently of the display slice.
	// Active/waiting jobs can otherwise consume maxTracked and hide a newly
	// completed result whose signed URL or headers must be scrubbed from disk.
	stoppedResults, err := engine.rpc.TellStopped(ctx, 0, maxTracked)
	if err != nil {
		return EngineSnapshot{}, err
	}
	if len(stoppedResults) > maxTracked {
		stoppedResults = stoppedResults[:maxTracked]
	}
	stopped := stoppedResults
	if len(stopped) > remaining {
		stopped = stopped[:remaining]
	}

	global, err := engine.rpc.GetGlobalStat(ctx)
	if err != nil {
		return EngineSnapshot{}, err
	}

	jobs := make([]Job, 0, len(active)+len(waiting)+len(stopped))
	for _, status := range active {
		jobs = append(jobs, mapAria2Status(status))
	}
	for _, status := range waiting {
		jobs = append(jobs, mapAria2Status(status))
	}
	for _, status := range stopped {
		jobs = append(jobs, mapAria2Status(status))
	}
	metrics := metricsForJobs(jobs)
	metrics.BytesPerSecond = parseInt64(global.DownloadSpeed)
	globalActive := parseInt(global.NumActive)
	globalPending := parseInt(global.NumWaiting)
	globalStopped := parseInt(global.NumStopped)
	metrics.ActiveCount = max(metrics.ActiveCount, globalActive)
	metrics.TotalCount = max(metrics.TotalCount, globalActive+globalPending+globalStopped)
	pendingCount := max(metrics.QueuedCount+metrics.PausedCount, globalPending)
	if err := engine.rewriteSessionAfterCompletions(ctx, stoppedResults); err != nil {
		return EngineSnapshot{}, err
	}
	return EngineSnapshot{Jobs: jobs, PendingCount: pendingCount, Metrics: metrics}, nil
}

func (engine *aria2Engine) rewriteSessionAfterCompletions(ctx context.Context, stopped []aria2Status) error {
	completed := make(map[string]struct{})
	needsRewrite := engine.sessionRewritePending
	for _, status := range stopped {
		if status.Status != "complete" {
			continue
		}
		completed[status.GID] = struct{}{}
		if _, scrubbed := engine.scrubbedCompleted[status.GID]; !scrubbed {
			needsRewrite = true
		}
	}
	if needsRewrite {
		// Keep this dirty until SaveSession succeeds. A transient disk/RPC failure
		// must be retried by the next Snapshot or pre-shutdown reconciliation.
		engine.sessionRewritePending = true
		if err := engine.rpc.SaveSession(ctx); err != nil {
			return fmt.Errorf("%w: scrub completed transfers from aria2 session: %v", ErrQueueStateNotPersisted, err)
		}
		engine.sessionRewritePending = false
	}
	engine.scrubbedCompleted = completed
	return nil
}

func (engine *aria2Engine) Add(ctx context.Context, request AddRequest, config HostConfig) (string, error) {
	options := optionsForRequest(config, request)
	id, err := engine.rpc.AddURI(ctx, request.Sources, options)
	if err != nil {
		return "", err
	}
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return id, fmt.Errorf("%w: save aria2 session after adding %s: %v", ErrQueueStateNotPersisted, id, err)
	}
	return id, nil
}

func (engine *aria2Engine) Pause(ctx context.Context, id string) error {
	if err := engine.rpc.Pause(ctx, id); err != nil {
		return err
	}
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return fmt.Errorf("%w: save aria2 session after pause: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}

func (engine *aria2Engine) Resume(ctx context.Context, id string) error {
	if err := engine.rpc.Unpause(ctx, id); err != nil {
		return err
	}
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return fmt.Errorf("%w: save aria2 session after resume: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}

func (engine *aria2Engine) Retry(ctx context.Context, id string, request AddRequest, config HostConfig) (string, error) {
	request, err := validateAddRequest(request)
	if err != nil {
		return "", errors.New("saved retry metadata is invalid")
	}
	status, err := engine.rpc.TellStatus(ctx, id)
	if err != nil {
		return "", err
	}
	if status.Status != "error" && status.Status != "removed" {
		return "", fmt.Errorf("transfer %s is %s; only failed or cancelled transfers can be retried", id, status.Status)
	}
	options := optionsForRequest(config, request)
	if request.OutputName == "" {
		output := firstOutputPath(status)
		if output != "" {
			options["out"] = filepath.Base(output)
		}
	}
	newID, err := engine.rpc.AddURI(ctx, request.Sources, options)
	if err != nil {
		return "", err
	}
	cleanupErr := engine.rpc.RemoveDownloadResult(ctx, id)
	saveErr := engine.rpc.SaveSession(ctx)
	if persistenceErr := errors.Join(cleanupErr, saveErr); persistenceErr != nil {
		return newID, fmt.Errorf("%w: persist retry %s: %v", ErrQueueStateNotPersisted, newID, persistenceErr)
	}
	return newID, nil
}

func (engine *aria2Engine) Cancel(ctx context.Context, id string) error {
	status, err := engine.rpc.TellStatus(ctx, id)
	if err != nil {
		return err
	}
	mutated := false
	if status.Status == "active" || status.Status == "waiting" || status.Status == "paused" {
		if err := engine.rpc.Remove(ctx, id); err != nil {
			if forceErr := engine.rpc.ForceRemove(ctx, id); forceErr != nil {
				return errors.Join(err, forceErr)
			}
		}
		mutated = true
	}
	if err := engine.rpc.RemoveDownloadResult(ctx, id); err != nil {
		if mutated {
			return fmt.Errorf("%w: transfer stopped but its result record was not removed", ErrQueueStateNotPersisted)
		}
		return err
	}
	mutated = true
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return fmt.Errorf("%w: save aria2 session after cancel: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}

func (engine *aria2Engine) SaveSession(ctx context.Context) error {
	return engine.rpc.SaveSession(ctx)
}

func (engine *aria2Engine) Shutdown(ctx context.Context) error {
	return engine.rpc.Shutdown(ctx)
}

func optionsFor(config HostConfig) map[string]any {
	return map[string]any{
		"dir":                       config.DownloadDirectory,
		"max-connection-per-server": strconv.Itoa(config.MaxConnectionsPerHost),
		"split":                     strconv.Itoa(config.Split),
		"min-split-size":            strconv.FormatInt(config.MinSplitSizeBytes, 10),
		"continue":                  boolString(config.ContinuePartialDownloads),
		"always-resume":             boolString(config.AlwaysResume),
		"file-allocation":           config.FileAllocation,
		"auto-file-renaming":        boolString(config.AutoRenameConflictingFiles),
		"allow-overwrite":           boolString(config.AllowOverwriteExistingFiles),
		"check-certificate":         boolString(!config.AllowInsecureTLS),
		"user-agent":                config.UserAgent,
	}
}

func optionsForRequest(config HostConfig, request AddRequest) map[string]any {
	options := optionsFor(config)
	if request.DestinationDirectory != "" {
		options["dir"] = request.DestinationDirectory
	}
	if request.OutputName != "" {
		options["out"] = request.OutputName
	}
	if request.SHA256 != "" {
		options["checksum"] = "sha-256=" + request.SHA256
	}
	if request.UserAgent != "" {
		options["user-agent"] = request.UserAgent
	}
	if len(request.Headers) > 0 {
		headers := make([]string, 0, len(request.Headers))
		for _, header := range request.Headers {
			headers = append(headers, header.Name+": "+header.Value)
		}
		options["header"] = headers
	}
	return options
}

func mapAria2Status(status aria2Status) Job {
	total := parseInt64(status.TotalLength)
	completed := parseInt64(status.CompletedLength)
	speed := parseInt64(status.DownloadSpeed)
	progress := 0.0
	if total > 0 {
		progress = float64(completed) / float64(total) * 100
		if progress > 100 {
			progress = 100
		}
	}
	eta := int64(0)
	if speed > 0 && total > completed {
		eta = (total - completed) / speed
	}
	output := firstOutputPath(status)
	name := status.GID
	if output != "" {
		name = filepath.Base(output)
	}
	sources := collectSources(status)
	source := ""
	if len(sources) > 0 {
		source = redactSource(sources[0])
	}
	verifiedBytes := parseInt64(status.VerifiedLength)
	verification := "unknown"
	verifyMessage := ""
	errorCode := safeAriaErrorCode(status.ErrorCode)
	errorMessage := safeAriaErrorMessage(errorCode, status.ErrorMessage)
	if status.VerifyPending == "true" {
		verification = "verifying"
		verifyMessage = "aria2c is checking the downloaded bytes now."
	} else if errorCode == "32" {
		verification = "failed"
		verifyMessage = "aria2c reported a checksum error."
	} else if status.Status == "complete" && total > 0 && verifiedBytes == total {
		verification = "verified"
		verifyMessage = "aria2c verified all downloaded bytes; it does not expose the computed digest."
	}
	return Job{
		ID:              status.GID,
		Name:            name,
		Status:          mapJobStatus(status.Status),
		Directory:       status.Dir,
		OutputPath:      output,
		Source:          source,
		TotalBytes:      total,
		CompletedBytes:  completed,
		ProgressPercent: progress,
		BytesPerSecond:  speed,
		Connections:     parseInt(status.Connections),
		ETASeconds:      eta,
		ErrorCode:       errorCode,
		ErrorMessage:    errorMessage,
		VerifiedBytes:   verifiedBytes,
		Verification:    verification,
		VerifyMessage:   verifyMessage,
	}
}

func safeAriaErrorCode(raw string) string {
	// aria2 uses "0" for a successful transfer. It is completion evidence,
	// not an error code, and must never surface as a failure in the inspector.
	if raw == "0" {
		return ""
	}
	if len(raw) > 16 {
		return ""
	}
	for _, character := range raw {
		if character < '0' || character > '9' {
			return ""
		}
	}
	return raw
}

func safeAriaErrorMessage(code, rawMessage string) string {
	if strings.TrimSpace(rawMessage) == "" && strings.TrimSpace(code) == "" {
		return ""
	}
	if code == "32" {
		return "aria2c rejected the artifact because its checksum did not match."
	}
	if strings.TrimSpace(code) == "" {
		return "aria2c reported a transfer error."
	}
	return "aria2c reported transfer error code " + code + "."
}

func mapJobStatus(status string) JobStatus {
	switch status {
	case "active":
		return JobDownloading
	case "waiting":
		return JobQueued
	case "paused":
		return JobPaused
	case "complete":
		return JobCompleted
	case "error":
		return JobFailed
	case "removed":
		return JobCancelled
	default:
		return JobUnknown
	}
}

func metricsForJobs(jobs []Job) Metrics {
	metrics := Metrics{TotalCount: len(jobs)}
	for _, job := range jobs {
		switch job.Status {
		case JobDownloading:
			metrics.ActiveCount++
		case JobQueued:
			metrics.QueuedCount++
		case JobPaused:
			metrics.PausedCount++
		case JobCompleted:
			metrics.CompletedCount++
		case JobFailed:
			metrics.FailedCount++
		case JobCancelled:
			metrics.CancelledCount++
		}
	}
	return metrics
}

func collectSources(status aria2Status) []string {
	sources := make([]string, 0, len(status.Files))
	seen := make(map[string]struct{})
	for _, file := range status.Files {
		for _, source := range file.URIs {
			if source.URI == "" {
				continue
			}
			if _, exists := seen[source.URI]; exists {
				continue
			}
			seen[source.URI] = struct{}{}
			sources = append(sources, source.URI)
		}
	}
	return sources
}

func firstOutputPath(status aria2Status) string {
	for _, file := range status.Files {
		if strings.TrimSpace(file.Path) != "" {
			return file.Path
		}
	}
	return ""
}

func redactSource(source string) string {
	parsed, err := url.Parse(source)
	if err != nil {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func parseInt(value string) int {
	parsed, _ := strconv.Atoi(value)
	return parsed
}

func parseInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
