package standalone

import (
	"context"
	"errors"
	"github.com/shreyam1008/ProtoPeek/internal/netbird"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeNetBird struct {
	inspections, actions int
	last                 netbird.ActionRequest
}

func (service *fakeNetBird) Inspect(context.Context) (netbird.Snapshot, error) {
	service.inspections++
	return netbird.Snapshot{State: "Unavailable"}, nil
}
func (service *fakeNetBird) Execute(_ context.Context, input netbird.ActionRequest) (netbird.ActionResult, error) {
	service.actions++
	service.last = input
	return netbird.ActionResult{Outcome: "completed"}, nil
}

func TestNetBirdAdmissionAndStrictRequests(t *testing.T) {
	service := &fakeNetBird{}
	mux := http.NewServeMux()
	registerNetBird(mux, service)
	for _, tc := range []struct {
		method, path, body string
		csrf               bool
		want               int
	}{
		{"GET", "/api/netbird/inspect", "", true, 405},
		{"POST", "/api/netbird/inspect", "", false, 401},
		{"POST", "/api/netbird/inspect", `{}`, true, 400},
		{"POST", "/api/netbird/action", `{"action":"disconnect","revision":"observed","consent":true,"setupKey":"never"}`, true, 400},
		{"POST", "/api/netbird/action", strings.Repeat("x", 1025), true, 413},
	} {
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		if tc.csrf {
			request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "netbird-fixture"})
			request.Header.Set(csrfHeaderName, "netbird-fixture")
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != tc.want || service.actions != 0 || service.inspections != 0 {
			t.Fatalf("%s %s: status=%d calls=%+v body=%s", tc.method, tc.path, response.Code, service, response.Body.String())
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/netbird/action", strings.NewReader(`{"action":"disconnect","revision":"observed","consent":true}`))
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "netbird-fixture"})
	request.Header.Set(csrfHeaderName, "netbird-fixture")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != 200 || service.actions != 1 || service.last.Revision != "observed" || !service.last.Consent {
		t.Fatalf("action=%d %+v", response.Code, service)
	}
}

func TestNetBirdRoutesAbsentWithoutInjection(t *testing.T) {
	mux := http.NewServeMux()
	registerNetBird(mux, nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/netbird/inspect", nil))
	if response.Code != 404 {
		t.Fatal(response.Code)
	}
}

func TestNetBirdRejectsRemoteOrForwardedHostActions(t *testing.T) {
	service := &fakeNetBird{}
	mux := http.NewServeMux()
	registerNetBird(mux, service)
	for _, forwarded := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodPost, "/api/netbird/inspect", nil)
		request.RemoteAddr = "192.0.2.1:12345"
		if forwarded {
			request.RemoteAddr = "127.0.0.1:12345"
			request.Header.Set("X-Forwarded-For", "127.0.0.1")
		}
		request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "netbird-fixture"})
		request.Header.Set(csrfHeaderName, "netbird-fixture")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != 403 || service.inspections != 0 {
			t.Fatalf("remote=%d calls=%d", response.Code, service.inspections)
		}
	}
}

type failingNetBird struct{}

func (failingNetBird) Inspect(context.Context) (netbird.Snapshot, error) {
	return netbird.Snapshot{}, errors.New("native secret https://auth.test/sentinel-key")
}
func (failingNetBird) Execute(context.Context, netbird.ActionRequest) (netbird.ActionResult, error) {
	return netbird.ActionResult{}, errors.New("native secret https://auth.test/sentinel-key")
}

func TestNetBirdFailuresUseSafeDomainGuidanceWithoutInventingState(t *testing.T) {
	mux := http.NewServeMux()
	registerNetBird(mux, failingNetBird{})
	for _, test := range []struct {
		path, body string
		want       int
	}{
		{"/api/netbird/inspect", "", 502},
		{"/api/netbird/action", `{"action":"disconnect","revision":"stale","consent":true}`, 409},
	} {
		request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "fixture"})
		request.Header.Set(csrfHeaderName, "fixture")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		body := response.Body.String()
		if response.Code != test.want || !strings.Contains(body, "NetBird") || strings.Contains(body, "Transfer") || strings.Contains(body, "downloader") || strings.Contains(body, "sentinel-key") || strings.Contains(body, `"snapshot"`) {
			t.Fatalf("unsafe or misleading provider failure: %d %q", response.Code, body)
		}
		if test.want == 502 && !strings.Contains(body, "no daemon state was inferred") {
			t.Fatal(body)
		}
	}
}
