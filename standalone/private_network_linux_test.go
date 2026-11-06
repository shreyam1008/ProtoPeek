package standalone

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
)

// This opt-in native test starts a userspace daemon in the dedicated, networkless
// CI container. The production adapter finds the actual client on PATH.
func TestIsolatedTailscaleLifecycle(t *testing.T) {
	if os.Getenv("PROTOPEEK_ISOLATED_TAILNET") != "1" {
		t.Skip("requires the isolated private-network CI container")
	}
	interfaces, err := net.Interfaces()
	if err != nil || len(interfaces) != 1 || interfaces[0].Flags&net.FlagLoopback == 0 {
		t.Fatalf("a loopback-only network namespace is required: %v %v", interfaces, err)
	}
	const socket = "/var/run/tailscale/tailscaled.sock"
	if _, err := os.Lstat(socket); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a fresh private socket directory is required: %v", err)
	}
	mux := http.NewServeMux()
	registerTailnet(mux)
	server := httptest.NewServer(mux)
	defer server.Close()
	inspect := func() (int, []byte) {
		t.Helper()
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, server.URL+"/api/tailnet/inspect", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "fixture"})
		request.Header.Set(csrfHeaderName, "fixture")
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	requireDaemonUnavailable := func() {
		t.Helper()
		status, body := inspect()
		if status != http.StatusBadGateway || !bytes.Contains(body, []byte("Tailscale status could not be read")) {
			t.Fatalf("expected explicit daemon-unavailable response, got %d: %s", status, body)
		}
	}
	requireDaemonUnavailable()
	cmd := exec.CommandContext(t.Context(), "/bin/tailscaled", "--tun=userspace-networking", "--state=mem:", "--statedir=/tmp/tailscaled", "--socket="+socket, "--no-logs-no-support")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	deadline := time.Now().Add(30 * time.Second)
	for {
		status, body := inspect()
		var snapshot tailnet.Snapshot
		if status == http.StatusOK && json.Unmarshal(body, &snapshot) == nil && snapshot.State == "NeedsLogin" {
			if !snapshot.Available || snapshot.Path != "/bin/tailscale" || snapshot.Version == "" || len(snapshot.Peers) != 0 || snapshot.Revision == "" {
				t.Fatalf("unexpected signed-out observation: %+v", snapshot)
			}
			t.Logf("real installed client %s observed %s with %d peers", snapshot.Version, snapshot.State, len(snapshot.Peers))
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("daemon did not report NeedsLogin, last response %d: %s", status, body)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	requireDaemonUnavailable()
}
