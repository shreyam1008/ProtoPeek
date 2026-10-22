package publishsession

import (
	"bufio"
	"context"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func launchFixture(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
	return launchValidated(ctx, path, args, output)
}

// If either wrapper is ever admitted, its first operation leaves evidence even
// before forking. The ELF variant tests a compiled wrapper, not just a shebang.
func init() {
	if os.Getenv("PP_PUBLISH_FORK_WRAPPER") != "1" {
		return
	}
	_ = os.WriteFile(os.Getenv("PP_PUBLISH_FORK_MARKER"), []byte("wrapper executed"), 0600)
	_ = os.Setenv("PP_PUBLISH_FORK_WRAPPER", "")
	_ = os.Setenv("PP_PUBLISH_LIFETIME_HELPER", "child")
	value := exec.Command(os.Args[0], "-test.run=^TestPublishingLifetimeChildHelper$")
	_ = value.Run()
	os.Exit(0)
}

func TestLinuxPublishingRefusesForkingWrappersBeforeExecution(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"shell", "ELF"} {
		t.Run(kind, func(t *testing.T) {
			directory := t.TempDir()
			path := filepath.Join(directory, "cloudflared")
			marker := filepath.Join(directory, "executed")
			t.Setenv("PP_PUBLISH_FORK_WRAPPER", "1")
			t.Setenv("PP_PUBLISH_FORK_MARKER", marker)
			if kind == "shell" {
				// No shell is launched by ProtoPeek. This script would fork a
				// sleep child and leave the marker if native admission regresses.
				script := "#!/bin/sh\nprintf wrapper-executed > \"$PP_PUBLISH_FORK_MARKER\"\nsleep 10 &\nwait\n"
				if err := os.WriteFile(path, []byte(script), 0700); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Symlink(executable, path); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", directory)
			if _, err := findTool("cloudflared"); err == nil {
				t.Fatal("preview admitted a wrapper before native observation")
			}
			value, err := launch(context.Background(), path, []string{"tunnel", "--url", "http://127.0.0.1:1"}, io.Discard)
			if value != nil {
				_ = value.Kill()
				_ = value.Wait()
				t.Fatal("wrapper was launched")
			}
			message, safe := PublicErrorMessage(err)
			if err == nil || !safe || !strings.Contains(message, "native client") {
				t.Fatalf("missing actionable wrapper refusal: %v", err)
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatal("wrapper ran before admission refused it")
			}
		})
	}
}

func TestPublishingGroupParentHelper(t *testing.T) {
	if os.Getenv("PP_PUBLISH_GROUP_HELPER") != "parent" {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	value := exec.Command(executable, "-test.run=^TestPublishingLifetimeChildHelper$")
	value.Env = append(os.Environ(), "PP_PUBLISH_LIFETIME_HELPER=child", "PP_PUBLISH_LIFETIME_KIND=descendant")
	value.Stdout, value.Stderr = os.Stdout, os.Stderr
	if err := value.Start(); err != nil {
		t.Fatal(err)
	}
	if marker := os.Getenv("PP_PUBLISH_GROUP_EXIT_MARKER"); marker != "" {
		deadline := time.Now().Add(6 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(marker); err == nil {
				return // Leave the descendant running to verify normal-exit group cleanup.
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("normal-exit fixture marker was not received")
	}
	if err := value.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestLinuxOwnedStopAndCancellationCloseDescendantSocket(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{"Stop", "cancel", "normal exit"} {
		t.Run(operation, func(t *testing.T) {
			t.Setenv("PP_PUBLISH_GROUP_HELPER", "parent")
			marker := ""
			if operation == "normal exit" {
				marker = filepath.Join(t.TempDir(), "exit")
			}
			t.Setenv("PP_PUBLISH_GROUP_EXIT_MARKER", marker)
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			defer writer.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			value, err := launchFixture(ctx, executable, []string{"-test.run=^TestPublishingGroupParentHelper$"}, writer)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = value.Kill(); _ = value.Wait() }()
			address := make(chan string, 1)
			go func() {
				scanner := bufio.NewScanner(reader)
				for scanner.Scan() {
					fields := strings.Fields(scanner.Text())
					if len(fields) == 3 && fields[0] == "READY" && fields[1] == "descendant" {
						address <- fields[2]
						return
					}
				}
			}()
			var target string
			select {
			case target = <-address:
			case <-time.After(6 * time.Second):
				t.Fatal("owned descendant did not become ready")
			}
			connection, err := net.DialTimeout("tcp", target, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
			if _, err := io.ReadFull(connection, make([]byte, 1)); err != nil {
				t.Fatal(err)
			}
			if operation == "Stop" {
				if err := value.Kill(); err != nil {
					t.Fatal(err)
				}
			} else if operation == "cancel" {
				cancel()
			} else if err := os.WriteFile(marker, []byte("exit"), 0600); err != nil {
				t.Fatal(err)
			}
			_ = value.Wait()
			if err := value.Kill(); err != os.ErrProcessDone {
				t.Fatalf("late group signal was allowed after reaping: %v", err)
			}
			_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
			if _, err := connection.Read(make([]byte, 1)); err == nil {
				t.Fatal("descendant retained its live socket")
			} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				t.Fatal("owned descendant survived Stop/cancellation")
			}
		})
	}
}

func TestLinuxPublishingRefusesKnownLauncherPaths(t *testing.T) {
	for _, path := range []string{"/snap/bin/cloudflared", "/var/lib/snapd/snap/bin/cloudflared", "/var/lib/flatpak/exports/bin/cloudflared", "/home/user/.local/share/flatpak/exports/bin/cloudflared", "/usr/bin/snap", "/usr/lib/snapd/snap-confine", "/usr/bin/flatpak", "/usr/bin/bwrap"} {
		if !linuxLauncherPath(path) {
			t.Fatalf("launcher path accepted: %s", path)
		}
	}
	if linuxLauncherPath("/usr/local/bin/cloudflared-linux-amd64") {
		t.Fatal("a native official download filename was classified as a launcher")
	}
}

func TestLinuxPublishingAdmitsMatchingNativeVendorCommandIdentity(t *testing.T) {
	// Use this test binary's pinned compiler, with no module/workspace/network
	// discovery. These tiny modules are metadata fixtures, never vendor clients.
	goCommand := filepath.Join(runtime.GOROOT(), "bin", "go")
	version := strings.TrimPrefix(runtime.Version(), "go")
	for _, tool := range []string{"cloudflared", "tailscale"} {
		t.Run(tool, func(t *testing.T) {
			module := "github.com/cloudflare/cloudflared"
			other := "tailscale"
			if tool == "tailscale" {
				module, other = "tailscale.com", "cloudflared"
			}
			directory := t.TempDir()
			commandDirectory := filepath.Join(directory, "cmd", tool)
			if err := os.MkdirAll(commandDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "go.mod"), []byte("module "+module+"\n\ngo "+version+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(commandDirectory, "main.go"), []byte("package main\nfunc main() {}\n"), 0600); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(directory, tool+"-native-fixture")
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			command := exec.CommandContext(ctx, goCommand, "build", "-trimpath", "-o", path, "./cmd/"+tool)
			command.Dir = directory
			command.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOWORK=off", "GOPROXY=off", "GOSUMDB=off", "GOFLAGS=-mod=readonly", "CGO_ENABLED=0", "GOOS="+runtime.GOOS, "GOARCH="+runtime.GOARCH)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("offline native command fixture build: %v\n%s", err, output)
			}
			canonical, err := filepath.EvalSymlinks(path)
			if err != nil {
				t.Fatal(err)
			}
			actual, err := validatePublishingExecutable(path, tool)
			if err != nil || actual != canonical {
				t.Fatalf("matching native %s command was refused: %q %v", tool, actual, err)
			}
			if _, err := validatePublishingExecutable(path, other); err == nil {
				t.Fatalf("%s command identity was admitted as %s", tool, other)
			}
		})
	}
}
