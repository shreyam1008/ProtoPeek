package tailnet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const fixtureStatus = `{"Version":"1.fixture","BackendState":"Running","AuthURL":"https://secret.invalid/token","PrivateKey":"never expose","CurrentTailnet":{"Name":"example.test"},"Self":{"ID":"self","HostName":"this-pc","TailscaleIPs":["100.64.0.1"]},"Peer":{"one":{"ID":"direct","HostName":"Direct","Online":true,"Active":true,"CurAddr":"192.0.2.1:41641","Relay":"nyc","TailscaleIPs":["100.64.0.2"],"AllowedIPs":["100.64.0.2/32","10.0.0.0/24"],"ExitNodeOption":true,"TaildropTarget":1},"two":{"ID":"idle","HostName":"Idle","Online":true,"Active":false,"Relay":"lhr","TailscaleIPs":["100.64.0.3"],"TaildropTarget":3},"three":{"ID":"relay","HostName":"Relay","Online":true,"Active":true,"Relay":"syd","RxBytes":18446744073709551615},"null":null}}`
const fixtureProfiles = `[{"id":"work","nickname":"Work","selected":true},{"id":"personal","selected":false}]`

func fakeService() (*Service, *[]string) {
	calls := []string{}
	service := &Service{Find: func() (string, error) { return "fixture-client", nil }, Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
		command := strings.Join(args, " ")
		calls = append(calls, command)
		if command == "status --json" {
			return []byte(fixtureStatus), nil
		}
		if command == "switch --list --json" {
			return []byte(fixtureProfiles), nil
		}
		return []byte("fixture operation complete"), nil
	}}
	return service, &calls
}

func TestStatusEvidenceAndSecretBoundary(t *testing.T) {
	service, calls := fakeService()
	result, err := service.Inspect(context.Background())
	if err != nil || !result.Available || len(result.Peers) != 3 || len(result.Revision) != 64 {
		t.Fatalf("inspect = %+v, %v", result, err)
	}
	if !reflect.DeepEqual(*calls, []string{"status --json", "switch --list --json"}) {
		t.Fatal(*calls)
	}
	direct, idle, relay := result.Peers[0], result.Peers[1], result.Peers[2]
	if direct.Connection != "direct" || !direct.TaildropAvailable || len(direct.Routes) != 1 || direct.Routes[0] != "10.0.0.0/24" {
		t.Fatalf("direct = %+v", direct)
	}
	if idle.Connection != "idle" || idle.TaildropAvailable {
		t.Fatalf("idle = %+v", idle)
	}
	if relay.Connection != "DERP relay" || relay.RxBytes != "18446744073709551615" {
		t.Fatalf("relay = %+v", relay)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "secret.invalid") || strings.Contains(string(encoded), "never expose") {
		t.Fatal("secret leaked")
	}
	if _, err := parseStatus([]byte(`{"BackendState":null,"Peer":null,"Health":null,"Self":null}`)); err != nil {
		t.Fatal("nullable legacy status rejected", err)
	}
	for _, bad := range []string{"null", "{", "[]", strings.Repeat("x", maxOutput+1)} {
		if _, err := parseStatus([]byte(bad)); err == nil {
			t.Fatal("accepted bad document")
		}
	}
}

func TestTailnetUnavailableAndAccountFailure(t *testing.T) {
	service, _ := fakeService()
	service.Find = func() (string, error) { return "", errors.New("client missing") }
	result, err := service.Inspect(context.Background())
	if err != nil || result.Available || len(result.Warnings) != 1 {
		t.Fatalf("missing = %+v %v", result, err)
	}
	service, _ = fakeService()
	original := service.Run
	service.Run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
		if args[0] == "switch" {
			return nil, errors.New("unsupported flag")
		}
		return original(ctx, path, args...)
	}
	result, err = service.Inspect(context.Background())
	if err != nil || len(result.Peers) != 3 || len(result.Warnings) != 1 {
		t.Fatalf("partial status = %+v %v", result, err)
	}
}

func TestTailnetActionsUseCurrentTypedPlan(t *testing.T) {
	service, calls := fakeService()
	snapshot, _ := service.Inspect(context.Background())
	for _, tc := range []struct{ action, target, want string }{
		{"connect", "", "up --timeout=30s"}, {"disconnect", "", "down"}, {"logout", "", "logout"},
		{"switch", "personal", "switch personal"}, {"exit-node", "direct", "set --exit-node=100.64.0.2"},
		{"clear-exit", "", "set --exit-node="}, {"advertise-exit", "", "set --advertise-exit-node=true"},
		{"stop-advertising-exit", "", "set --advertise-exit-node=false"}, {"netcheck", "", "netcheck"},
		{"ping", "idle", "ping --c=3 --timeout=3s --until-direct=false 100.64.0.3"},
	} {
		result, err := service.Execute(context.Background(), ActionRequest{Action: tc.action, Target: tc.target, Revision: snapshot.Revision, Consent: true})
		if err != nil || strings.Join(result.Arguments, " ") != tc.want {
			t.Fatalf("%s = %+v %v", tc.action, result, err)
		}
	}
	before := len(*calls)
	if _, err := service.Execute(context.Background(), ActionRequest{Action: "disconnect", Revision: snapshot.Revision}); err == nil || len(*calls) != before {
		t.Fatal("unconfirmed operation touched daemon")
	}
	for _, request := range []ActionRequest{{Action: "disconnect", Revision: "stale", Consent: true}, {Action: "switch", Target: "--reset", Revision: snapshot.Revision, Consent: true}, {Action: "exit-node", Target: "idle", Revision: snapshot.Revision, Consent: true}, {Action: "serve", Revision: snapshot.Revision, Consent: true}} {
		if _, err := actionArguments(request, snapshot); err == nil {
			t.Fatalf("accepted %+v", request)
		}
	}
}

func TestTaildropUsesExactAvailableStatusAndLocalPaths(t *testing.T) {
	service, _ := fakeService()
	snapshot, _ := service.Inspect(context.Background())
	directory := t.TempDir()
	file := filepath.Join(directory, "name with spaces.bin")
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	request := ActionRequest{Action: "send-file", Target: "direct", Path: file, Revision: snapshot.Revision, Consent: true}
	args, err := actionArguments(request, snapshot)
	if err != nil || !reflect.DeepEqual(args, []string{"file", "cp", file, "100.64.0.2:"}) {
		t.Fatalf("send = %v %v", args, err)
	}
	request.Target = "idle"
	if _, err := actionArguments(request, snapshot); err == nil {
		t.Fatal("unavailable Taildrop status accepted")
	}
	request.Action, request.Target, request.Path = "receive-files", "", directory
	args, err = actionArguments(request, snapshot)
	if err != nil || !reflect.DeepEqual(args, []string{"file", "get", "--conflict=rename", directory}) {
		t.Fatalf("receive = %v %v", args, err)
	}
	request.Path = "relative"
	if _, err := actionArguments(request, snapshot); err == nil {
		t.Fatal("relative path accepted")
	}
}

func TestHeadscaleUsesSeparateReviewedLoginAndKeepsPriorAccount(t *testing.T) {
	service, calls := fakeService()
	snapshot, _ := service.Inspect(context.Background())
	if !snapshot.AccountsObserved {
		t.Fatal("saved accounts were not observed")
	}
	request := ActionRequest{Action: "login-server", Target: "https://headscale.example.test", Revision: snapshot.Revision, Consent: true}
	result, err := service.Execute(context.Background(), request)
	if err != nil || result.PreviousProfileID != "work" || result.Snapshot == nil || !reflect.DeepEqual(result.Arguments, []string{"login", "--login-server=https://headscale.example.test", "--timeout=30s"}) {
		t.Fatalf("custom login=%+v %v", result, err)
	}
	for _, command := range *calls {
		if strings.Contains(command, "--reset") || strings.Contains(command, "--auth-key") || strings.Contains(command, "--force-reauth") {
			t.Fatal(command)
		}
	}
	for _, target := range []string{"http://headscale.test", "https://user:secret@headscale.test", "https://headscale.test?token=secret", "https://headscale.test#fragment", "https://headscale.test:"} {
		request.Target = target
		if _, err := actionArguments(request, snapshot); err == nil {
			t.Fatal("accepted", target)
		}
	}
	request.Target = "https://headscale.test"
	snapshot.AccountsObserved = false
	if _, err := actionArguments(request, snapshot); err == nil {
		t.Fatal("unobserved current profile accepted")
	}
}

func TestHeadscaleInterruptedLoginDoesNotReturnNativeSignInLinks(t *testing.T) {
	service, _ := fakeService()
	snapshot, _ := service.Inspect(context.Background())
	original := service.Run
	service.Run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
		if args[0] == "login" {
			return []byte("https://auth.test/sentinel-secret"), errors.New("sentinel-secret")
		}
		return original(ctx, path, args...)
	}
	result, err := service.Execute(context.Background(), ActionRequest{Action: "login-server", Target: "https://headscale.test", Revision: snapshot.Revision, Consent: true})
	encoded, _ := json.Marshal(result)
	if err != nil || result.Outcome != "failed" || result.Snapshot == nil || strings.Contains(string(encoded), "sentinel-secret") || !strings.Contains(result.Output, "native terminal command") {
		t.Fatalf("failed login=%+v %v", result, err)
	}
}

func TestTailnetHelperProcess(t *testing.T) {
	mode := os.Getenv("PROTOPEEK_TAILNET_HELPER")
	if mode == "" {
		return
	}
	if mode == "permission" {
		fmt.Fprintln(os.Stderr, "permission denied https://auth.test/sentinel-key")
		os.Exit(1)
	}
	if mode == "wait" {
		time.Sleep(time.Minute)
	} else {
		fmt.Print(strings.Repeat("x", maxOutput+1))
	}
	os.Exit(0)
}

func TestTailnetProcessBoundsAndCancellation(t *testing.T) {
	executable, _ := os.Executable()
	t.Setenv("PROTOPEEK_TAILNET_HELPER", "oversize")
	if _, err := runClient(context.Background(), executable, "-test.run=^TestTailnetHelperProcess$"); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("cap = %v", err)
	}
	t.Setenv("PROTOPEEK_TAILNET_HELPER", "wait")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := runClient(ctx, executable, "-test.run=^TestTailnetHelperProcess$")
	if err == nil || time.Since(start) > 3*time.Second {
		t.Fatalf("cancellation = %v", err)
	}
}

func TestInstalledTailscaleReadOnly(t *testing.T) {
	if os.Getenv("PROTOPEEK_TAILSCALE_INTEGRATION") != "1" {
		t.Skip("opt in to installed-client read-only inspection")
	}
	result, err := New().Inspect(context.Background())
	if err != nil || !result.Available || result.Version == "" {
		t.Fatalf("inspect = %+v %v", result, err)
	}
	t.Logf("Client %s, state %s, %d peers; no mutations", result.Version, result.State, len(result.Peers))
}

func TestTailnetFailureCategoriesNeverReflectNativeOutput(t *testing.T) {
	for _, test := range []struct{ native, want string }{{"permission denied https://auth.test/sentinel-key", "permission restriction"}, {"not allowed by policy sentinel-key", "policy restriction"}, {"authentication required sentinel-key", "requires sign-in"}, {"unexpected sentinel-key", "CLI did not complete"}} {
		result := actionFailureOutput(errors.New(test.native))
		if !strings.Contains(result, test.want) || strings.Contains(result, "sentinel-key") || strings.Contains(result, "https://") {
			t.Fatalf("unsafe or missing category: %q", result)
		}
	}
}

func TestTailnetCommandMarginAndTimeoutOutcome(t *testing.T) {
	for _, action := range []string{"connect", "login-server"} {
		for _, cancelled := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/cancelled=%v", action, cancelled), func(t *testing.T) {
				service, _ := fakeService()
				current, _ := service.Inspect(context.Background())
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				original := service.Run
				invoked := false
				service.Run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
					if args[0] != "up" && args[0] != "login" {
						return original(ctx, path, args...)
					}
					invoked = true
					deadline, ok := ctx.Deadline()
					if !ok || time.Until(deadline) < 33*time.Second || time.Until(deadline) > 35*time.Second || args[len(args)-1] != "--timeout=30s" {
						t.Fatalf("native deadline has no exit margin: %v %v %v", deadline, ok, args)
					}
					if cancelled {
						cancel()
						return nil, ctx.Err()
					}
					return nil, context.DeadlineExceeded
				}
				input := ActionRequest{Action: action, Revision: current.Revision, Consent: true}
				if action == "login-server" {
					input.Target = "https://headscale.test"
				}
				result, _ := service.Execute(parent, input)
				want := "failed"
				if cancelled {
					want = "cancelled"
				}
				if !invoked || result.Outcome != want || result.Snapshot == nil {
					t.Fatalf("timeout/cancel observation = %+v, invoked=%v", result, invoked)
				}
				if !cancelled && action == "connect" && !strings.Contains(result.Output, "exceeded its time limit") {
					t.Fatalf("deadline lacks recovery guidance: %+v", result)
				}
				if !cancelled && action == "login-server" && !strings.Contains(result.Output, "native terminal command") {
					t.Fatalf("headless timeout lacks native handoff: %+v", result)
				}
			})
		}
	}
}

func TestTailnetNativeStderrReachesSafeFailureCategory(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROTOPEEK_TAILNET_HELPER", "permission")
	_, nativeErr := runClient(context.Background(), executable, "-test.run=^TestTailnetHelperProcess$")
	if nativeErr == nil || !strings.Contains(nativeErr.Error(), "permission denied") {
		t.Fatalf("native stderr did not reach the internal classifier: %v", nativeErr)
	}
	safe := actionFailureOutput(nativeErr)
	if !strings.Contains(safe, "permission restriction") || strings.Contains(safe, "sentinel-key") || strings.Contains(safe, "https://") {
		t.Fatalf("unsafe native failure category: %q", safe)
	}
}
