package publishsession

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// These helpers run only this test binary and loopback echo fixtures. No vendor
// command, account, live capture or external/public endpoint is involved.
func TestPublishingLifetimeChildHelper(t *testing.T) {
	if os.Getenv("PP_PUBLISH_LIFETIME_HELPER") != "child" {
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_ = listener.(*net.TCPListener).SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Printf("READY %s %s\n", os.Getenv("PP_PUBLISH_LIFETIME_KIND"), listener.Addr())
	connection, err := listener.Accept()
	if err != nil {
		return
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(15 * time.Second))
	_, _ = connection.Write([]byte("A"))
	_, _ = io.Copy(connection, connection)
}

func TestPublishingLifetimeParentHelper(t *testing.T) {
	if os.Getenv("PP_PUBLISH_LIFETIME_HELPER") != "parent" {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Setenv("PP_PUBLISH_LIFETIME_HELPER", "child")
	_ = os.Setenv("PP_PUBLISH_LIFETIME_KIND", "owned")
	value, err := launchFixture(context.Background(), executable, []string{"-test.run=^TestPublishingLifetimeChildHelper$"}, os.Stdout)
	if err != nil {
		t.Fatal(err)
	}
	// A subsequently launched unrelated helper must not join the publisher's
	// job. This catches accidental assignment of ProtoPeek itself to that job.
	_ = os.Setenv("PP_PUBLISH_LIFETIME_KIND", "sibling")
	sibling := exec.Command(executable, "-test.run=^TestPublishingLifetimeChildHelper$")
	sibling.Stdout, sibling.Stderr = os.Stdout, os.Stderr
	if err := sibling.Start(); err != nil {
		_ = value.Kill()
		t.Fatal(err)
	}
	go func() { _ = sibling.Wait() }()
	_ = value.Wait()
}

func TestPublishingHardParentDeathKillsOnlyOwnedChild(t *testing.T) {
	if err := publishingPlatformError(); err != nil {
		if _, lookupErr := findTool("cloudflared"); lookupErr == nil {
			t.Fatal("unsupported platform offered native publishing")
		}
		if message, safe := PublicErrorMessage(err); !safe || !strings.Contains(message, "native client") {
			t.Fatal("missing actionable capability gate")
		}
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	parent := exec.Command(executable, "-test.run=^TestPublishingLifetimeParentHelper$")
	parent.Env = append(os.Environ(), "PP_PUBLISH_LIFETIME_HELPER=parent")
	stdout, err := parent.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := parent.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = parent.Process.Kill(); _ = parent.Wait() })
	type ready struct{ kind, address string }
	lines := make(chan ready, 2)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			parts := strings.Fields(scanner.Text())
			if len(parts) == 3 && parts[0] == "READY" {
				lines <- ready{parts[1], parts[2]}
			}
		}
	}()
	connections := map[string]net.Conn{}
	for range 2 {
		var item ready
		select {
		case item = <-lines:
		case <-time.After(6 * time.Second):
			t.Fatal("bounded parent fixture did not become ready")
		}
		connection, err := net.DialTimeout("tcp", item.address, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = connection.Close() }) // Also ends a failed fixture without killing by PID.
		_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
		if _, err := io.ReadFull(connection, make([]byte, 1)); err != nil {
			t.Fatal(err)
		}
		connections[item.kind] = connection
	}
	owned, sibling := connections["owned"], connections["sibling"]
	if owned == nil || sibling == nil {
		t.Fatal("fixture identities missing")
	}
	if err := parent.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = parent.Wait() // A hard kill bypasses context cancellation and deferred Close.
	_ = owned.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := owned.Read(make([]byte, 1)); err == nil {
		t.Fatal("owned publisher survived hard parent death")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatal("owned publisher retained its live socket after parent death")
	}
	_ = sibling.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := sibling.Write([]byte("alive")); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 5)
	if _, err := io.ReadFull(sibling, buffer); err != nil || string(buffer) != "alive" {
		t.Fatalf("unrelated helper was captured: %q %v", buffer, err)
	}
}
