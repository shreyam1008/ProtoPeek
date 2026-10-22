package publishsession

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const statusJSON = `{"Version":"1.102.4","BackendState":"Running","CertDomains":["node.example.ts.net"],"Self":{"ID":"self-a","DNSName":"node.example.ts.net.","CapMap":{"https":[],"funnel":[],"https://tailscale.com/cap/funnel-ports?ports=443,8443,10000":[]}}}`

type fakeProcess struct {
	done chan struct{}
	once sync.Once
}

func (p *fakeProcess) Wait() error { <-p.done; return nil }
func (p *fakeProcess) Kill() error { p.once.Do(func() { close(p.done) }); return nil }
func (*fakeProcess) PID() int      { return 4321 }
func fixture(t *testing.T) (*Supervisor, *atomic.Int32) {
	t.Helper()
	s := New()
	// Each preflight must observe the same installed command identity.
	paths := map[string]string{"cloudflared": filepath.Join(t.TempDir(), "cloudflared"), "tailscale": filepath.Join(t.TempDir(), "tailscale")}
	s.find = func(tool string) (string, error) { return paths[tool], nil }
	s.run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch strings.Join(args, " ") {
		case "status --json --peers=false":
			return []byte(statusJSON), nil
		case "serve status --json":
			return []byte(`{}`), nil
		default:
			t.Errorf("unreviewed observation arguments: %v", args)
			return nil, errors.New("closed fixture")
		}
	}
	s.probe = func(context.Context, string) OriginObservation { return OriginObservation{true, 1} }
	starts := &atomic.Int32{}
	s.start = func(ctx context.Context, _ string, args []string, out io.Writer) (child, error) {
		starts.Add(1)
		p := &fakeProcess{done: make(chan struct{})}
		go func() { <-ctx.Done(); _ = p.Kill() }()
		if args[0] == "tunnel" {
			_, _ = io.WriteString(out, "https://fixture.trycloudflare.com\n{\"message\":\"Registered tunnel connection\"}\n")
		} else {
			_, _ = io.WriteString(out, "Available:\nhttps://node.example.ts.net:8443/\n")
		}
		return p, nil
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, starts
}
func request(mode string) Request {
	port := uint16(8443)
	if mode == "quick" {
		port = 0
	}
	return Request{Mode: mode, Origin: "http://127.0.0.1:3000", Port: port, Minutes: 1}
}
func startFixture(t *testing.T, s *Supervisor, mode string) Session {
	t.Helper()
	preview, err := s.Preview(context.Background(), request(mode))
	if err != nil {
		t.Fatal(err)
	}
	value, err := s.Start(context.Background(), StartRequest{preview.Revision, true})
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func awaitState(t *testing.T, s *Supervisor, state string) Session {
	t.Helper()
	until := time.Now().Add(2 * time.Second)
	for time.Now().Before(until) {
		value, _ := s.Inspect(context.Background())
		if value.Session != nil && value.Session.State == state && (state == "running" || value.Session.Cleanup != "pending") {
			return *value.Session
		}
		time.Sleep(5 * time.Millisecond)
	}
	value, _ := s.Inspect(context.Background())
	t.Fatalf("state %s not reached: %+v", state, value.Session)
	return Session{}
}

func TestPreviewRequiresBoundConsentAndStartsOnlyOneOwnedForegroundProcess(t *testing.T) {
	s, starts := fixture(t)
	preview, err := s.Preview(context.Background(), request("quick"))
	if err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 0 || preview.Audience != "public internet" || !preview.Origin.Connected {
		t.Fatalf("preview changed runtime: %+v", preview)
	}
	for _, input := range []StartRequest{{preview.Revision, false}, {"unknown", true}} {
		if _, err := s.Start(context.Background(), input); err == nil {
			t.Fatal("unreviewed start accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	value, err := s.Start(ctx, StartRequest{preview.Revision, true})
	if err != nil {
		t.Fatal(err)
	}
	cancel() // accepted process survives only the originating HTTP request
	value = awaitState(t, s, "running")
	if value.Endpoint != "https://fixture.trycloudflare.com" || value.EndpointVerified || starts.Load() != 1 {
		t.Fatalf("untruthful endpoint evidence: %+v", value)
	}
	if _, err := s.Start(context.Background(), StartRequest{preview.Revision, true}); err == nil {
		t.Fatal("replayed consent started a second process")
	}
	if _, err := s.Stop(context.Background(), strings.Repeat("0", 32)); err == nil {
		t.Fatal("unowned identity accepted")
	}
	stopped, err := s.Stop(context.Background(), value.ID)
	if err != nil || stopped.State != "stopped" || stopped.Cleanup != "confirmed" {
		t.Fatalf("owned stop: %+v %v", stopped, err)
	}
	if _, err := s.Start(context.Background(), StartRequest{preview.Revision, true}); err == nil {
		t.Fatal("one-use consent replayed after stop")
	}
}

func TestNativePrerequisitesAndChangedStateNeverLaunchOrReset(t *testing.T) {
	for _, mode := range []string{"serve", "funnel"} {
		for _, kind := range []string{"existing config", "unknown config", "missing https", "missing funnel", "port not allowed", "changed account"} {
			if mode == "serve" && (kind == "missing funnel" || kind == "port not allowed") {
				continue
			}
			t.Run(mode+"/"+kind, func(t *testing.T) {
				s, starts := fixture(t)
				preview, err := s.Preview(context.Background(), request(mode))
				if err != nil {
					t.Fatal(err)
				}
				before := s.run
				s.run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
					raw, err := before(ctx, path, args...)
					if args[0] == "serve" {
						if kind == "existing config" {
							return []byte(`{"Foreground":{"unowned":{"Web":{"host:443":{}}}}}`), nil
						}
						if kind == "unknown config" {
							return []byte(`{"FutureMode":{}}`), nil
						}
					} else {
						switch kind {
						case "missing https":
							raw = []byte(strings.ReplaceAll(string(raw), `"https":[],`, ""))
						case "missing funnel":
							raw = []byte(strings.ReplaceAll(string(raw), `"funnel":[],`, ""))
						case "port not allowed":
							raw = []byte(strings.ReplaceAll(string(raw), "443,8443,10000", "443"))
						case "changed account":
							raw = []byte(strings.ReplaceAll(string(raw), "self-a", "self-b"))
						}
					}
					return raw, err
				}
				if _, err := s.Start(context.Background(), StartRequest{preview.Revision, true}); err == nil || starts.Load() != 0 {
					t.Fatalf("changed native state launched: %v", err)
				}
			})
		}
	}
}

func TestPreviewExpiryAndReplacementRevokeOldConsent(t *testing.T) {
	s, starts := fixture(t)
	first, err := s.Preview(context.Background(), request("quick"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Preview(context.Background(), request("quick"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(context.Background(), StartRequest{first.Revision, true}); err == nil {
		t.Fatal("replaced preview consent accepted")
	}
	s.mu.Lock()
	s.preview.value.ExpiresAt = time.Now().Add(-time.Second)
	s.mu.Unlock()
	if _, err := s.Start(context.Background(), StartRequest{second.Revision, true}); err == nil || starts.Load() != 0 {
		t.Fatal("expired preview consent accepted")
	}
}

func TestCleanupUnconfirmedPreservesExternalRulesAndReportsIt(t *testing.T) {
	s, _ := fixture(t)
	value := startFixture(t, s, "serve")
	before := s.run
	s.run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
		if args[0] == "serve" {
			return []byte(`{"TCP":{"443":{"HTTPS":true}}}`), nil
		}
		return before(ctx, path, args...)
	}
	stopped, err := s.Stop(context.Background(), value.ID)
	if err != nil || stopped.Cleanup != "unconfirmed" || !strings.Contains(stopped.Reason, "preserved") {
		t.Fatalf("cleanup claim: %+v %v", stopped, err)
	}
	if _, err := s.Preview(context.Background(), request("quick")); err == nil {
		t.Fatal("new session hid unconfirmed cleanup")
	}
	if err := s.Close(); err == nil {
		t.Fatal("shutdown hid unconfirmed native cleanup")
	}
}

func TestExplicitCleanupRecheckAllowsRecoveryWithoutDeletingRules(t *testing.T) {
	s, _ := fixture(t)
	value := startFixture(t, s, "serve")
	before := s.run
	s.run = func(ctx context.Context, path string, args ...string) ([]byte, error) {
		if args[0] == "serve" {
			return []byte(`{"TCP":{"443":{"HTTPS":true}}}`), nil
		}
		return before(ctx, path, args...)
	}
	if _, err := s.Stop(context.Background(), value.ID); err != nil {
		t.Fatal(err)
	}
	s.run = before // The external/native owner removed its own rule.
	observed, err := s.Inspect(context.Background())
	if err != nil || observed.Session == nil || observed.Session.Cleanup != "confirmed" {
		t.Fatalf("explicit cleanup recovery: %+v %v", observed, err)
	}
	if _, err := s.Preview(context.Background(), request("quick")); err != nil {
		t.Fatal(err)
	}
}

type unconfirmedChild struct{ child }

func (c unconfirmedChild) Wait() error {
	return errors.Join(c.child.Wait(), errProcessOwnershipUnconfirmed)
}

func TestUnconfirmedProcessOwnershipCannotBeClearedByEmptyProviderConfig(t *testing.T) {
	for _, mode := range []string{"quick", "serve"} {
		t.Run(mode, func(t *testing.T) {
			s, _ := fixture(t)
			start := s.start
			s.start = func(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
				value, err := start(ctx, path, args, output)
				return unconfirmedChild{value}, err
			}
			value := startFixture(t, s, mode)
			value = awaitState(t, s, "running")
			stopped, err := s.Stop(context.Background(), value.ID)
			if err != nil || stopped.Cleanup != "unconfirmed" || !strings.Contains(stopped.Reason, "process-group cleanup") {
				t.Fatalf("unknown process ownership was reported as clean: %+v %v", stopped, err)
			}
			if !strings.Contains(stopped.Reason, "Confirm no native client process or public exposure remains") || !strings.Contains(stopped.Reason, "restart ProtoPeek") {
				t.Fatalf("unconfirmed ownership omitted the manual recovery and restart requirement: %q", stopped.Reason)
			}
			observed, err := s.Inspect(context.Background())
			if err != nil || observed.Session == nil || observed.Session.Cleanup != "unconfirmed" {
				t.Fatalf("empty provider config hid unconfirmed process ownership: %+v %v", observed, err)
			}
			if _, err := s.Preview(context.Background(), request(mode)); err == nil {
				t.Fatal("new session was admitted with unconfirmed process ownership")
			}
			if err := s.Close(); err == nil {
				t.Fatal("shutdown claimed process cleanup was confirmed")
			}
		})
	}
}

func TestStartupOutputAndDurationWallsKeepSecretsOutOfEvidence(t *testing.T) {
	for _, kind := range []string{"no endpoint", "oversized line", "oversized total", "duration"} {
		t.Run(kind, func(t *testing.T) {
			s, _ := fixture(t)
			s.startupLimit = 20 * time.Millisecond
			if kind == "duration" {
				s.lifetimeLimit = 30 * time.Millisecond
			}
			s.start = func(ctx context.Context, _ string, _ []string, out io.Writer) (child, error) {
				p := &fakeProcess{done: make(chan struct{})}
				go func() { <-ctx.Done(); _ = p.Kill() }()
				_, _ = io.WriteString(out, "token=SECRET_SENTINEL https://login.example/?key=SECRET_SENTINEL\n")
				switch kind {
				case "oversized line":
					_, _ = io.WriteString(out, strings.Repeat("x", 4097))
				case "oversized total":
					for n := 0; n < 260; n++ {
						if _, err := io.WriteString(out, strings.Repeat("x", 1023)+"\n"); err != nil {
							break
						}
					}
				case "duration":
					_, _ = io.WriteString(out, "https://fixture.trycloudflare.com\nRegistered tunnel connection\n")
				}
				return p, nil
			}
			startFixture(t, s, "quick")
			state := "failed"
			if kind == "duration" {
				state = "stopped"
			}
			result := awaitState(t, s, state)
			data, _ := json.Marshal(result)
			if strings.Contains(string(data), "SECRET_SENTINEL") || len(result.Events) > 64 || result.Cleanup != "confirmed" {
				t.Fatalf("unsafe evidence: %s", data)
			}
		})
	}
}

func TestQuickTunnelUsesPrivateEmptyConfigAndFilteredEnvironment(t *testing.T) {
	s, _ := fixture(t)
	t.Setenv("TUNNEL_TOKEN", "SECRET_SENTINEL")
	t.Setenv("TS_SOCKET", "SECRET_SENTINEL")
	t.Setenv("HTTPS_PROXY", "SECRET_SENTINEL")
	for _, item := range environment() {
		if strings.Contains(item, "SECRET_SENTINEL") {
			t.Fatal("ambient credential override survived")
		}
	}
	var config string
	before := s.start
	s.start = func(ctx context.Context, path string, args []string, out io.Writer) (child, error) {
		config = args[2]
		raw, err := os.ReadFile(config)
		if err != nil || string(raw) != "{}\n" {
			t.Fatalf("private config: %s %v", raw, err)
		}
		joined := strings.Join(args, " ")
		for _, forbidden := range []string{"--bg", "reset", " off", "token", "--no-tls-verify"} {
			if strings.Contains(joined, forbidden) {
				t.Fatalf("unsafe command: %s", joined)
			}
		}
		return before(ctx, path, args, out)
	}
	value := startFixture(t, s, "quick")
	if _, err := s.Stop(context.Background(), value.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(config); !os.IsNotExist(err) {
		t.Fatal("owned temporary config retained")
	}
}

func TestInvalidTargetsNeverInspectOrStart(t *testing.T) {
	s, _ := fixture(t)
	s.find = func(string) (string, error) { t.Fatal("invalid input reached native tool lookup"); return "", nil }
	for _, origin := range []string{"http://example.com:3000", "file:///tmp/private", "http://user:pass@127.0.0.1:3000", "http://127.0.0.1:3000?key=secret", "http://0.0.0.0:3000", "http://[::]:3000", "http://127.0.0.1", "http://127.0.0.1:3000#fragment"} {
		input := request("quick")
		input.Origin = origin
		if _, err := s.Preview(context.Background(), input); err == nil {
			t.Fatalf("invalid origin accepted: %s", origin)
		}
	}
}

// This subprocess fixture has no network operations. Its only command is this
// exact test function; killing it proves native process ownership on each OS.
func TestPublishingOwnedProcessHelper(t *testing.T) {
	if os.Getenv("PP_PUBLISH_TEST_HELPER") != "1" {
		return
	}
	fmt.Println("https://fixture.trycloudflare.com")
	fmt.Println(`{"message":"Registered tunnel connection"}`)
	for {
		time.Sleep(time.Second)
	}
}
func TestRealOwnedChildSurvivesRequestAndStopsOnClose(t *testing.T) {
	s, _ := fixture(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if publishingPlatformError() != nil {
		if value, err := launch(context.Background(), executable, nil, io.Discard); value != nil || err == nil {
			t.Fatal("unsupported platform started a foreground publisher")
		}
		return
	}
	t.Setenv("PP_PUBLISH_TEST_HELPER", "1")
	s.start = func(ctx context.Context, _ string, _ []string, out io.Writer) (child, error) {
		return launchFixture(ctx, executable, []string{"-test.run=^TestPublishingOwnedProcessHelper$"}, out)
	}
	value := startFixture(t, s, "quick")
	value = awaitState(t, s, "running")
	if value.PID <= 0 {
		t.Fatal("native child PID missing")
	}
	started := time.Now()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("shutdown exceeded its wall")
	}
	value = awaitState(t, s, "stopped")
	if value.Cleanup != "confirmed" {
		t.Fatal("child exit not confirmed")
	}
}
