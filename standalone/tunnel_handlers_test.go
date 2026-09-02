package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/tunnels"
)

type fakeTunnelService struct {
	capabilities tunnels.Capabilities
	snapshot     tunnels.Snapshot
	release      tunnels.Release
	action       tunnels.ServiceActionResponse
}

func admittedTunnelRequest(method, route string, body []byte) *http.Request {
	request := httptest.NewRequest(method, route, bytes.NewReader(body))
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "tunnel-test-token"})
	request.Header.Set(csrfHeaderName, "tunnel-test-token")
	return request
}

func (service *fakeTunnelService) Capabilities(context.Context) tunnels.Capabilities {
	return service.capabilities
}

func (service *fakeTunnelService) Snapshot(context.Context) (tunnels.Snapshot, error) {
	return service.snapshot, nil
}

func (service *fakeTunnelService) LatestRelease(context.Context) (tunnels.Release, error) {
	return service.release, nil
}

func (service *fakeTunnelService) ServiceAction(_ context.Context, request tunnels.ServiceActionRequest) (tunnels.ServiceActionResponse, error) {
	result := service.action
	result.Action = request.Action
	return result, nil
}

func newFakeTunnelService() *fakeTunnelService {
	return &fakeTunnelService{
		capabilities: tunnels.Capabilities{SchemaVersion: tunnels.SchemaVersion, Scope: tunnels.Scope},
		snapshot:     tunnels.Snapshot{SchemaVersion: tunnels.SchemaVersion, Scope: tunnels.Scope, Status: "ok", ObservedAt: time.Now(), ConfigSources: []tunnels.ConfigSource{}, Deployments: []tunnels.Deployment{}, Notes: []string{}},
		release:      tunnels.Release{SchemaVersion: tunnels.SchemaVersion, Status: "current", SupportStatus: "supported", CheckedAt: time.Now()},
		action:       tunnels.ServiceActionResponse{SchemaVersion: tunnels.SchemaVersion, Status: "completed", ObservedAt: time.Now()},
	}
}

func TestTunnelRoutesAreAbsentWithoutExplicitLocalService(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	for _, route := range []string{"/api/tunnels/capabilities", "/api/tunnels/snapshot", "/api/tunnels/release", "/api/tunnels/service-action"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d", route, response.Code)
		}
	}
}

func TestTunnelCapabilitiesAreVersionedNoStoreJSON(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil, WithTunnelService(newFakeTunnelService()))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/tunnels/capabilities", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status=%d headers=%v", response.Code, response.Header())
	}
	var value struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil || value.SchemaVersion != tunnels.SchemaVersion {
		t.Fatalf("body=%s err=%v", response.Body.String(), err)
	}
}

func TestTunnelSnapshotRequiresPostAndCSRF(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil, WithTunnelService(newFakeTunnelService()))

	wrongMethod := httptest.NewRecorder()
	handler.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodGet, "/api/tunnels/snapshot", nil))
	if wrongMethod.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status=%d", wrongMethod.Code)
	}

	missingToken := httptest.NewRecorder()
	handler.ServeHTTP(missingToken, httptest.NewRequest(http.MethodPost, "/api/tunnels/snapshot", nil))
	if missingToken.Code != http.StatusUnauthorized {
		t.Fatalf("missing CSRF status=%d", missingToken.Code)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/tunnels/snapshot", nil)
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "tunnel-test-token"})
	request.Header.Set(csrfHeaderName, "tunnel-test-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
}

func TestTunnelReleaseIsExplicitBodylessPost(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil, WithTunnelService(newFakeTunnelService()))

	request := admittedTunnelRequest(http.MethodPost, "/api/tunnels/release", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"current"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	withBody := admittedTunnelRequest(http.MethodPost, "/api/tunnels/release", []byte(`{}`))
	rejected := httptest.NewRecorder()
	handler.ServeHTTP(rejected, withBody)
	if rejected.Code != http.StatusBadRequest || !strings.Contains(rejected.Body.String(), "must be empty") {
		t.Fatalf("status=%d body=%s", rejected.Code, rejected.Body.String())
	}
}

func TestTunnelServiceActionRequiresStrictBoundedJSON(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil, WithTunnelService(newFakeTunnelService()))
	tests := []struct {
		name        string
		body        []byte
		contentType string
		status      int
	}{
		{name: "missing content type", body: []byte(`{"action":"start","expectedState":"stopped","confirmed":true}`), status: http.StatusUnsupportedMediaType},
		{name: "unknown password", body: []byte(`{"action":"start","expectedState":"stopped","confirmed":true,"password":"invalid-secret"}`), contentType: "application/json", status: http.StatusBadRequest},
		{name: "unknown token", body: []byte(`{"action":"start","expectedState":"stopped","confirmed":true,"token":"invalid-token"}`), contentType: "application/json", status: http.StatusBadRequest},
		{name: "trailing value", body: []byte(`{"action":"start","expectedState":"stopped","confirmed":true} {}`), contentType: "application/json", status: http.StatusBadRequest},
		{name: "duplicate action", body: []byte(`{"action":"start","Action":"stop","expectedState":"stopped","confirmed":true}`), contentType: "application/json", status: http.StatusBadRequest},
		{name: "too large", body: bytes.Repeat([]byte("x"), maxTunnelActionRequestBytes+1), contentType: "application/json", status: http.StatusRequestEntityTooLarge},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := admittedTunnelRequest(http.MethodPost, "/api/tunnels/service-action", test.body)
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "invalid-secret") || strings.Contains(response.Body.String(), "invalid-token") {
				t.Fatalf("request secret reflected: %s", response.Body.String())
			}
		})
	}
}

func TestTunnelServiceActionKeepsLogicalOutcomeParseable(t *testing.T) {
	t.Parallel()
	service := newFakeTunnelService()
	service.action.Status = "elevation-required"
	service.action.ElevationRequired = true
	service.action.ElevationMechanism = "Windows UAC"
	service.action.ManualCommand = "Start-Service -Name Cloudflared"
	handler := Handler(nil, "", nil, nil, WithTunnelService(service))
	request := admittedTunnelRequest(http.MethodPost, "/api/tunnels/service-action", []byte(`{"action":"start","expectedState":"stopped","confirmed":true}`))
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"elevation-required"`) || !strings.Contains(response.Body.String(), `"elevationRequired":true`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
