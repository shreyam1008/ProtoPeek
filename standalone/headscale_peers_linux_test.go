package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
)

// The second scratch container also contains a pinned Headscale server. Nothing
// in its namespace can reach a production control plane or a host daemon.
func TestIsolatedHeadscalePeers(t *testing.T) {
	if os.Getenv("PROTOPEEK_ISOLATED_HEADSCALE") != "1" {
		t.Skip("requires the isolated Headscale CI container")
	}
	interfaces, err := net.Interfaces()
	if err != nil || len(interfaces) != 1 || interfaces[0].Flags&net.FlagLoopback == 0 {
		t.Fatal("a loopback-only namespace is required")
	}
	const socket = "/var/run/tailscale/tailscaled.sock"
	if _, err := os.Lstat(socket); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected a fresh private socket: %v", err)
	}
	const config = "/tmp/headscale.yaml"
	const control = "http://127.0.0.1:18080"
	// All listeners, including the embedded DERP/STUN server, belong to this
	// container. Both clients use userspace networking and decline DNS changes.
	err = os.WriteFile(config, []byte(`server_url: http://127.0.0.1:18080
listen_addr: 127.0.0.1:18080
metrics_listen_addr: 127.0.0.1:19090
grpc_listen_addr: 127.0.0.1:15443
noise: {private_key_path: /tmp/noise.key}
prefixes: {v4: 100.64.0.0/10}
database: {type: sqlite, sqlite: {path: /tmp/headscale.sqlite}}
unix_socket: /tmp/headscale.sock
dns: {magic_dns: false, override_local_dns: false}
disable_check_updates: true
logtail: {enabled: false}
derp:
  server:
    enabled: true
    region_id: 999
    region_code: fixture
    region_name: Local fixture
    private_key_path: /tmp/derp.key
    stun_listen_addr: 127.0.0.1:13478
    ipv4: 127.0.0.1
  urls: []
  auto_update_enabled: false
`), 0600)
	if err != nil {
		t.Fatal(err)
	}
	start := func(name string, args ...string) {
		t.Helper()
		cmd := exec.CommandContext(t.Context(), name, args...)
		if name == "tailscaled" {
			// Tailscale v1.104.5 pauses its control client without a non-loopback
			// interface (ipn/ipnlocal/local.go:shouldPauseControlClientLocked).
			// Permit the real local control handshake inside this networkless namespace.
			cmd.Env = append(os.Environ(), "TS_ASSUME_NETWORK_UP_FOR_TEST=1")
		}
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	}
	run := func(tool string, args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		data, err := exec.CommandContext(ctx, tool, args...).Output()
		if err != nil {
			// Tailscale and Headscale command output may contain registration keys.
			t.Fatalf("%s failed: %v", tool, err)
		}
		return data
	}
	start("headscale", "--config", config, "serve")
	httpClient := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := httpClient.Get(control + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("private Headscale health endpoint did not become ready")
		}
		time.Sleep(100 * time.Millisecond)
	}
	head := func(args ...string) []byte {
		t.Helper()
		return run("headscale", append([]string{"--config", config, "--output", "json"}, args...)...)
	}
	var user struct{ ID json.RawMessage }
	if err := json.Unmarshal(head("users", "create", "fixture"), &user); err != nil {
		t.Fatal("Headscale did not return the created account")
	}
	uid := strings.Trim(string(user.ID), `"`)
	if _, err := strconv.ParseUint(uid, 10, 64); err != nil {
		t.Fatal("invalid Headscale fixture user id")
	}
	for i, sock := range []string{socket, "/tmp/second.sock"} {
		name := fmt.Sprintf("fixture-%d", i+1)
		start("tailscaled", "--tun=userspace-networking", "--socket="+sock, "--state=mem:", "--statedir=/tmp/"+name, "--no-logs-no-support")
		deadline = time.Now().Add(8 * time.Second)
		for {
			data, err := exec.CommandContext(t.Context(), "tailscale", "--socket="+sock, "status", "--json").Output()
			var state struct{ BackendState string }
			if err == nil && json.Unmarshal(data, &state) == nil && state.BackendState == "NeedsLogin" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s signed-out daemon not ready", name)
			}
			time.Sleep(100 * time.Millisecond)
		}
		var auth struct{ Key string }
		if err := json.Unmarshal(head("preauthkeys", "create", "--user", uid), &auth); err != nil || auth.Key == "" {
			t.Fatal("Headscale did not issue a one-time registration key")
		}
		keyFile := "/tmp/" + name + ".auth"
		if err := os.WriteFile(keyFile, []byte(auth.Key), 0600); err != nil {
			t.Fatal(err)
		}
		t.Logf("registering isolated daemon %s", name)
		run("tailscale", "--socket="+sock, "up", "--timeout=15s", "--login-server="+control, "--accept-dns=false", "--hostname="+name, "--auth-key=file:"+keyFile)
		if err := os.Remove(keyFile); err != nil {
			t.Fatal(err)
		}
	}
	service := tailnet.New()
	deadline = time.Now().Add(15 * time.Second)
	var snapshot tailnet.Snapshot
	for {
		snapshot, err = service.Inspect(t.Context())
		if err == nil && snapshot.State == "Running" && snapshot.Self != nil && snapshot.Self.Name == "fixture-1" && len(snapshot.Peers) == 1 {
			peer := snapshot.Peers[0]
			if peer.Name == "fixture-2" && peer.ID != "" && peer.ID != snapshot.Self.ID && len(peer.IPs) > 0 && peer.Online != nil && *peer.Online {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected two registered nodes, got state=%s peers=%d", snapshot.State, len(snapshot.Peers))
		}
		time.Sleep(150 * time.Millisecond)
	}
	result, err := service.Execute(t.Context(), tailnet.ActionRequest{Action: "disconnect", Consent: true, Revision: snapshot.Revision})
	if err != nil || result.Outcome != "completed" || result.Snapshot == nil {
		t.Fatal("reviewed disconnect failed")
	}
	deadline = time.Now().Add(5 * time.Second)
	stopped := result.Snapshot.State == "Stopped"
	for !stopped && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		after, err := service.Inspect(t.Context())
		stopped = err == nil && after.State == "Stopped"
	}
	if !stopped {
		t.Fatal("the first daemon did not stop")
	}
	data := run("tailscale", "--socket=/tmp/second.sock", "status", "--json")
	var second struct {
		BackendState string
		TailscaleIPs []string
		Self         struct{ HostName string }
	}
	if json.Unmarshal(data, &second) != nil || second.BackendState != "Running" || second.Self.HostName != "fixture-2" || len(second.TailscaleIPs) == 0 || second.TailscaleIPs[0] != snapshot.Peers[0].IPs[0] {
		t.Fatal("disconnect affected the other node")
	}
	t.Log("two userspace daemons registered with private Headscale; ProtoPeek observed the peer's identity, online state and IP, then disconnected only the selected daemon")
}
