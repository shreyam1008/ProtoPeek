package media

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Only this test executable recognizes the fixture marker. It accepts the
// real engine arguments before testing parses them, without running a vendor.
func init() {
	switch os.Getenv("PP_MEDIA_TREE_FIXTURE") {
	case "parent":
		executable, err := os.Executable()
		if err != nil {
			os.Exit(81)
		}
		child := exec.Command(executable)
		child.Env = append(os.Environ(), "PP_MEDIA_TREE_FIXTURE=descendant")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if child.Run() != nil {
			os.Exit(82)
		}
		os.Exit(0)
	case "descendant":
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			os.Exit(83)
		}
		ready := os.Getenv("PP_MEDIA_TREE_READY")
		if os.WriteFile(ready+".new", []byte(listener.Addr().String()), 0600) != nil {
			os.Exit(84)
		}
		if os.Rename(ready+".new", ready) != nil {
			os.Exit(84)
		}
		for {
			connection, err := listener.Accept()
			if err != nil {
				os.Exit(85)
			}
			connection.SetReadDeadline(time.Now().Add(time.Second))
			line, _ := bufio.NewReader(connection).ReadString('\n')
			connection.Close()
			if line == "STOP OWNED MEDIA FIXTURE\n" {
				listener.Close()
				os.Exit(0)
			}
		}
	}
}

func TestMediaCancellationAndNormalShutdownCloseOwnedDescendant(t *testing.T) {
	for _, action := range []string{"cancel", "close"} {
		t.Run(action, func(t *testing.T) {
			folder := t.TempDir()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			name := "yt-dlp"
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			source, err := os.Open(executable)
			if err != nil {
				t.Fatal(err)
			}
			destination, err := os.OpenFile(filepath.Join(folder, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
			if err != nil {
				source.Close()
				t.Fatal(err)
			}
			_, copyErr := io.Copy(destination, source)
			source.Close()
			closeErr := destination.Close()
			if copyErr != nil || closeErr != nil {
				t.Fatalf("copy owned fixture: %v %v", copyErr, closeErr)
			}
			ready := filepath.Join(folder, "descendant-ready")
			t.Setenv("PATH", folder)
			t.Setenv("PP_MEDIA_TREE_FIXTURE", "parent")
			t.Setenv("PP_MEDIA_TREE_READY", ready)
			s := testService(t)
			job, err := s.Add(Request{URL: "https://fixture.invalid/media", Engine: "yt-dlp", Format: "video", Directory: folder, Start: 1, End: 1})
			if err != nil {
				t.Fatal(err)
			}
			var address string
			var lastData []byte
			var lastError error
			started := time.Now()
			until := started.Add(8 * time.Second)
			for time.Now().Before(until) {
				lastData, lastError = os.ReadFile(ready)
				if lastError == nil {
					endpoint, err := netip.ParseAddrPort(string(lastData))
					if err == nil && endpoint.Addr().IsLoopback() && endpoint.Port() != 0 {
						address = endpoint.String()
						break
					}
				}
				time.Sleep(10 * time.Millisecond)
			}
			if address == "" {
				jobs, _ := json.Marshal(s.Snapshot().Jobs)
				t.Fatalf("owned descendant readiness unavailable after %s: read=%q error=%v jobs=%s", time.Since(started), lastData, lastError, jobs)
			}
			// Even a failing cancellation assertion leaves no fixture behind.
			t.Cleanup(func() {
				if connection, err := net.DialTimeout("tcp", address, 200*time.Millisecond); err == nil {
					connection.SetWriteDeadline(time.Now().Add(time.Second))
					io.WriteString(connection, "STOP OWNED MEDIA FIXTURE\n")
					connection.Close()
				}
			})
			if action == "cancel" {
				if err := s.Action(job.ID, "cancel"); err != nil {
					t.Fatal(err)
				}
				awaitJob(t, s, job.ID, "cancelled")
			} else {
				closed := make(chan struct{})
				go func() { s.Close(); close(closed) }()
				select {
				case <-closed:
				case <-time.After(8 * time.Second):
					t.Fatal("normal shutdown did not finish within its fixture bound")
				}
			}
			connection, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
			if err == nil {
				connection.Close()
				t.Fatal("owned descendant listener survived cancellation/shutdown")
			}
		})
	}
}
