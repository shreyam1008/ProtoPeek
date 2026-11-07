package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"slices"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/communitytools"
	"github.com/shreyam1008/ProtoPeek/internal/extensionstore"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
	"github.com/shreyam1008/ProtoPeek/internal/media"
)

// Status and mutations return JSON, including a full inventory when no ID is
// supplied. Running a standalone companion forwards its streams and exit code.
// Names are an allowlist; flags, URLs and executable paths are not accepted as
// tool identities.
func runManagedExtensions(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) >= 2 && args[0] == "run" {
		if !communitytools.IsKnown(args[1]) {
			_, _ = io.WriteString(stderr, "Choose a known standalone companion.\n")
			return 2
		}
		manager, err := communitytools.New()
		if err != nil {
			_, _ = io.WriteString(stderr, "Managed extensions unavailable.\n")
			return 1
		}
		path, release, err := manager.Acquire(args[1])
		if err != nil {
			_, _ = io.WriteString(stderr, "The companion is unavailable, busy or failed verification. Check its status and install it if needed.\n")
			return 1
		}
		defer release()
		command := exec.CommandContext(ctx, path, args[2:]...)
		command.Stdin, command.Stdout, command.Stderr = os.Stdin, stdout, stderr
		if err = command.Run(); err != nil {
			var exitError *exec.ExitError
			if errors.As(err, &exitError) && exitError.ExitCode() >= 0 {
				return exitError.ExitCode()
			}
			_, _ = io.WriteString(stderr, "Could not run the companion.\n")
			return 1
		}
		return 0
	}
	writeError := func(message string, code int) int {
		_ = json.NewEncoder(stderr).Encode(map[string]string{"error": message})
		return code
	}
	args = slices.DeleteFunc(slices.Clone(args), func(arg string) bool { return arg == "--json" })
	if len(args) == 0 {
		args = []string{"status"}
	}
	if len(args) < 1 || len(args) > 2 || (args[0] != "status" && args[0] != "install" && args[0] != "remove") || (args[0] != "status" && len(args) != 2) {
		return writeError("Use: pp extensions status [ID], install ID, or remove ID", 2)
	}
	if len(args) == 2 && !extensionstore.IsKnown(args[1]) {
		return writeError("Choose a known extension; run 'pp extensions status' to list them", 2)
	}
	manager, err := managedtools.New()
	if err != nil {
		return writeError("Managed extensions unavailable", 1)
	}
	if args[0] == "status" && len(args) == 1 {
		if err = json.NewEncoder(stdout).Encode(extensionstore.Inventory(manager)); err != nil {
			return 1
		}
		return 0
	}
	var tool managedtools.Tool
	switch args[0] {
	case "status":
		tool, err = extensionstore.Status(manager, args[1])
	case "install":
		tool, err = extensionstore.Mutate(ctx, manager, "install", args[1])
	case "remove":
		tool, err = extensionstore.Mutate(ctx, manager, "remove", args[1])
	}
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			return writeError("Operation cancelled", 130)
		case errors.Is(err, managedtools.ErrBusy):
			return writeError("Stop the running tool or ProtoPeek media session and try again", 1)
		case errors.Is(err, managedtools.ErrStorageUnsupported):
			return writeError("This filesystem cannot safely install the companion. Use a local cache on a filesystem that supports atomic rename.", 1)
		case errors.Is(err, media.ErrExternalToolPresent):
			return writeError("The tool is available on PATH. Use the external installation or remove it from PATH before installing a managed copy.", 1)
		case errors.Is(err, media.ErrNotInstalled):
			return writeError("There is no managed copy to remove", 1)
		case errors.Is(err, media.ErrLocalUnavailable):
			return writeError("The media configuration directory is unavailable. Check its location and access permissions.", 1)
		case errors.Is(err, managedtools.ErrInvalid):
			if extensionstore.IsMedia(args[1]) {
				return writeError("Media tool files failed verification; nothing was replaced. Run 'pp extensions status "+args[1]+"' for recovery guidance.", 1)
			}
			return writeError("Local companion files failed verification; nothing was replaced", 1)
		case errors.Is(err, os.ErrPermission):
			return writeError("Check the permissions on the local companion directory and retry.", 1)
		case errors.Is(err, managedtools.ErrUnavailable):
			return writeError("This companion is unavailable on this platform", 1)
		case errors.Is(err, bundledaria2.ErrCompanionMissing), errors.Is(err, bundledaria2.ErrCompanionInvalid):
			return writeError(bundledaria2.CompanionMessage(err), 1)
		default:
			return writeError("The companion operation could not complete; check your connection and try again", 1)
		}
	}
	if err = json.NewEncoder(stdout).Encode(tool); err != nil {
		return 1
	}
	return 0
}
