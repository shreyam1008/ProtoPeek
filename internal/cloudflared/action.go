package cloudflared

import (
	"context"
	"errors"
	"strings"
	"time"
)

const serviceActionTimeout = 12 * time.Second

var errElevationRequired = errors.New("cloudflared service action requires elevation")

type serviceObserver func(context.Context) (ServiceObservation, error)
type serviceActioner func(context.Context, ServiceAction) error

// ServiceAction applies one exact action to the canonical cloudflared service.
// It accepts no service identifier, executable path, arguments, token, or password.
func (inspector *Inspector) ServiceAction(ctx context.Context, request ServiceActionRequest) (ServiceActionResult, error) {
	now := time.Now
	if inspector != nil && inspector.now != nil {
		now = inspector.now
	}
	return executeServiceAction(ctx, request, observeCanonicalService, performCanonicalServiceAction, now)
}

func executeServiceAction(ctx context.Context, request ServiceActionRequest, observe serviceObserver, perform serviceActioner, now func() time.Time) (ServiceActionResult, error) {
	request.ExpectedState = normalizeExpectedState(request.ExpectedState)
	result := ServiceActionResult{
		Status:     "failed",
		ObservedAt: now().UTC(),
	}

	if !validServiceAction(request.Action) {
		result.Message = "Action must be start, stop, or restart."
		return result, nil
	}
	result.Action = request.Action
	result.ManualCommand, result.ElevationMechanism = canonicalManualServiceAction(request.Action, ServiceObservation{})
	if !request.Confirmed {
		result.Message = "Explicit confirmation is required before changing the service."
		return result, nil
	}
	if request.ExpectedState == "" {
		result.Message = "The last observed service state is required. Refresh and try again."
		return result, nil
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	actionCtx, cancel := context.WithTimeout(ctx, serviceActionTimeout)
	defer cancel()

	observed, err := observe(actionCtx)
	result.Service = observed
	result.ManualCommand, result.ElevationMechanism = canonicalManualServiceAction(request.Action, observed)
	if err != nil {
		if actionCtx.Err() != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			result.Message = "The canonical service inspection timed out before the action could start."
			return result, nil
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if errors.Is(err, errElevationRequired) {
			result.Status = "elevation-required"
			result.ElevationRequired = true
			result.Message = "The operating system requires elevation before the canonical service can be inspected and changed. ProtoPeek never asks for or stores your password."
			return result, nil
		}
		result.Message = "The canonical service could not be inspected before the action."
		return result, nil
	}
	if !observed.Present || observed.State == "not-installed" {
		result.Status = "not-installed"
		result.Message = "The canonical cloudflared service is not installed."
		return result, nil
	}
	if request.ExpectedState != normalizeExpectedState(observed.State) {
		result.Status = "stale"
		result.Message = "The service state changed after the page was refreshed. Refresh and confirm again."
		return result, nil
	}
	if actionAlreadySatisfied(request.Action, observed.State) {
		result.Status = "unchanged"
		result.Message = "The canonical cloudflared service is already in the requested state."
		return result, nil
	}
	if !actionAllowedFromState(request.Action, observed.State) {
		result.Message = "The requested action is not allowed from the currently observed service state. Refresh after any transition finishes."
		return result, nil
	}

	if err := perform(actionCtx, request.Action); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			result.Message = "The operating-system service action timed out before completion could be verified."
			return result, nil
		}
		if errors.Is(err, errElevationRequired) {
			result.Status = "elevation-required"
			result.ElevationRequired = true
			result.Message = "The operating system denied this action without elevation. ProtoPeek never asks for or stores your password."
			return result, nil
		}
		result.Message = "The operating system could not complete the canonical cloudflared service action."
		return result, nil
	}

	refreshed, refreshErr := observe(actionCtx)
	if refreshErr != nil {
		if actionCtx.Err() != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			result.Message = "The service action timed out before the resulting state could be verified."
			return result, nil
		}
		result.Message = "The action returned, but ProtoPeek could not verify the resulting service state."
		return result, nil
	}
	result.Service = refreshed
	wantedState := "running"
	if request.Action == ServiceActionStop {
		wantedState = "stopped"
	}
	if normalizeExpectedState(refreshed.State) != wantedState {
		result.Message = "The action returned, but the canonical service did not reach the requested state."
		return result, nil
	}
	result.Status = "completed"
	result.Message = "The canonical cloudflared service action completed and its resulting state was verified."
	result.ObservedAt = now().UTC()
	return result, nil
}

func validServiceAction(action ServiceAction) bool {
	switch action {
	case ServiceActionStart, ServiceActionStop, ServiceActionRestart:
		return true
	default:
		return false
	}
}

func actionAlreadySatisfied(action ServiceAction, state string) bool {
	state = normalizeExpectedState(state)
	return action == ServiceActionStart && state == "running" || action == ServiceActionStop && state == "stopped"
}

func actionAllowedFromState(action ServiceAction, state string) bool {
	state = normalizeExpectedState(state)
	switch action {
	case ServiceActionStart:
		return state == "stopped"
	case ServiceActionStop:
		return state == "running" || state == "paused"
	case ServiceActionRestart:
		return state == "running" || state == "stopped" || state == "paused"
	default:
		return false
	}
}

func normalizeExpectedState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "not-installed", "running", "stopped", "starting", "stopping", "paused", "unknown":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func outputIndicatesElevation(value string) bool {
	lower := strings.ToLower(value)
	for _, marker := range []string{"interactive authentication", "access denied", "permission denied", "not authorized", "not permitted", "insufficient privileges", "authorization required"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
