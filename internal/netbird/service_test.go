package netbird

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

const statusFixture = `{"cliVersion":"0.81.3","daemonVersion":"0.81.3","daemonStatus":"Connected","profileName":"Work","netbirdIp":"100.64.0.1/16","management":{"url":"https://user:secret@management.test/api?token=sentinel","connected":true,"error":"secret error"},"signal":{"url":"https://signal.test:443","connected":true},"peers":{"total":1,"details":[{"fqdn":"peer.test","netbirdIp":"100.64.0.2","status":"Connected","publicKey":"private-boundary-sentinel","connectionType":"P2P","iceCandidateType":{"local":"host","remote":"srflx"},"iceCandidateEndpoint":{"local":"192.0.2.1:1234","remote":"198.51.100.1:5678"},"latency":12500000,"transferReceived":9223372036854775807,"transferSent":1,"networks":["10.0.0.0/24"]}]},"relays":{"details":[{"uri":"rels://user:pass@relay.test?token=sentinel","available":true,"transport":"quic"}]},"dnsServers":[{"servers":["100.64.0.1:53"],"domains":["private.test"],"enabled":true}],"setupKey":"never-return-this","sshServer":{"sessions":[{"command":"never-return-this"}]}}`

func fixtureService() (*Service, *[]string) {
	calls := []string{}
	service := &Service{Find: func() (string, error) { return "fixture-netbird", nil }, Environment: func() []string { return nil }}
	service.Run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, strings.Join(args, " "))
		return []byte(statusFixture), nil
	}
	return service, &calls
}

func TestNetBirdPreservesNativeEvidenceAndBoundsSecrets(t *testing.T) {
	service, calls := fixtureService()
	snapshot, err := service.Inspect(context.Background())
	if err != nil || !snapshot.Available || !snapshot.DisconnectAllowed || len(snapshot.Peers) != 1 || len(snapshot.Revision) != 64 {
		t.Fatalf("inspect=%+v %v", snapshot, err)
	}
	peer := snapshot.Peers[0]
	if *peer.LatencyMS != 12.5 || peer.Received != "9223372036854775807" || peer.ICE.Remote != "srflx" || snapshot.Relays[0].Transport != "quic" || snapshot.DNS[0].Domains[0] != "private.test" {
		t.Fatalf("native evidence=%+v", snapshot)
	}
	if !reflect.DeepEqual(*calls, []string{"status --json"}) {
		t.Fatal(*calls)
	}
	encoded, _ := json.Marshal(snapshot)
	for _, secret := range []string{"sentinel", "private-boundary", "never-return", "user:", "secret error", "?token"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("secret leaked: %s", secret)
		}
	}
	for _, bad := range []string{"null", "{}", "[]", "{", `{"cliVersion":12}`, strings.Repeat("x", maxOutput+1)} {
		if _, err := parseStatus([]byte(bad)); err == nil {
			t.Fatalf("accepted %q", bad[:min(30, len(bad))])
		}
	}
}

func TestNetBirdAvailabilityEnvironmentAndVersionAuthority(t *testing.T) {
	service, _ := fixtureService()
	service.Find = func() (string, error) { return "", errors.New("sentinel-secret-path") }
	missing, err := service.Inspect(context.Background())
	if err != nil || missing.Available || strings.Contains(strings.Join(missing.Warnings, ""), "sentinel") {
		t.Fatalf("missing=%+v %v", missing, err)
	}
	service, _ = fixtureService()
	service.Environment = func() []string {
		return []string{"PATH=normal", "NB_MANAGEMENT_URL=https://user:sentinel@remote", "NB_SETUP_KEY=sentinel", "WT_DAEMON_ADDR=tcp://remote:123"}
	}
	blocked, _ := service.Inspect(context.Background())
	if blocked.DisconnectAllowed || blocked.ConnectAllowed || len(blocked.Environment) != 3 {
		t.Fatalf("override controls=%+v", blocked)
	}
	clean, names := cleanEnvironment(service.Environment())
	if !reflect.DeepEqual(clean, []string{"PATH=normal"}) || len(names) != 3 {
		t.Fatalf("clean=%v names=%v", clean, names)
	}
	for _, version := range []string{"0.81.2", "0.81.3beta", "0.81.3-rc1", "garbage", "0.81", "0.+81.3"} {
		if stableVersion(version) {
			t.Fatal("accepted unsafe version", version)
		}
	}
	for _, version := range []string{"0.81.3", "v0.82.0", "1.0.0"} {
		if !stableVersion(version) {
			t.Fatal("refused supported version", version)
		}
	}
}

func TestNetBirdMissingNativeFieldsStayUnknown(t *testing.T) {
	result, err := parseStatus([]byte(`{"cliVersion":"0.81.3","daemonStatus":"Unknown","peers":{"details":[{"fqdn":"legacy.test"}]},"relays":{"details":[{}]},"dnsServers":[{}]}`))
	if err != nil || result.Management.Connected != nil || result.Relays[0].Available != nil || result.DNS[0].Enabled != nil || result.Peers[0].LatencyMS != nil || result.Peers[0].Received != "" {
		t.Fatalf("missing fields manufactured evidence: %+v %v", result, err)
	}
}

func TestNetBirdActionsRequireFreshConsentAndReobserveAfterInterruption(t *testing.T) {
	service, calls := fixtureService()
	snapshot, _ := service.Inspect(context.Background())
	before := len(*calls)
	if _, err := service.Execute(context.Background(), ActionRequest{Action: "disconnect", Revision: snapshot.Revision}); err == nil || len(*calls) != before {
		t.Fatal("unconfirmed operation touched daemon")
	}
	if _, err := service.Execute(context.Background(), ActionRequest{Action: "disconnect", Revision: "stale", Consent: true}); err == nil {
		t.Fatal("accepted stale revision")
	}
	parent, cancel := context.WithCancel(context.Background())
	original := service.Run
	service.Run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
		if args[0] == "down" {
			*calls = append(*calls, "down")
			cancel()
			return nil, context.Canceled
		}
		if ctx.Err() != nil {
			t.Fatal("post-action observation inherited cancelled context")
		}
		return original(ctx, path, args...)
	}
	result, err := service.Execute(parent, ActionRequest{Action: "disconnect", Revision: snapshot.Revision, Consent: true})
	if err != nil || result.Outcome != "cancelled" || result.Snapshot == nil {
		t.Fatalf("interruption=%+v %v", result, err)
	}
	if strings.Join((*calls)[len(*calls)-3:], ";") != "status --json;down;status --json" {
		t.Fatal(*calls)
	}
}

func TestNetBirdReconnectUsesOnlySavedDaemonProfile(t *testing.T) {
	service, calls := fixtureService()
	idle := strings.Replace(statusFixture, `"daemonStatus":"Connected"`, `"daemonStatus":"Idle"`, 1)
	service.Run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		*calls = append(*calls, strings.Join(args, " "))
		return []byte(idle), nil
	}
	snapshot, _ := service.Inspect(context.Background())
	if !snapshot.ConnectAllowed {
		t.Fatal(snapshot.ControlReason)
	}
	result, err := service.Execute(context.Background(), ActionRequest{Action: "connect", Revision: snapshot.Revision, Consent: true})
	if err != nil || result.Outcome != "completed" || result.Snapshot == nil || strings.Join((*calls)[len(*calls)-3:], ";") != "status --json;up --no-browser;status --json" {
		t.Fatalf("reconnect=%+v %v %v", result, err, *calls)
	}
	for _, state := range []string{"NeedsLogin", "LoginFailed", "SessionExpired", "Unknown"} {
		next, err := parseStatus([]byte(strings.Replace(idle, `"daemonStatus":"Idle"`, `"daemonStatus":"`+state+`"`, 1)))
		if err != nil || next.ConnectAllowed {
			t.Fatalf("state %s accepted connect", state)
		}
	}
}

func TestNetBirdHelperProcess(t *testing.T) {
	switch os.Getenv("PROTOPEEK_NETBIRD_HELPER") {
	case "wait":
		time.Sleep(time.Minute)
	case "oversize":
		fmt.Print(strings.Repeat("x", maxOutput+1))
	case "env":
		fmt.Print(os.Getenv("NB_SETUP_KEY"))
	case "fail":
		fmt.Fprintln(os.Stderr, "sentinel-native-auth-link")
		os.Exit(1)
	default:
		return
	}
	os.Exit(0)
}

func TestNetBirdProcessBoundsAndOverrideExclusion(t *testing.T) {
	executable, _ := os.Executable()
	t.Setenv("PROTOPEEK_NETBIRD_HELPER", "env")
	t.Setenv("NB_SETUP_KEY", "sentinel-secret")
	output, err := runClient(context.Background(), executable, "-test.run=^TestNetBirdHelperProcess$")
	if err != nil || len(output) != 0 {
		t.Fatalf("override leaked=%q %v", output, err)
	}
	t.Setenv("PROTOPEEK_NETBIRD_HELPER", "fail")
	if _, err := runClient(context.Background(), executable, "-test.run=^TestNetBirdHelperProcess$"); err == nil || strings.Contains(err.Error(), "sentinel") {
		t.Fatalf("native error leaked: %v", err)
	}
	t.Setenv("PROTOPEEK_NETBIRD_HELPER", "oversize")
	if _, err := runClient(context.Background(), executable, "-test.run=^TestNetBirdHelperProcess$"); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatal(err)
	}
	t.Setenv("PROTOPEEK_NETBIRD_HELPER", "wait")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := runClient(ctx, executable, "-test.run=^TestNetBirdHelperProcess$"); err == nil || time.Since(started) > 3*time.Second {
		t.Fatalf("cancel=%v", err)
	}
}

func TestNetBirdDisconnectAndReconnectWithNativeEmptyLocalPeerState(t *testing.T) {
	service, calls := fixtureService()
	state := "Connected"
	service.Run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		command := strings.Join(args, " ")
		*calls = append(*calls, command)
		switch command {
		case "down":
			state = "Idle"
			return nil, nil
		case "up --no-browser":
			state = "Connected"
			return nil, nil
		case "status --json":
			value := `{"cliVersion":"0.81.3","daemonVersion":"0.81.3","daemonStatus":"` + state + `","profileName":"Work","management":{"url":"https://management.test"}}`
			if state == "Connected" {
				value = strings.TrimSuffix(value, "}") + `,"netbirdIp":"100.64.0.1/16"}`
			}
			return []byte(value), nil
		}
		return nil, errors.New("unexpected native command")
	}
	current, err := service.Inspect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	down, err := service.Execute(context.Background(), ActionRequest{Action: "disconnect", Revision: current.Revision, Consent: true})
	if err != nil || down.Snapshot == nil || len(down.Snapshot.IPs) != 0 || !down.Snapshot.ConnectAllowed {
		t.Fatalf("native Idle profile cannot reconnect: %+v %v", down, err)
	}
	up, err := service.Execute(context.Background(), ActionRequest{Action: "connect", Revision: down.Snapshot.Revision, Consent: true})
	if err != nil || up.Outcome != "completed" || up.Snapshot == nil || up.Snapshot.State != "Connected" {
		t.Fatalf("reconnect failed %+v %v", up, err)
	}
	if strings.Join(*calls, ";") != "status --json;status --json;down;status --json;status --json;up --no-browser;status --json" {
		t.Fatal(*calls)
	}
	for _, document := range []string{`{"cliVersion":"0.81.3","daemonVersion":"0.81.2","daemonStatus":"Idle","profileName":"Work"}`, `{"cliVersion":"0.81.3","daemonVersion":"0.81.3","daemonStatus":"NeedsLogin","profileName":"Work"}`, `{"cliVersion":"0.81.3","daemonVersion":"0.81.3","daemonStatus":"Idle"}`} {
		parsed, err := parseStatus([]byte(document))
		if err != nil || parsed.ConnectAllowed {
			t.Fatalf("unproved profile allowed reconnect: %+v %v", parsed, err)
		}
	}
}
