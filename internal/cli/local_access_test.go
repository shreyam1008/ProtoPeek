package cli

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/standalone"
)

func TestValidateWebBind(t *testing.T) {
	t.Parallel()

	for _, bindAddress := range []string{"localhost", "localhost.", "127.0.0.1", "::1"} {
		bindAddress := bindAddress
		t.Run("allows "+bindAddress, func(t *testing.T) {
			t.Parallel()
			if err := validateWebBind(bindAddress, false, false); err != nil {
				t.Fatalf("validateWebBind(%q, false, false) returned %v", bindAddress, err)
			}
		})
	}

	for _, bindAddress := range []string{"0.0.0.0", "192.168.1.10", "example.internal"} {
		bindAddress := bindAddress
		t.Run("rejects "+bindAddress, func(t *testing.T) {
			t.Parallel()
			if err := validateWebBind(bindAddress, false, false); err == nil {
				t.Fatalf("validateWebBind(%q, false, false) unexpectedly succeeded", bindAddress)
			}
			if err := validateWebBind(bindAddress, true, false); err != nil {
				t.Fatalf("safe container bind %q was rejected: %v", bindAddress, err)
			}
			if err := validateWebBind(bindAddress, false, true); err != nil {
				t.Fatalf("explicit unsafe remote bind %q was rejected: %v", bindAddress, err)
			}
		})
	}
}

func TestSafeContainerBindKeepsLoopbackRequestPolicy(t *testing.T) {
	t.Parallel()

	if err := validateWebBind("0.0.0.0", true, false); err != nil {
		t.Fatalf("safe container bind was rejected: %v", err)
	}
	handler := localAccessHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), false)

	for _, test := range []struct {
		name string
		host string
		want int
	}{
		{name: "published loopback host", host: "127.0.0.1:8080", want: http.StatusNoContent},
		{name: "DNS rebinding host", host: "attacker.example:8080", want: http.StatusForbidden},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, "http://"+test.host+"/", nil)
			request.Host = test.host
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d", response.Code, test.want)
			}
		})
	}
}

func TestDockerEntrypointUsesGuardedContainerBind(t *testing.T) {
	t.Parallel()

	contents, err := os.ReadFile("../../Dockerfile")
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	entrypoint := ""
	for _, line := range strings.Split(string(contents), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "ENTRYPOINT ") {
			entrypoint = line
			break
		}
	}
	if entrypoint == "" {
		t.Fatal("Dockerfile has no ENTRYPOINT")
	}
	if !strings.Contains(entrypoint, `"-allow-non-loopback-bind"`) {
		t.Fatalf("Docker ENTRYPOINT does not enable the guarded container bind: %s", entrypoint)
	}
	if strings.Contains(entrypoint, `"-unsafe-allow-remote"`) {
		t.Fatalf("Docker ENTRYPOINT disables the request Host policy: %s", entrypoint)
	}

	smoke, err := os.ReadFile("../../scripts/docker-smoke.sh")
	if err != nil {
		t.Fatalf("read Docker smoke script: %v", err)
	}
	if !strings.Contains(string(smoke), "--connect-timeout") || !strings.Contains(string(smoke), "--max-time") {
		t.Fatal("Docker HTTP probes are not bounded by connect and total timeouts")
	}
	if strings.Contains(string(smoke), "*v*") || !strings.Contains(string(smoke), "expected_version_output") {
		t.Fatal("Docker version probe does not compare against the exact expected build version")
	}
	makefile, err := os.ReadFile("../../Makefile")
	if err != nil {
		t.Fatalf("read Makefile: %v", err)
	}
	if !strings.Contains(string(makefile), `./scripts/docker-smoke.sh protopeek:dev "$(dev_build_version)"`) {
		t.Fatal("Docker smoke target does not pass the exact build version to its probe")
	}
}

func TestExplicitUnsafeRemoteModeAcceptsNonLoopbackHost(t *testing.T) {
	t.Parallel()

	handler := localAccessHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), true)
	request := httptest.NewRequest(http.MethodGet, "http://attacker.example:8080/", nil)
	request.Host = "attacker.example:8080"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("explicit unsafe remote status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestUnsafeRemoteModeMountsNoThisPCServiceOrRoutes(t *testing.T) {
	t.Parallel()
	if service := localThisPCService(true); service != nil {
		t.Fatal("unsafe remote mode unexpectedly constructed a This PC service")
	}
	var options []standalone.HandlerOption
	if service := localThisPCService(true); service != nil {
		options = append(options, standalone.WithThisPCService(service))
	}
	handler := standalone.Handler(nil, "", nil, nil, options...)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/this-pc/capabilities", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unsafe remote This PC route status = %d", response.Code)
	}
	if service := localThisPCService(false); service == nil {
		t.Fatal("local browser mode did not construct a This PC service")
	}
}

func TestUnsafeRemoteModeMountsNoTunnelServiceOrRoutes(t *testing.T) {
	t.Parallel()
	if service := localTunnelService(true); service != nil {
		t.Fatal("unsafe remote mode unexpectedly constructed a tunnel service")
	}
	var options []standalone.HandlerOption
	if service := localTunnelService(true); service != nil {
		options = append(options, standalone.WithTunnelService(service))
	}
	handler := standalone.Handler(nil, "", nil, nil, options...)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/tunnels/capabilities", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unsafe remote tunnel route status = %d", response.Code)
	}
	if service := localTunnelService(false); service == nil {
		t.Fatal("local browser mode did not construct a tunnel service")
	}
}

func TestLocalAccessHandlerRejectsUntrustedHostAndOrigin(t *testing.T) {
	t.Parallel()

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := localAccessHandler(next, false)

	tests := []struct {
		name   string
		host   string
		origin string
		want   int
	}{
		{name: "loopback host", host: "127.0.0.1:8080", want: http.StatusNoContent},
		{name: "localhost host", host: "localhost:8080", origin: "http://localhost:8080", want: http.StatusNoContent},
		{name: "localhost dot host", host: "localhost.:8080", origin: "http://localhost.:8080", want: http.StatusNoContent},
		{name: "ipv6 loopback host", host: "[::1]:8080", want: http.StatusNoContent},
		{name: "host rebinding", host: "attacker.example", want: http.StatusForbidden},
		{name: "non-loopback host", host: "192.168.1.10:8080", want: http.StatusForbidden},
		{name: "foreign origin", host: "localhost:8080", origin: "http://attacker.example", want: http.StatusForbidden},
		{name: "malformed origin", host: "localhost:8080", origin: "://bad", want: http.StatusForbidden},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "http://"+test.host+"/", nil)
			req.Host = test.host
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != test.want {
				t.Fatalf("status = %d, want %d", res.Code, test.want)
			}
		})
	}
}
