package extensions

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/extensions/catalogids"
)

var ErrUnknownID = errors.New("unknown extension id")

type Catalog struct {
	SchemaVersion int                `json:"schemaVersion"`
	Extensions    []catalogids.Entry `json:"extensions"`
}

// Metadata contains fixed identities/capabilities only. It does not inspect the host.
func Metadata() Catalog { return Catalog{SchemaVersion: 1, Extensions: catalogids.All()} }

// InspectOne locates one allowlisted companion without executing it. Aria2 may
// read its saved host configuration and verify an already cached bundle checksum.
func InspectOne(id string, options Options) (Snapshot, error) {
	if !KnownID(id) {
		return Snapshot{}, ErrUnknownID
	}
	return nativeDetector().inspectOne(id, options)
}

func (d detector) inspectOne(id string, options Options) (Snapshot, error) {
	definition, known := catalogids.Lookup(id)
	if !known {
		return Snapshot{}, ErrUnknownID
	}
	var entry Extension
	if definition.Capability == "external-link" {
		entry = Extension{ID: id, Status: "external", Source: "none", Message: "External app guidance only. ProtoPeek does not detect ChatGPT installation, sign-in or account access; no host lookup was performed."}
	} else if definition.Capability == "native-workbench" {
		entry = d.nativeExtension(id, options)
		entry.Message = d.nativeSearchScope(entry) + " No tool or service was started. " + entry.Message
		if entry.Status == "missing" {
			entry.Message += " If installed after ProtoPeek started, restart ProtoPeek to refresh its PATH."
		}
	} else {
		command := companionCommand(id)
		candidates := d.companionPaths(id, command)
		entry = d.locate(id, command, candidates)
		scope := "this running process's PATH"
		if len(candidates) > 0 {
			scope += " and " + strconv.Itoa(len(candidates)) + " documented fixed location"
			if len(candidates) != 1 {
				scope += "s"
			}
		}
		if entry.Status == "detected" {
			location := "on this running process's PATH"
			if entry.Source == "standard-location" {
				location = "in a documented fixed location after a PATH lookup"
			}
			entry.Message = fmt.Sprintf("Located %s %s. No command was executed; installation, daemon, account and endpoint readiness were not verified.", command, location)
		} else {
			entry.Message = fmt.Sprintf("%s was not located using %s. This does not establish that the app is absent. If installed after ProtoPeek started, restart ProtoPeek to refresh its PATH.", command, scope)
		}
		if id == "lm-studio" {
			entry.Message += " Only the lms CLI was checked; LM Studio app and model availability were not checked."
		}
	}
	return Snapshot{SchemaVersion: 2, Platform: d.platform, Architecture: d.architecture, ObservedAt: d.now().UTC().Format(time.RFC3339Nano), Extensions: []Extension{entry}}, nil
}

func (d detector) nativeSearchScope(entry Extension) string {
	id := entry.ID
	if id == "aria2" {
		return "Read-only engine-setting/PATH lookup; an existing included-engine cache may be read and checksum-verified."
	}
	command := id
	if id == "wireshark" {
		command = "dumpcap"
	}
	if entry.Source == "path" {
		return "Located " + command + " on this process's PATH; availability is not execution or readiness evidence."
	}
	if entry.Source == "standard-location" {
		return "Located " + command + " in a fixed standard location after a PATH lookup; readiness was not checked."
	}
	scope := "this process's PATH"
	var paths []string
	switch id {
	case "wireshark":
		if d.platform == "windows" || d.platform == "darwin" {
			scope += " and the capture tool's fixed standard locations"
		}
	case "tailscale":
		paths = d.tailscalePaths()
	case "nmap":
		paths = d.windowsPaths("Nmap", "nmap.exe")
	case "netbird":
		paths = d.windowsPaths("NetBird", "netbird.exe")
	}
	if len(paths) > 0 {
		scope += " and its configured fixed standard locations"
	}
	return command + " was not located using " + scope + "; this does not establish that the app is absent."
}

func companionCommand(id string) string {
	switch id {
	case "openssh":
		return "ssh"
	case "claude-code":
		return "claude"
	case "gemini-cli":
		return "gemini"
	case "lm-studio":
		return "lms"
	default:
		return id
	}
}

func (d detector) companionPaths(id, command string) []string {
	var paths []string
	// Homebrew documents these macOS prefixes and GUI applications' minimal PATH:
	// https://docs.brew.sh/FAQ#my-macos-apps-dont-find-homebrew-utilities
	if d.platform == "darwin" {
		paths = append(paths, "/opt/homebrew/bin/"+command, "/usr/local/bin/"+command)
	}
	// Vendor-documented per-user CLI locations, never app or account inference:
	// https://docs.ollama.com/windows (Troubleshooting)
	if id == "ollama" && d.platform == "windows" {
		if root := d.getenv("LOCALAPPDATA"); filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(root, "Programs", "Ollama", "ollama.exe"))
		}
	}
	// https://lmstudio.ai/blog/lms and https://lmstudio.ai/docs/cli
	if id == "lm-studio" {
		variable, binary := "HOME", "lms"
		if d.platform == "windows" {
			variable, binary = "USERPROFILE", "lms.exe"
		}
		if root := d.getenv(variable); filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(root, ".lmstudio", "bin", binary))
		}
	}
	// https://docs.docker.com/desktop/setup/install/mac-install/
	if id == "docker" && d.platform == "darwin" {
		if root := d.getenv("HOME"); filepath.IsAbs(root) {
			paths = append(paths, filepath.Join(root, ".docker", "bin", "docker"))
		}
	}
	valid := paths[:0]
	for _, path := range paths {
		if filepath.IsAbs(path) && validPath(path) {
			valid = append(valid, path)
		}
	}
	return valid
}
