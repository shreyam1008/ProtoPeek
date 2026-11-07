// Package extensionstore joins lightweight companion status with read-only
// media tool observations without opening the media queue on reads.
package extensionstore

import (
	"context"
	"errors"

	"github.com/shreyam1008/ProtoPeek/internal/communitytools"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
	"github.com/shreyam1008/ProtoPeek/internal/media"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

var mediaIDs = []string{"yt-dlp", "gallery-dl", "deno", "ffmpeg"}

func IsKnown(id string) bool {
	return id == "aria2" || id == "cloudflared" || IsMedia(id) || communitytools.IsKnown(id)
}

func communityTool(tool communitytools.Tool) managedtools.Tool {
	return managedtools.Tool{ID: tool.ID, Status: tool.Status, Version: tool.Version, InstallBytes: tool.InstallBytes, CanInstall: tool.CanInstall, CanRemove: tool.CanRemove, Message: tool.Message, SourceURL: tool.SourceURL, Path: tool.Path, RecoveryPath: tool.RecoveryPath}
}

func IsMedia(id string) bool {
	for _, known := range mediaIDs {
		if id == known {
			return true
		}
	}
	return false
}

func Status(manager *managedtools.Manager, id string) (managedtools.Tool, error) {
	if communitytools.IsKnown(id) {
		community, err := communitytools.New()
		if err != nil {
			return managedtools.Tool{}, err
		}
		tool, err := community.Status(id)
		return communityTool(tool), err
	}
	if !IsMedia(id) {
		tool, err := manager.Status(id)
		if err == nil {
			tool.Message += remnantsFor(id, tool.Version)
		}
		return tool, err
	}
	t, err := media.InspectManaged(id)
	tool := managedtools.Tool{ID: t.ID, Status: t.Status, Version: t.Version, InstallBytes: t.InstallBytes, CanInstall: t.CanInstall, CanRemove: t.CanRemove, Message: t.Message, SourceURL: t.SourceURL}
	if err == nil {
		tool.Message += remnantsFor(id, tool.Version)
	}
	return tool, err
}

func Inventory(manager *managedtools.Manager) managedtools.Inventory {
	inventory := manager.Inventory()
	for i := range inventory.Tools {
		inventory.Tools[i].Message += remnantsFor(inventory.Tools[i].ID, inventory.Tools[i].Version)
	}
	for _, id := range mediaIDs {
		tool, _ := Status(manager, id)
		inventory.Tools = append(inventory.Tools, tool)
	}
	community, err := communitytools.New()
	if err != nil {
		for _, id := range communitytools.IDs() {
			inventory.Tools = append(inventory.Tools, managedtools.Tool{ID: id, Status: "unavailable", Message: "Managed tool storage is unavailable."})
		}
	} else {
		for _, tool := range community.Inventory() {
			inventory.Tools = append(inventory.Tools, communityTool(tool))
		}
	}
	return inventory
}

// Mutations must hold the same process-wide media queue lock as the UI. A CLI
// cannot modify tools while another ProtoPeek instance owns that queue.
func Mutate(ctx context.Context, manager *managedtools.Manager, action, id string) (managedtools.Tool, error) {
	if err := ctx.Err(); err != nil {
		return managedtools.Tool{}, err
	}
	if action != "install" && action != "remove" {
		return managedtools.Tool{}, errors.New("unknown companion action")
	}
	if communitytools.IsKnown(id) {
		community, err := communitytools.New()
		if err != nil {
			return managedtools.Tool{}, err
		}
		var tool communitytools.Tool
		if action == "install" {
			tool, err = community.Install(ctx, id)
		} else {
			tool, err = community.Remove(id)
		}
		return communityTool(tool), err
	}
	if !IsMedia(id) {
		if action == "install" {
			return manager.Install(ctx, id)
		}
		return manager.Remove(id)
	}
	observed, err := media.InspectManaged(id)
	if err != nil || observed.Status == "unavailable" {
		return managedtools.Tool{}, managedtools.ErrUnavailable
	}
	if observed.Status == "invalid" {
		return managedtools.Tool{}, managedtools.ErrInvalid
	}
	err = media.ChangeCompanion(ctx, action, id)
	if errors.Is(err, transfer.ErrLockHeld) {
		return managedtools.Tool{}, managedtools.ErrBusy
	}
	if errors.Is(err, media.ErrInstallUnsupported) {
		return managedtools.Tool{}, managedtools.ErrStorageUnsupported
	}
	if errors.Is(err, media.ErrRemoveBusy) {
		return managedtools.Tool{}, managedtools.ErrBusy
	}
	if errors.Is(err, media.ErrRemoveInvalid) || errors.Is(err, media.ErrInstallUnsafe) {
		return managedtools.Tool{}, managedtools.ErrInvalid
	}
	if err != nil {
		return managedtools.Tool{}, err
	}
	return Status(manager, id)
}
