package transfer

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

// A new URL is a new job. Only restored sessions and explicit Retry/Resume
// operations may continue an existing partial file. aria2's global continue
// option otherwise reuses an unrelated completed file with the same basename.
func newDownloadOutput(config HostConfig, request AddRequest, jobs ...Job) (string, error) {
	name := request.OutputName
	if name == "" && len(request.Sources) > 0 {
		if source, err := url.Parse(request.Sources[0]); err == nil {
			name = path.Base(source.Path)
		}
		if !safeOutputName(name) {
			name = "download"
		}
	}
	if !safeOutputName(name) {
		return "", errors.New("output name is not a portable file name")
	}
	directory := config.DownloadDirectory
	if request.DestinationDirectory != "" {
		directory = request.DestinationDirectory
	}
	reserved := make(map[string]bool, len(jobs))
	for _, job := range jobs {
		if job.Status == JobCompleted || job.Status == JobFailed || job.Status == JobCancelled {
			continue
		}
		output := job.OutputPath
		if output == "" && job.Directory != "" && safeOutputName(job.Name) {
			output = filepath.Join(job.Directory, job.Name)
		}
		if output != "" {
			reserved[downloadPathKey(output)] = true
		}
	}
	for index := 0; index < 1024; index++ {
		candidate := name
		if index > 0 {
			extension := filepath.Ext(name)
			stem := strings.TrimSuffix(name, extension)
			candidate = fmt.Sprintf("%s (%d)%s", stem, index, extension)
			if len(candidate) > 255 {
				return "", errors.New("auto-renamed file name exceeds 255 bytes; choose a shorter output name")
			}
		}
		inQueue := reserved[downloadPathKey(filepath.Join(directory, candidate))]
		occupied := inQueue
		for _, suffix := range []string{"", ".aria2"} {
			_, err := os.Lstat(filepath.Join(directory, candidate) + suffix)
			if err == nil {
				occupied = true
				continue
			}
			if !errors.Is(err, os.ErrNotExist) {
				return "", fmt.Errorf("inspect download destination: %w", err)
			}
		}
		// Overwrite may replace a file, but may never give two queued jobs the
		// same output. Waiting jobs can reserve a name before creating a file.
		if !occupied || (config.AllowOverwriteExistingFiles && !inQueue) {
			return candidate, nil
		}
		if !config.AutoRenameConflictingFiles {
			return "", errors.New("download destination already exists; choose another file name or an explicit conflict policy")
		}
	}
	return "", errors.New("too many conflicting download names; choose another output name")
}

func downloadPathKey(value string) string {
	value = filepath.Clean(value)
	if runtime.GOOS == "windows" {
		value = strings.ToLower(value)
	}
	return value
}

func safeOutputName(name string) bool {
	if name == "" || len(name) > 255 || name == "." || name == ".." || containsControl(name) || strings.ContainsAny(name, `/\<>:"|?*`) || strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") {
		return false
	}
	base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return false
	}
	if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
		return false
	}
	return true
}
