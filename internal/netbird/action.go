package netbird

import (
	"context"
	"errors"
	"time"
)

type ActionRequest struct {
	Action   string `json:"action"`
	Revision string `json:"revision"`
	Consent  bool   `json:"consent"`
}
type ActionResult struct {
	Outcome  string    `json:"outcome"`
	Message  string    `json:"message"`
	Snapshot *Snapshot `json:"snapshot"`
}

func (service *Service) Execute(parent context.Context, input ActionRequest) (ActionResult, error) {
	result := ActionResult{}
	if !input.Consent || input.Revision == "" || (input.Action != "connect" && input.Action != "disconnect") {
		return result, errors.New("review and confirm one current NetBird connection operation")
	}
	current, err := service.Inspect(parent)
	if err != nil {
		return result, err
	}
	if !current.Available || current.Revision != input.Revision {
		return result, errors.New("NetBird state changed; inspect and review again")
	}
	if (input.Action == "connect" && !current.ConnectAllowed) || (input.Action == "disconnect" && !current.DisconnectAllowed) {
		return result, errors.New("this operation is unavailable for the observed NetBird daemon; inspect its capability reason")
	}
	args := []string{"down"}
	if input.Action == "connect" {
		args = []string{"up", "--no-browser"}
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	if ctx.Err() != nil {
		cancel()
		return result, ctx.Err()
	}
	_, runErr := service.Run(ctx, current.Path, args...)
	cancel()
	result.Outcome, result.Message = "completed", "The installed CLI completed. Read the observed daemon state below; application reachability is separate."
	if runErr != nil {
		result.Outcome, result.Message = "failed", "The CLI did not complete. Daemon changes may already have occurred; check the installed app and refresh before retrying."
		if parent.Err() != nil {
			result.Outcome, result.Message = "cancelled", "The CLI was cancelled. Daemon changes may already have occurred; refresh before retrying."
		}
	}
	// A disconnected browser cannot undo an accepted daemon action. Re-observe once
	// after the CLI settles, with a separate hard bound and no retries.
	observe, stop := context.WithTimeout(context.WithoutCancel(parent), 10*time.Second)
	defer stop()
	if next, err := service.Inspect(observe); err == nil {
		result.Snapshot = &next
	} else {
		result.Message += " Post-operation observation failed; inspect again."
	}
	return result, nil
}
