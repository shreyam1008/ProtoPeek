package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	grpcreflection "google.golang.org/grpc/reflection"
)

func TestCompatibilityMaxTimeReturnsLocalLimitEvidence(t *testing.T) {
	listener, service, stopTarget := startCompatibilityTimeoutTarget(t)
	defer stopTarget()

	command := exec.Command(
		os.Args[0],
		"-test.run=^TestCompatibilityCommandHelper$",
		"--",
		"-plaintext",
		"-max-time=0.02",
		"-port=0",
		"-open-browser=false",
		listener.Addr().String(),
	)
	command.Env = append(os.Environ(), "PROTOPEEK_GRPCUI_TEST_HELPER=1")
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("capture compatibility stdout: %v", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start compatibility command: %v", err)
	}
	processDone := make(chan error, 1)
	go func() { processDone <- command.Wait() }()
	t.Cleanup(func() {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		select {
		case <-processDone:
		case <-time.After(5 * time.Second):
			t.Errorf("compatibility command did not exit after kill; stderr: %s", stderr.String())
		}
	})

	urlLine := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "gRPC Web UI available at ") {
				urlLine <- strings.TrimPrefix(line, "gRPC Web UI available at ")
				return
			}
		}
		urlLine <- ""
	}()

	var baseURL string
	select {
	case baseURL = <-urlLine:
		if baseURL == "" {
			t.Fatalf("compatibility command exited before publishing its URL; stderr: %s", stderr.String())
		}
	case err := <-processDone:
		t.Fatalf("compatibility command exited before serving: %v; stderr: %s", err, stderr.String())
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for compatibility command; stderr: %s", stderr.String())
	}

	client := &http.Client{Timeout: 5 * time.Second}
	bootstrapResponse, err := client.Get(baseURL)
	if err != nil {
		t.Fatalf("load compatibility UI: %v; stderr: %s", err, stderr.String())
	}
	bootstrapCookies := bootstrapResponse.Cookies()
	_ = bootstrapResponse.Body.Close()
	if len(bootstrapCookies) == 0 {
		t.Fatal("compatibility UI did not issue a CSRF cookie")
	}

	request, err := http.NewRequest(
		http.MethodPost,
		baseURL+"invoke/grpc.health.v1.Health.Watch",
		strings.NewReader(`{"data":[{"service":""}]}`),
	)
	if err != nil {
		t.Fatalf("create compatibility invoke: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-protopeek-csrf-token", bootstrapCookies[0].Value)
	request.AddCookie(bootstrapCookies[0])
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("invoke through compatibility command: %v; stderr: %s", err, stderr.String())
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("invoke status = %d, want %d; stderr: %s", response.StatusCode, http.StatusOK, stderr.String())
	}

	var result struct {
		Error      any               `json:"error"`
		Trailers   []json.RawMessage `json:"trailers"`
		LocalLimit *struct {
			Reason             string  `json:"reason"`
			MaxDurationSeconds float64 `json:"maxDurationSeconds"`
		} `json:"localLimit"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode compatibility invoke: %v", err)
	}
	if result.LocalLimit == nil || result.LocalLimit.Reason != "duration" || result.LocalLimit.MaxDurationSeconds != 0.02 {
		t.Fatalf("compatibility local wall evidence = %#v; error %#v, trailers %#v", result.LocalLimit, result.Error, result.Trailers)
	}
	if result.Error != nil || len(result.Trailers) != 0 {
		t.Fatalf("compatibility local wall fabricated status: error %#v, trailers %#v", result.Error, result.Trailers)
	}
	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("compatibility max-time did not cancel the target RPC")
	}
}

func TestCompatibilityCommandHelper(t *testing.T) {
	if os.Getenv("PROTOPEEK_GRPCUI_TEST_HELPER") != "1" {
		return
	}
	separator := -1
	for index, argument := range os.Args {
		if argument == "--" {
			separator = index
			break
		}
	}
	if separator < 0 {
		fmt.Fprintln(os.Stderr, "missing grpcui helper argument separator")
		os.Exit(2)
	}
	os.Args = append([]string{"grpcui"}, os.Args[separator+1:]...)
	main()
}

type compatibilityTimeoutHealthServer struct {
	healthpb.UnimplementedHealthServer
	canceled chan struct{}
	once     sync.Once
}

func (service *compatibilityTimeoutHealthServer) Watch(
	_ *healthpb.HealthCheckRequest,
	stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse],
) error {
	if err := stream.SendHeader(metadata.Pairs("x-protopeek-test", "observed")); err != nil {
		return err
	}
	<-stream.Context().Done()
	service.once.Do(func() { close(service.canceled) })
	return context.Cause(stream.Context())
}

func startCompatibilityTimeoutTarget(t *testing.T) (net.Listener, *compatibilityTimeoutHealthServer, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for compatibility timeout target: %v", err)
	}
	service := &compatibilityTimeoutHealthServer{canceled: make(chan struct{})}
	server := grpc.NewServer()
	healthpb.RegisterHealthServer(server, service)
	grpcreflection.Register(server)
	done := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(done)
	}()
	return listener, service, func() {
		server.Stop()
		_ = listener.Close()
		<-done
	}
}
