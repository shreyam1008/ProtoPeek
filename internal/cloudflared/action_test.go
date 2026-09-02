package cloudflared

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestServiceActionRequiresConfirmationAndFreshState(t *testing.T) {
	t.Parallel()
	called := false
	observe := func(context.Context) (ServiceObservation, error) {
		return ServiceObservation{Present: true, State: "running"}, nil
	}
	perform := func(context.Context, ServiceAction) error {
		called = true
		return nil
	}
	now := func() time.Time { return time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC) }

	unconfirmed, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: ServiceActionStop, ExpectedState: "running"}, observe, perform, now)
	if err != nil || unconfirmed.Status != "failed" || called {
		t.Fatalf("unconfirmed=%#v called=%v err=%v", unconfirmed, called, err)
	}
	stale, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: ServiceActionStop, ExpectedState: "stopped", Confirmed: true}, observe, perform, now)
	if err != nil || stale.Status != "stale" || called {
		t.Fatalf("stale=%#v called=%v err=%v", stale, called, err)
	}
}

func TestServiceActionDistinguishesExpectedOutcomes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		request    ServiceActionRequest
		observed   ServiceObservation
		performErr error
		wantStatus string
		wantCalls  int
	}{
		{name: "not installed", request: ServiceActionRequest{Action: ServiceActionStart, ExpectedState: "not-installed", Confirmed: true}, observed: ServiceObservation{State: "not-installed"}, wantStatus: "not-installed"},
		{name: "already running", request: ServiceActionRequest{Action: ServiceActionStart, ExpectedState: "running", Confirmed: true}, observed: ServiceObservation{Present: true, State: "running"}, wantStatus: "unchanged"},
		{name: "already stopped", request: ServiceActionRequest{Action: ServiceActionStop, ExpectedState: "stopped", Confirmed: true}, observed: ServiceObservation{Present: true, State: "stopped"}, wantStatus: "unchanged"},
		{name: "elevation", request: ServiceActionRequest{Action: ServiceActionStop, ExpectedState: "running", Confirmed: true}, observed: ServiceObservation{Present: true, State: "running"}, performErr: errElevationRequired, wantStatus: "elevation-required", wantCalls: 1},
		{name: "failed", request: ServiceActionRequest{Action: ServiceActionStop, ExpectedState: "running", Confirmed: true}, observed: ServiceObservation{Present: true, State: "running"}, performErr: errors.New("synthetic invalid-password invalid-token"), wantStatus: "failed", wantCalls: 1},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			calls := 0
			result, err := executeServiceAction(context.Background(), test.request, func(context.Context) (ServiceObservation, error) {
				return test.observed, nil
			}, func(context.Context, ServiceAction) error {
				calls++
				return test.performErr
			}, time.Now)
			if err != nil || result.Status != test.wantStatus || calls != test.wantCalls {
				t.Fatalf("result=%#v calls=%d err=%v", result, calls, err)
			}
			if strings.Contains(result.Message, "invalid-password") || strings.Contains(result.Message, "invalid-token") {
				t.Fatalf("operation error leaked into response: %q", result.Message)
			}
			if test.wantStatus == "elevation-required" && (!result.ElevationRequired || result.ManualCommand == "" || result.ElevationMechanism == "") {
				t.Fatalf("missing elevation handoff: %#v", result)
			}
		})
	}
}

func TestServiceActionVerifiesResultingState(t *testing.T) {
	t.Parallel()
	observations := []ServiceObservation{{Present: true, State: "stopped"}, {Present: true, State: "running", PID: 42}}
	index := 0
	result, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: ServiceActionStart, ExpectedState: "stopped", Confirmed: true}, func(context.Context) (ServiceObservation, error) {
		value := observations[index]
		index++
		return value, nil
	}, func(_ context.Context, action ServiceAction) error {
		if action != ServiceActionStart {
			t.Fatalf("action=%q", action)
		}
		return nil
	}, time.Now)
	if err != nil || result.Status != "completed" || result.Service.State != "running" || result.Service.PID != 42 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestServiceActionRejectsUnverifiedTargetState(t *testing.T) {
	t.Parallel()
	result, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: ServiceActionStart, ExpectedState: "stopped", Confirmed: true}, func(context.Context) (ServiceObservation, error) {
		return ServiceObservation{Present: true, State: "stopped"}, nil
	}, func(context.Context, ServiceAction) error { return nil }, time.Now)
	if err != nil || result.Status != "failed" || !strings.Contains(result.Message, "did not reach") {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestPrivilegeDenialOutputClassification(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		"Interactive authentication required.",
		"Failed to start cloudflared.service: Access denied",
		"Bootstrap failed: 1: Operation not permitted",
		"Insufficient privileges",
	} {
		if !outputIndicatesElevation(value) {
			t.Fatalf("did not classify elevation output %q", value)
		}
	}
	if outputIndicatesElevation("unit cloudflared.service not found") {
		t.Fatal("ordinary service error was classified as elevation")
	}
}

func TestInvalidActionIsNotReflected(t *testing.T) {
	t.Parallel()
	secretLikeAction := ServiceAction("invalid-password-token")
	result, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: secretLikeAction, ExpectedState: "running", Confirmed: true}, func(context.Context) (ServiceObservation, error) {
		t.Fatal("invalid action reached observer")
		return ServiceObservation{}, nil
	}, func(context.Context, ServiceAction) error {
		t.Fatal("invalid action reached performer")
		return nil
	}, time.Now)
	if err != nil || result.Action != "" || strings.Contains(result.Message, string(secretLikeAction)) {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestServiceActionRejectsIncompatibleObservedStates(t *testing.T) {
	t.Parallel()
	tests := []struct {
		action ServiceAction
		state  string
	}{
		{action: ServiceActionStart, state: "paused"},
		{action: ServiceActionStart, state: "unknown"},
		{action: ServiceActionStart, state: "starting"},
		{action: ServiceActionStop, state: "unknown"},
		{action: ServiceActionStop, state: "stopping"},
		{action: ServiceActionRestart, state: "unknown"},
		{action: ServiceActionRestart, state: "starting"},
		{action: ServiceActionRestart, state: "stopping"},
	}
	for _, test := range tests {
		test := test
		t.Run(string(test.action)+"-from-"+test.state, func(t *testing.T) {
			t.Parallel()
			performed := false
			result, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: test.action, ExpectedState: test.state, Confirmed: true}, func(context.Context) (ServiceObservation, error) {
				return ServiceObservation{Present: true, State: test.state}, nil
			}, func(context.Context, ServiceAction) error {
				performed = true
				return nil
			}, time.Now)
			if err != nil || result.Status != "failed" || performed {
				t.Fatalf("result=%#v performed=%v err=%v", result, performed, err)
			}
		})
	}
}

func TestServiceActionMapsPrivilegeDeniedPreflight(t *testing.T) {
	t.Parallel()
	result, err := executeServiceAction(context.Background(), ServiceActionRequest{Action: ServiceActionRestart, ExpectedState: "running", Confirmed: true}, func(context.Context) (ServiceObservation, error) {
		return ServiceObservation{Present: true, State: "unknown"}, errElevationRequired
	}, func(context.Context, ServiceAction) error {
		t.Fatal("privilege-denied preflight reached performer")
		return nil
	}, time.Now)
	if err != nil || result.Status != "elevation-required" || !result.ElevationRequired || result.ManualCommand == "" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}
