//go:build darwin

package cloudflared

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	canonicalLaunchdLabel = "com.cloudflare.cloudflared"
	canonicalLaunchctl    = "/bin/launchctl"
	maxLaunchdPlistBytes  = 256 << 10
)

type launchdDefinition struct {
	path   string
	domain string
	target string
	args   []string
}

func observeCanonicalService(ctx context.Context) (ServiceObservation, error) {
	result := ServiceObservation{Manager: "launchd", Label: canonicalLaunchdLabel, State: "not-installed"}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	definition, found, err := findCanonicalLaunchdDefinition()
	if err != nil {
		result.State = "unknown"
		result.Detail = "The canonical launchd definition could not be inspected."
		if errors.Is(err, os.ErrPermission) {
			return result, errElevationRequired
		}
		return result, err
	}
	if !found {
		return result, nil
	}

	result.Present = true
	result.State = "stopped"
	result.Detail = "Canonical launchd definition is present but not loaded."
	result.actionTarget = definition.target
	result.definitionPath = definition.path
	result = mergeServiceObservation(result, observationFromArgs(result.Manager, result.Label, definition.args))
	result.actionTarget = definition.target
	result.definitionPath = definition.path

	output, printErr := runBounded(ctx, canonicalLaunchctl, "print", definition.target)
	if printErr != nil {
		if outputIndicatesElevation(string(output)) {
			result.State = "unknown"
			result.Detail = "launchd denied access to the canonical service state."
			return result, errElevationRequired
		}
		if launchdServiceNotLoaded(string(output)) {
			return result, nil
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		result.State = "unknown"
		result.Detail = "launchd could not query the canonical service state."
		return result, errors.New("query canonical launchd service state")
	}
	result.State, result.PID = parseLaunchdPrint(string(output))
	result.loaded = true
	result.Detail = "Observed from the canonical launchd definition and domain."
	return result, nil
}

func performCanonicalServiceAction(ctx context.Context, action ServiceAction) error {
	if !validServiceAction(action) {
		return errors.New("invalid canonical service action")
	}
	definition, found, err := findCanonicalLaunchdDefinition()
	if err != nil {
		return err
	}
	if !found {
		return os.ErrNotExist
	}
	printOutput, printErr := runBounded(ctx, canonicalLaunchctl, "print", definition.target)
	if printErr != nil && outputIndicatesElevation(string(printOutput)) {
		return errElevationRequired
	}
	if printErr != nil && !launchdServiceNotLoaded(string(printOutput)) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("canonical launchd state could not be verified")
	}
	loaded := printErr == nil

	var args []string
	switch action {
	case ServiceActionStart:
		if loaded {
			args = []string{"kickstart", definition.target}
		} else {
			args = []string{"bootstrap", definition.domain, definition.path}
		}
	case ServiceActionStop:
		args = []string{"bootout", definition.target}
	case ServiceActionRestart:
		if loaded {
			args = []string{"kickstart", "-k", definition.target}
		} else {
			args = []string{"bootstrap", definition.domain, definition.path}
		}
	}
	output, err := runBounded(ctx, canonicalLaunchctl, args...)
	if err == nil {
		return nil
	}
	if outputIndicatesElevation(string(output)) {
		return errElevationRequired
	}
	return err
}

func findCanonicalLaunchdDefinition() (launchdDefinition, bool, error) {
	candidates := []launchdDefinition{{
		path:   "/Library/LaunchDaemons/com.cloudflare.cloudflared.plist",
		domain: "system",
		target: "system/" + canonicalLaunchdLabel,
	}}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		domain := "gui/" + strconv.Itoa(os.Getuid())
		candidates = append(candidates, launchdDefinition{
			path:   filepath.Join(home, "Library", "LaunchAgents", "com.cloudflare.cloudflared.plist"),
			domain: domain,
			target: domain + "/" + canonicalLaunchdLabel,
		})
	}
	for _, candidate := range candidates {
		info, err := os.Lstat(candidate.path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return launchdDefinition{}, false, err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return launchdDefinition{}, false, fmt.Errorf("canonical launchd definition is not an exact regular file")
		}
		if info.Size() > maxLaunchdPlistBytes {
			return launchdDefinition{}, false, fmt.Errorf("canonical launchd definition exceeds the inspection limit")
		}
		file, err := os.Open(candidate.path)
		if err != nil {
			return launchdDefinition{}, false, err
		}
		openedInfo, statErr := file.Stat()
		if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
			_ = file.Close()
			return launchdDefinition{}, false, errors.New("canonical launchd definition changed during inspection")
		}
		contents, readErr := io.ReadAll(io.LimitReader(file, maxLaunchdPlistBytes+1))
		_ = file.Close()
		if readErr != nil {
			return launchdDefinition{}, false, readErr
		}
		if len(contents) > maxLaunchdPlistBytes {
			return launchdDefinition{}, false, fmt.Errorf("canonical launchd definition exceeds the inspection limit")
		}
		label, program, arguments, err := parseLaunchdPlist(contents)
		if err != nil {
			return launchdDefinition{}, false, fmt.Errorf("parse canonical launchd definition: %w", err)
		}
		if label != canonicalLaunchdLabel {
			return launchdDefinition{}, false, fmt.Errorf("canonical launchd definition has an unexpected label")
		}
		if len(arguments) == 0 && program != "" {
			arguments = []string{program}
		} else if len(arguments) > 0 && arguments[0] == "" {
			arguments[0] = program
		}
		if len(arguments) == 0 || strings.TrimSpace(arguments[0]) == "" {
			return launchdDefinition{}, false, errors.New("canonical launchd definition has no executable")
		}
		candidate.args = arguments
		return candidate, true, nil
	}
	return launchdDefinition{}, false, nil
}

func parseLaunchdPlist(contents []byte) (label, program string, arguments []string, err error) {
	if len(contents) > maxLaunchdPlistBytes {
		return "", "", nil, errors.New("plist exceeds the inspection limit")
	}
	decoder := xml.NewDecoder(io.LimitReader(bytes.NewReader(contents), maxLaunchdPlistBytes+1))
	currentKey := ""
	inArguments := false
	for {
		token, decodeErr := decoder.Token()
		if errors.Is(decodeErr, io.EOF) {
			break
		}
		if decodeErr != nil {
			return "", "", nil, decodeErr
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "key":
				var key string
				if err := decoder.DecodeElement(&key, &value); err != nil {
					return "", "", nil, err
				}
				currentKey = strings.TrimSpace(key)
			case "array":
				inArguments = currentKey == "ProgramArguments"
			case "string":
				var text string
				if err := decoder.DecodeElement(&text, &value); err != nil {
					return "", "", nil, err
				}
				text = boundedText(text, 2048)
				switch {
				case inArguments && len(arguments) < 128:
					arguments = append(arguments, text)
				case currentKey == "Label":
					label = text
				case currentKey == "Program":
					program = text
				}
				currentKey = ""
			}
		case xml.EndElement:
			if value.Name.Local == "array" {
				inArguments = false
				currentKey = ""
			}
		}
	}
	return label, program, arguments, nil
}

func parseLaunchdPrint(output string) (string, int) {
	state := "unknown"
	pid := 0
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), "=")
		if !found {
			continue
		}
		switch strings.TrimSpace(key) {
		case "state":
			switch strings.TrimSpace(value) {
			case "running":
				state = "running"
			case "waiting", "exited", "spawn scheduled":
				state = "stopped"
			}
		case "pid":
			pid, _ = strconv.Atoi(strings.TrimSpace(value))
		}
	}
	return state, pid
}

func launchdServiceNotLoaded(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "could not find service") || strings.Contains(lower, "service not found") || strings.Contains(lower, "no such process")
}

func canonicalManualServiceAction(action ServiceAction, observed ServiceObservation) (string, string) {
	target := observed.actionTarget
	path := observed.definitionPath
	if target == "" {
		target = "system/" + canonicalLaunchdLabel
	}
	if path == "" {
		path = "/Library/LaunchDaemons/com.cloudflare.cloudflared.plist"
	}
	prefix := ""
	mechanism := "Run the command in a terminal."
	if strings.HasPrefix(target, "system/") {
		prefix = "sudo "
		mechanism = "Run the command in a terminal. sudo may show the macOS administrator prompt; ProtoPeek never receives or stores the password."
	}
	command := ""
	switch action {
	case ServiceActionStart:
		domain, _, _ := strings.Cut(target, "/")
		if strings.HasPrefix(target, "gui/") {
			parts := strings.Split(target, "/")
			if len(parts) >= 2 {
				domain = strings.Join(parts[:2], "/")
			}
		}
		if observed.loaded {
			command = prefix + canonicalLaunchctl + " kickstart " + target
		} else {
			command = prefix + canonicalLaunchctl + " bootstrap " + domain + " " + quoteManualArgument(path)
		}
	case ServiceActionStop:
		command = prefix + canonicalLaunchctl + " bootout " + target
	case ServiceActionRestart:
		if observed.loaded {
			command = prefix + canonicalLaunchctl + " kickstart -k " + target
		} else {
			domain, _, _ := strings.Cut(target, "/")
			if strings.HasPrefix(target, "gui/") {
				parts := strings.Split(target, "/")
				if len(parts) >= 2 {
					domain = strings.Join(parts[:2], "/")
				}
			}
			command = prefix + canonicalLaunchctl + " bootstrap " + domain + " " + quoteManualArgument(path)
		}
	}
	return command, mechanism
}

func quoteManualArgument(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func CurrentPrivilegeEvidence() PrivilegeEvidence {
	return PrivilegeEvidence{
		ProcessElevated:   os.Geteuid() == 0,
		Mechanism:         "macOS administrator prompt",
		ServiceActionNote: "System LaunchDaemon actions commonly require an administrator. ProtoPeek never receives your password; run the provided sudo command in a terminal if elevation is required. User LaunchAgents may not require elevation.",
	}
}

func platformServiceConfigCandidates(service ServiceObservation) []configPathCandidate {
	source := "system-default"
	if strings.HasPrefix(service.actionTarget, "system/") {
		source = "launch-daemon-default"
	}
	return []configPathCandidate{
		{path: "/etc/cloudflared/config.yml", source: source},
		{path: "/etc/cloudflared/config.yaml", source: source},
		{path: "/usr/local/etc/cloudflared/config.yml", source: source},
		{path: "/usr/local/etc/cloudflared/config.yaml", source: source},
	}
}
