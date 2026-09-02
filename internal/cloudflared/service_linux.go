//go:build linux

package cloudflared

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
)

func observeCanonicalService(ctx context.Context) (ServiceObservation, error) {
	result := ServiceObservation{Manager: "systemd", Label: "cloudflared.service", State: "not-installed"}
	systemctl, err := canonicalSystemctlPath()
	if err != nil {
		result.State = "unknown"
		result.Detail = "systemctl was not found at a canonical path."
		return result, errors.New("query canonical systemd service: systemctl is unavailable")
	}
	output, err := runBounded(ctx, systemctl, "show", "cloudflared.service", "--no-pager", "--property=LoadState,ActiveState,SubState,MainPID,FragmentPath")
	if err != nil {
		result.State = "unknown"
		result.Detail = "systemd could not query the canonical cloudflared unit."
		if outputIndicatesElevation(string(output)) {
			return result, errElevationRequired
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, errors.New("query canonical systemd service")
	}
	values := parseKeyValues(string(output))
	if values["LoadState"] == "not-found" {
		return result, nil
	}
	if values["LoadState"] == "" {
		result.State = "unknown"
		result.Detail = "systemd returned no LoadState for the canonical cloudflared unit."
		return result, errors.New("query canonical systemd service: missing LoadState")
	}
	result.Present = true
	result.State = normalizeServiceState(values["ActiveState"])
	result.Detail = boundedText(values["SubState"], 80)
	if pid, parseErr := strconv.Atoi(values["MainPID"]); parseErr == nil && pid > 0 {
		result.PID = pid
	}

	commandOutput, commandErr := runBounded(ctx, systemctl, "show", "cloudflared.service", "--no-pager", "--property=ExecStart", "--value")
	if commandErr != nil {
		result.Detail = "Canonical unit state was observed, but its command arguments could not be read safely."
		return result, nil
	}
	args := conservativeCommandFields(string(commandOutput))
	if len(args) == 0 {
		result.Detail = "Canonical unit state was observed, but its command arguments could not be parsed safely."
		return result, nil
	}
	return mergeServiceObservation(result, observationFromArgs(result.Manager, result.Label, args)), nil
}

func performCanonicalServiceAction(ctx context.Context, action ServiceAction) error {
	if !validServiceAction(action) {
		return errors.New("invalid canonical service action")
	}
	systemctl, err := canonicalSystemctlPath()
	if err != nil {
		return err
	}
	output, err := runBounded(ctx, systemctl, "--no-ask-password", string(action), "cloudflared.service")
	if err == nil {
		return nil
	}
	if outputIndicatesElevation(string(output)) {
		return errElevationRequired
	}
	return err
}

func canonicalSystemctlPath() (string, error) {
	for _, candidate := range []string{"/usr/bin/systemctl", "/bin/systemctl"} {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	return "", os.ErrNotExist
}

func canonicalManualServiceAction(action ServiceAction, _ ServiceObservation) (string, string) {
	command := ""
	if validServiceAction(action) {
		command = "sudo systemctl " + string(action) + " cloudflared.service"
	}
	return command, "Run the command in a terminal. sudo may ask for your operating-system password; ProtoPeek never receives or stores it."
}

func CurrentPrivilegeEvidence() PrivilegeEvidence {
	return PrivilegeEvidence{
		ProcessElevated:   os.Geteuid() == 0,
		Mechanism:         "sudo or polkit",
		ServiceActionNote: "Service actions commonly require root or policy authorization. ProtoPeek uses --no-ask-password and never receives your password; run the provided sudo command in a terminal if elevation is required.",
	}
}

func platformServiceConfigCandidates(ServiceObservation) []configPathCandidate {
	return []configPathCandidate{
		{path: "/etc/cloudflared/config.yml", source: "system-default"},
		{path: "/etc/cloudflared/config.yaml", source: "system-default"},
		{path: "/usr/local/etc/cloudflared/config.yml", source: "system-default"},
		{path: "/usr/local/etc/cloudflared/config.yaml", source: "system-default"},
	}
}

func parseKeyValues(value string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		key, item, found := strings.Cut(line, "=")
		if found {
			result[strings.TrimSpace(key)] = strings.TrimSpace(item)
		}
	}
	return result
}

func normalizeServiceState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active":
		return "running"
	case "inactive", "failed":
		return "stopped"
	case "activating", "reloading":
		return "starting"
	case "deactivating":
		return "stopping"
	default:
		return "unknown"
	}
}

// systemctl's ExecStart display is not a shell contract. Parse only the simple,
// whitespace-delimited form; quoted/escaped definitions stay safely unknown.
func conservativeCommandFields(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "'\\") {
		return nil
	}
	if strings.HasPrefix(value, "{") {
		start := strings.Index(value, "path=")
		arguments := strings.Index(value, "argv[]=")
		if start < 0 || arguments < 0 {
			return nil
		}
		pathValue := strings.TrimSpace(strings.TrimSuffix(value[start+5:arguments], ";"))
		end := strings.Index(value[arguments:], ";")
		if end < 0 {
			return nil
		}
		args := strings.Fields(value[arguments+7 : arguments+end])
		if len(args) == 0 {
			return nil
		}
		args[0] = pathValue
		return args
	}
	if strings.Contains(value, "\"") {
		return nil
	}
	return strings.Fields(value)
}
