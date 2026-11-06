package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/extensionstore"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
)

// Every successful result is JSON, including a full inventory when no ID is
// supplied. Names are an allowlist; flags, URLs and executable paths are not
// accepted as tool identities.
func runManagedExtensions(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	writeError := func(message string, code int) int {
		_ = json.NewEncoder(stderr).Encode(map[string]string{"error": message})
		return code
	}
	if len(args) == 0 {
		args = []string{"status"}
	}
	if args[len(args)-1] == "--json" {
		args = args[:len(args)-1]
	}
	if len(args) < 1 || len(args) > 2 || (args[0] != "status" && args[0] != "install" && args[0] != "remove") || (args[0] != "status" && len(args) != 2) {
		return writeError("Use: pp extensions status [ID], install ID, or remove ID", 2)
	}
	if len(args) == 2 && args[1] != "aria2" && args[1] != "cloudflared" && !extensionstore.IsMedia(args[1]) {
		return writeError("Choose aria2, cloudflared, yt-dlp, gallery-dl, deno or ffmpeg", 2)
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
		case errors.Is(err, managedtools.ErrInvalid):
			return writeError("Local companion files failed verification; nothing was replaced", 1)
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
