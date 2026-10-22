package cloudflared

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const operationFixture = "# retained comment\ntunnel: 11111111-1111-1111-1111-111111111111\ncredentials-file: private-credential-file.json\noriginRequest:\n  connectTimeout: 12s\ningress:\n  - hostname: existing.test\n    service: http://localhost:8000\n  - service: http_status:404\n"

type operationFixtureState struct {
	path, executable string
	engine           *operations
	calls            [][]string
	service          ServiceObservation
}

func fixtureOperations(t *testing.T) *operationFixtureState {
	t.Helper()
	folder := t.TempDir()
	state := &operationFixtureState{path: filepath.Join(folder, "config.yml"), executable: filepath.Join(folder, "cloudflared")}
	if err := os.WriteFile(state.path, []byte(operationFixture), 0600); err != nil {
		t.Fatal(err)
	}
	state.service = ServiceObservation{Manager: "fixture", Label: "canonical", Present: true, State: "running", PID: 4, ExecutablePath: state.executable, ConfigPath: state.path, argumentsObserved: true}
	state.engine = newOperations(func(context.Context) (Observation, error) {
		config := inspectConfig(state.path, "service-argument")
		config.BoundToCanonicalService = true
		config.ServiceBinding = "explicit-service-argument"
		return Observation{Cloudflared: ToolObservation{Found: true, Path: state.executable, Version: "fixture"}, Service: state.service, Configs: []ConfigCandidate{config}}, nil
	})
	// Root-owned CI fixtures are allowed only through this injected policy. Real file/link,
	// identity, native validation, staging and replacement gates remain exercised.
	state.engine.allowWrite = func(string) error { return nil }
	state.engine.run = func(ctx context.Context, executable string, args ...string) ([]byte, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if executable != state.executable {
			t.Fatalf("unobserved executable %q", executable)
		}
		state.calls = append(state.calls, append([]string{}, args...))
		return []byte("Matched rule #0\nPRIVATE_NATIVE_OUTPUT\n"), nil
	}
	return state
}
func (state *operationFixtureState) request(operation string) OperationRequest {
	data, _ := os.ReadFile(state.path)
	return OperationRequest{Operation: operation, ConfigPath: state.path, Revision: digest(data), Route: IngressRoute{Hostname: "new.test", Path: "/api", Service: "http://127.0.0.1:9000"}}
}
func executeFixture(t *testing.T, state *operationFixtureState, request OperationRequest) OperationResult {
	t.Helper()
	result, err := state.engine.execute(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCanonicalConfigPlanApplyRollback(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	if planned.Status != "planned" || planned.Plan == nil {
		t.Fatalf("%+v", planned)
	}
	before, _ := os.ReadFile(state.path)
	if string(before) != operationFixture {
		t.Fatal("preview changed canonical file")
	}
	request := state.request("apply")
	request.PlanID = planned.Plan.ID
	if got := executeFixture(t, state, request); got.Status != "failed" {
		t.Fatalf("missing consent: %+v", got)
	}
	request.Confirmed = true
	applied := executeFixture(t, state, request)
	if applied.Status != "completed" || applied.Plan == nil || !applied.Plan.Applied || applied.Receipt.After != planned.Plan.After {
		t.Fatalf("%+v", applied)
	}
	data, _ := os.ReadFile(state.path)
	if !strings.Contains(string(data), "retained comment") || !strings.Contains(string(data), "connectTimeout: 12s") || strings.Index(string(data), "new.test") > strings.Index(string(data), "http_status:404") {
		t.Fatalf("settings/catchall changed: %s", data)
	}
	request = state.request("rollback")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	rolled := executeFixture(t, state, request)
	data, _ = os.ReadFile(state.path)
	if rolled.Status != "completed" || string(data) != operationFixture || rolled.Plan.Applied || rolled.Receipt.After != digest(before) {
		t.Fatalf("rollback %+v\n%s", rolled, data)
	}
}

func TestCanonicalConfigStaleAndUnrelatedEditsAreNotOverwritten(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	if err := os.WriteFile(state.path, []byte(operationFixture+"# external edit\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := executeFixture(t, state, request); got.Status != "stale" {
		t.Fatalf("%+v", got)
	}
	request.Revision = state.request("apply").Revision
	if got := executeFixture(t, state, request); got.Status != "stale" {
		t.Fatalf("refresh must not approve old plan: %+v", got)
	}
	data, _ := os.ReadFile(state.path)
	if !strings.Contains(string(data), "external edit") {
		t.Fatal("external edit overwritten")
	}
}

func TestCanonicalConfigNativeFailureRestoresOriginalAndReceipt(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	baseRun := state.engine.run
	failed := false
	state.engine.run = func(ctx context.Context, executable string, args ...string) ([]byte, error) {
		data, _ := os.ReadFile(state.path)
		if args[2] == state.path && digest(data) == planned.Plan.After && !failed {
			failed = true
			return nil, errors.New("PRIVATE_NATIVE_ERROR")
		}
		return baseRun(ctx, executable, args...)
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	got := executeFixture(t, state, request)
	data, _ := os.ReadFile(state.path)
	if got.Status != "rolled-back" || string(data) != operationFixture || got.Plan.Applied || got.Receipt.After != digest([]byte(operationFixture)) {
		t.Fatalf("%+v\n%s", got, data)
	}
}

func TestCanonicalConfigValidationRefusalLeavesGoodFile(t *testing.T) {
	state := fixtureOperations(t)
	state.engine.run = func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("PRIVATE_NATIVE_ERROR")
	}
	got := executeFixture(t, state, state.request("plan"))
	data, _ := os.ReadFile(state.path)
	encoded, _ := json.Marshal(got)
	if got.Status == "planned" || string(data) != operationFixture || strings.Contains(string(encoded), "PRIVATE_NATIVE_ERROR") {
		t.Fatalf("%+v", got)
	}
}

func TestCanonicalConfigRefusesHardlinksAndAuthorityChanges(t *testing.T) {
	state := fixtureOperations(t)
	alias := filepath.Join(filepath.Dir(state.path), "alias.yml")
	if err := os.Link(state.path, alias); err != nil {
		t.Skipf("hardlinks unavailable: %v", err)
	}
	if got := executeFixture(t, state, state.request("validate")); got.Status != "stale" || len(state.calls) != 0 {
		t.Fatalf("linked config was adopted: %+v", got)
	}
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	planned := executeFixture(t, state, state.request("plan"))
	state.service.CredentialSource = "credentials file: changed.json"
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	if got := executeFixture(t, state, request); got.Status != "stale" {
		t.Fatalf("authority changed: %+v", got)
	}
}

func TestCanonicalNativeMatchUsesClosedArgsAndDiscardsRawOutput(t *testing.T) {
	state := fixtureOperations(t)
	request := state.request("match")
	request.URL = "https://existing.test/api?token=PRIVATE_QUERY#PRIVATE_FRAGMENT"
	result := executeFixture(t, state, request)
	want := []string{"tunnel", "--config", state.path, "ingress", "rule", "https://existing.test/api"}
	if result.Status != "completed" || !reflect.DeepEqual(state.calls[0], want) {
		t.Fatalf("%+v %#v", result, state.calls)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "PRIVATE_") {
		t.Fatal("raw private command data escaped")
	}
	state.engine.run = func(context.Context, string, ...string) ([]byte, error) {
		return []byte("Matched rule #0\nMatched rule #1\n"), nil
	}
	if got := executeFixture(t, state, request); got.Status != "unsupported" || got.Data != nil {
		t.Fatalf("ambiguous native output guessed: %+v", got)
	}
	request.URL = "https://user:secret@existing.test"
	count := len(state.calls)
	if got := executeFixture(t, state, request); got.Status == "completed" || count != len(state.calls) {
		t.Fatalf("credential URL executed: %+v", got)
	}
}

func TestCanonicalDiagnosticsRemainExplicitBoundedAndRedacted(t *testing.T) {
	state := fixtureOperations(t)
	log := filepath.Join(filepath.Dir(state.path), "cloudflared.log")
	if err := os.WriteFile(log, []byte("{\"time\":\"2026-10-22T10:00:00Z\",\"level\":\"error\",\"message\":\"certificate PRIVATE_TOKEN\"}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	state.service.LogFile = log
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/diag/tunnel" {
			_, _ = w.Write([]byte(`{"tunnelID":"11111111-1111-1111-1111-111111111111"}`))
			return
		}
		_, _ = w.Write([]byte("cloudflared_tunnel_total_requests{token=\"PRIVATE_LABEL\"} 12\ncloudflared_tunnel_total_requests{code=\"200\"} 3\nprivate_metric_secret 9\n"))
	}))
	defer server.Close()
	state.service.Metrics = strings.TrimPrefix(server.URL, "http://")
	for _, operation := range []string{"logs", "metrics", "report"} {
		got := executeFixture(t, state, state.request(operation))
		encoded, _ := json.Marshal(got)
		if got.Status != "completed" || strings.Contains(string(encoded), "PRIVATE_") || strings.Contains(string(encoded), "private-credential-file") {
			t.Fatalf("%s: %s", operation, encoded)
		}
		if operation == "metrics" && !strings.Contains(string(encoded), `"cloudflared_tunnel_total_requests":15`) {
			t.Fatalf("metrics not aggregated: %s", encoded)
		}
	}
}

func TestCanonicalConfigRejectsUnsafeRouteAndAmbiguousYAML(t *testing.T) {
	for _, route := range []IngressRoute{{Hostname: "bad host", Service: "http://localhost"}, {Hostname: "good.test", Service: "http://u:p@localhost"}, {Hostname: "good.test", Service: "http://localhost:"}, {Hostname: "good.test", Path: "[", Service: "http://localhost"}} {
		if _, err := reviewedRoute(route); err == nil {
			t.Fatalf("unsafe route accepted %+v", route)
		}
	}
	for _, data := range []string{"ingress: &rules\n - service: http_status:404\nother: *rules", "ingress:\n - service: http_status:404\ningress: []", "ingress:\n - hostname: final.test\n   service: http://localhost"} {
		if _, err := appendIngress([]byte(data), IngressRoute{Hostname: "new.test", Service: "http://localhost"}); err == nil {
			t.Fatalf("ambiguous YAML adopted: %s", data)
		}
	}
}

func TestCanonicalConfigRejectsConcurrentEditDuringNativeValidation(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	baseRun := state.engine.run
	state.engine.run = func(ctx context.Context, executable string, args ...string) ([]byte, error) {
		output, err := baseRun(ctx, executable, args...)
		if args[2] != state.path {
			if err := os.WriteFile(state.path, []byte(operationFixture+"# concurrent edit\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		return output, err
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	got := executeFixture(t, state, request)
	data, _ := os.ReadFile(state.path)
	if got.Status != "stale" || !strings.Contains(string(data), "concurrent edit") {
		t.Fatalf("concurrent edit overwritten: %+v", got)
	}
}

func TestCanonicalConfigAutomaticRollbackNeverOverwritesAnExternalEdit(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	baseRun := state.engine.run
	external := operationFixture + "# external edit after commit\n"
	state.engine.run = func(ctx context.Context, executable string, args ...string) ([]byte, error) {
		data, _ := os.ReadFile(state.path)
		if args[2] == state.path && digest(data) == planned.Plan.After {
			if err := os.WriteFile(state.path, []byte(external), 0600); err != nil {
				t.Fatal(err)
			}
			return nil, errors.New("postvalidation failed")
		}
		return baseRun(ctx, executable, args...)
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	got := executeFixture(t, state, request)
	data, _ := os.ReadFile(state.path)
	if got.Status != "rollback-required" || string(data) != external || got.Receipt.After != digest(data) {
		t.Fatalf("external edit overwritten: %+v", got)
	}
}

func TestCanonicalMetricsRefusesMismatchedTunnelBeforeFetchingSamples(t *testing.T) {
	state := fixtureOperations(t)
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		_, _ = w.Write([]byte(`{"tunnelID":"22222222-2222-2222-2222-222222222222"}`))
	}))
	defer server.Close()
	state.service.Metrics = strings.TrimPrefix(server.URL, "http://")
	got := executeFixture(t, state, state.request("metrics"))
	if got.Status != "unavailable" || !reflect.DeepEqual(paths, []string{"/diag/tunnel"}) {
		t.Fatalf("%+v paths=%v", got, paths)
	}
	state.service.Metrics = "0.0.0.0:20241"
	got = executeFixture(t, state, state.request("metrics"))
	if got.Status != "unavailable" || len(paths) != 1 {
		t.Fatalf("wildcard endpoint probed %+v", got)
	}
}

func TestCanonicalConfigRechecksPermissionAuthorityBeforeReplacement(t *testing.T) {
	state := fixtureOperations(t)
	planned := executeFixture(t, state, state.request("plan"))
	checks := 0
	state.engine.allowWrite = func(string) error {
		checks++
		if checks > 1 {
			return errors.New("authority changed")
		}
		return nil
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	got := executeFixture(t, state, request)
	data, _ := os.ReadFile(state.path)
	if got.Status != "stale" || string(data) != operationFixture || checks != 2 {
		t.Fatalf("permission authority was not rechecked: %+v checks=%d", got, checks)
	}
}

func TestCanonicalRollbackRemainsAvailableAfterServiceRestart(t *testing.T) {
	state := fixtureOperations(t)
	plan := executeFixture(t, state, state.request("plan"))
	if plan.Plan == nil {
		t.Fatalf("%+v", plan)
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = plan.Plan.ID, true
	if got := executeFixture(t, state, request); got.Status != "completed" {
		t.Fatalf("%+v", got)
	}
	state.service.PID += 10
	state.service.State = "starting"
	request = state.request("rollback")
	request.PlanID, request.Confirmed = plan.Plan.ID, true
	got := executeFixture(t, state, request)
	data, _ := os.ReadFile(state.path)
	if got.Status != "completed" || string(data) != operationFixture || got.Plan == nil || got.Plan.Applied {
		t.Fatalf("restart prevented rollback: %+v", got)
	}
}

// Captured on Windows from official cloudflared2026.10.3, verified SHA256
// 76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2.
// The native ingress command reads the fixture only; it starts no tunnel.
func TestCanonicalNativeCapturedRuleNumbering(t *testing.T) {
	for _, test := range []struct {
		file, hostname string
		index          int
	}{{"first-rule", "first.example.test", 0}, {"second-rule", "second.example.test", 1}, {"catch-all", "", 2}} {
		t.Run(test.file, func(t *testing.T) {
			state := fixtureOperations(t)
			data, err := os.ReadFile("testdata/ingress-rule-2026.10.3.yml")
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(state.path, data, 0600); err != nil {
				t.Fatal(err)
			}
			output, err := os.ReadFile("testdata/ingress-rule-2026.10.3-" + test.file + ".txt")
			if err != nil {
				t.Fatal(err)
			}
			state.engine.run = func(context.Context, string, ...string) ([]byte, error) { return output, nil }
			request := state.request("match")
			request.URL = "https://" + test.hostname + "/check"
			if test.hostname == "" {
				request.URL = "https://unmatched.example.test/check"
			}
			result := executeFixture(t, state, request)
			if result.Status != "completed" {
				t.Fatalf("%+v", result)
			}
			evidence := result.Data.(map[string]any)
			rule := evidence["rule"].(IngressRoute)
			if evidence["ruleIndex"] != test.index || rule.Hostname != test.hostname || rule.CatchAll != (test.hostname == "") {
				t.Fatalf("native rule was misattributed: %+v", result)
			}
		})
	}
}
