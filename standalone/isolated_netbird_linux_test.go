//go:build linux

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

	"github.com/shreyam1008/ProtoPeek/internal/netbird"
)

// Runs only in the dedicated networkless CI container with the official client.
func TestIsolatedNetBirdLifecycle(t *testing.T) {
	if os.Getenv("PROTOPEEK_ISOLATED_NETBIRD") != "1" {
		t.Skip("requires the isolated NetBird CI container")
	}
	interfaces, err := net.Interfaces()
	if err != nil || len(interfaces) != 1 || interfaces[0].Flags&net.FlagLoopback == 0 {
		t.Fatalf("a loopback-only network namespace is required: %v %v", interfaces, err)
	}
	const socket = "/var/run/netbird.sock"
	if _, err := os.Lstat(socket); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a fresh private daemon socket is required: %v", err)
	}
	if err := os.Mkdir("/tmp/netbird", 0700); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	registerNetBird(mux, netbird.New())
	server := httptest.NewServer(mux)
	defer server.Close()
	inspect := func() (int, []byte) {
		t.Helper()
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, server.URL+"/api/netbird/inspect", nil)
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
		if status != http.StatusBadGateway || !bytes.Contains(body, []byte("NetBird status could not be read")) {
			t.Fatalf("expected daemon-unavailable response, got %d: %s", status, body)
		}
	}
	requireDaemonUnavailable()

	cmd := exec.CommandContext(t.Context(), "/bin/netbird", "service", "run", "--config", "/tmp/netbird/config.json", "--log-file", "console")
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
		var snapshot netbird.Snapshot
		if status == http.StatusOK && json.Unmarshal(body, &snapshot) == nil && snapshot.State == "NeedsLogin" {
			if !snapshot.Available || snapshot.Path != "/bin/netbird" || snapshot.CLIVersion == "" || snapshot.DaemonVersion == "" || snapshot.PeerTotal != 0 || len(snapshot.Peers) != 0 || snapshot.Revision == "" || snapshot.ConnectAllowed || snapshot.DisconnectAllowed {
				t.Fatalf("unexpected signed-out observation: %+v", snapshot)
			}
			t.Logf("real installed client %s observed %s with %d peers", snapshot.CLIVersion, snapshot.State, len(snapshot.Peers))
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
