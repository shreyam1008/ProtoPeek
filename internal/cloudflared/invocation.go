package cloudflared

import (
	"path/filepath"
	"strings"
)

func observationFromArgs(manager, label string, args []string) ServiceObservation {
	result := ServiceObservation{Manager: manager, Label: label, State: "unknown", argumentsObserved: true}
	if len(args) > 0 {
		result.ExecutablePath = cleanExecutable(args[0])
	}
	for index := 1; index < len(args); index++ {
		name, inline, hasInline := strings.Cut(args[index], "=")
		switch strings.ToLower(name) {
		case "--config":
			if hasInline {
				result.ConfigPath = cleanArgumentPath(inline)
			} else if index+1 < len(args) {
				index++
				result.ConfigPath = cleanArgumentPath(args[index])
			}
		case "--token-file":
			if hasInline {
				result.CredentialSource = "token file: " + cleanArgumentPath(inline)
			} else if index+1 < len(args) {
				index++
				result.CredentialSource = "token file: " + cleanArgumentPath(args[index])
			}
		case "--token":
			result.CredentialSource = "literal tunnel token (redacted)"
			if !hasInline && index+1 < len(args) {
				index++
			}
		}
	}
	return result
}

func cleanExecutable(value string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"")
	if value == "" {
		return ""
	}
	return filepath.Clean(value)
}

func cleanArgumentPath(value string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"")
	if value == "" {
		return ""
	}
	return filepath.Clean(boundedText(value, 2048))
}

func mergeServiceObservation(base, parsed ServiceObservation) ServiceObservation {
	parsed.Manager = base.Manager
	parsed.Label = base.Label
	parsed.Present = base.Present
	parsed.State = base.State
	parsed.Detail = base.Detail
	parsed.PID = base.PID
	if parsed.ExecutablePath == "" {
		parsed.ExecutablePath = base.ExecutablePath
	}
	if parsed.ConfigPath == "" {
		parsed.ConfigPath = base.ConfigPath
	}
	if parsed.CredentialSource == "" {
		parsed.CredentialSource = base.CredentialSource
	}
	return parsed
}
