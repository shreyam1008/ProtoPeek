package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTailnetFailedHTTPActionsPreserveConflictAndObservedState(t *testing.T) {
	for _, test := range []struct {
		name       string
		failure    bool
		unobserved bool
		want       int
	}{{"completed", false, false, 200}, {"failed", true, false, 409}, {"failed-unobserved", true, true, 409}} {
		t.Run(test.name, func(t *testing.T) {
			state := "Running"
			service := &tailnet.Service{Find: func() (string, error) { return "fixture-client", nil }, Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
				switch strings.Join(args, " ") {
				case "status --json":
					if test.unobserved && state == "Stopped" {
						return nil, errors.New("native daemon unavailable https://auth.test/sentinel-key")
					}
					return []byte(`{"Version":"1.fixture","BackendState":"` + state + `","Peer":{}}`), nil
				case "switch --list --json":
					return []byte(`[]`), nil
				case "down":
					state = "Stopped"
					if test.failure {
						return nil, errors.New("permission denied https://auth.test/sentinel-key")
					}
					return nil, nil
				}
				return nil, errors.New("unexpected command")
			}}
			snapshot, err := service.Inspect(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(tailnet.ActionRequest{Action: "disconnect", Revision: snapshot.Revision, Consent: true})
			request := httptest.NewRequest(http.MethodPost, "http://localhost/api/tailnet/action", bytes.NewReader(body))
			request.RemoteAddr = "127.0.0.1:1234"
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "fixture"})
			request.Header.Set(csrfHeaderName, "fixture")
			mux := http.NewServeMux()
			registerTailnetService(mux, service)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			var result tailnet.ActionResult
			if response.Code != test.want || json.Unmarshal(response.Body.Bytes(), &result) != nil {
				t.Fatalf("status/state=%d %s", response.Code, response.Body.String())
			}
			if test.unobserved {
				if result.Snapshot != nil {
					t.Fatalf("failed observation invented a snapshot: %+v", result)
				}
			} else if result.Snapshot == nil || result.Snapshot.State != "Stopped" {
				t.Fatalf("observed state lost: %+v", result)
			}
			if test.failure && (result.Outcome != "failed" || !strings.Contains(result.Output, "permission restriction")) {
				t.Fatalf("failure was reported as success: %+v", result)
			}
			if strings.Contains(response.Body.String(), "sentinel-key") {
				t.Fatal("native secret escaped")
			}
		})
	}
}

func TestTailnetEarlyRefusalsUseSafeDomainGuidance(t *testing.T) {
	for _, test := range []struct {
		name, path, revision   string
		consent, nativeFailure bool
		want                   int
	}{
		{"missing-consent", "/api/tailnet/action", "current", false, false, 409},
		{"stale-revision", "/api/tailnet/action", "stale", true, false, 409},
		{"inspect-native-error", "/api/tailnet/inspect", "", false, true, 502},
		{"action-native-error", "/api/tailnet/action", "current", true, true, 409},
	} {
		t.Run(test.name, func(t *testing.T) {
			actions := 0
			service := &tailnet.Service{Find: func() (string, error) { return "fixture-client", nil }, Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
				if args[0] == "status" {
					if test.nativeFailure {
						return nil, errors.New("permission denied https://auth.test/sentinel-key")
					}
					return []byte(`{"Version":"1.fixture","BackendState":"Running","Peer":{}}`), nil
				}
				if args[0] == "switch" {
					return []byte(`[]`), nil
				}
				actions++
				return nil, errors.New("unexpected native action")
			}}
			body := ""
			if strings.HasSuffix(test.path, "/action") {
				encoded, _ := json.Marshal(tailnet.ActionRequest{Action: "disconnect", Revision: test.revision, Consent: test.consent})
				body = string(encoded)
			}
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(body))
			request.RemoteAddr = "127.0.0.1:1234"
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "fixture"})
			request.Header.Set(csrfHeaderName, "fixture")
			mux := http.NewServeMux()
			registerTailnetService(mux, service)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			text := response.Body.String()
			if response.Code != test.want || actions != 0 || !strings.Contains(text, "Tailscale") || strings.Contains(text, "Transfer") || strings.Contains(text, "downloader") || strings.Contains(text, "sentinel-key") {
				t.Fatalf("unsafe or misleading refusal: %d %q, actions=%d", response.Code, text, actions)
			}
			if test.want == 502 && !strings.Contains(text, "daemon and permissions") {
				t.Fatal(text)
			}
			if test.want == 409 && !strings.Contains(text, "not started") {
				t.Fatal(text)
			}
		})
	}
}
