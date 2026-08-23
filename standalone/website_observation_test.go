package standalone

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"github.com/shreyam1008/ProtoPeek/internal/webobserve"
)

type websiteObserverFunc func(context.Context, string) (webobserve.Result, error)

func (function websiteObserverFunc) Observe(ctx context.Context, target string) (webobserve.Result, error) {
	return function(ctx, target)
}

func TestWebsiteObservationRequiresConsentBeforeCallingObserver(t *testing.T) {
	t.Parallel()
	called := false
	handler := WebsiteObservationOperationHandler(websiteObserverFunc(func(context.Context, string) (webobserve.Result, error) {
		called = true
		return webobserve.Result{}, nil
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/security/web", strings.NewReader(`{"url":"https://example.com"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || called {
		t.Fatalf("status = %d, called = %v", response.Code, called)
	}
}

func TestWebsiteObservationReturnsBoundedEvidence(t *testing.T) {
	t.Parallel()
	want := webobserve.Result{
		ObservedAt: time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC),
		URL:        "https://example.com/",
		Method:     http.MethodHead,
		HTTP:       webobserve.HTTPEvidence{StatusCode: http.StatusOK, Status: "200 OK"},
	}
	handler := WebsiteObservationOperationHandler(websiteObserverFunc(func(_ context.Context, target string) (webobserve.Result, error) {
		if target != "https://example.com" {
			t.Fatalf("target = %q", target)
		}
		return want, nil
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/security/web", strings.NewReader(`{"url":"https://example.com","acknowledgePublicRequest":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"statusCode":200`) {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestWebsiteObservationMapsTargetPolicyErrorsWithoutLeakingDetails(t *testing.T) {
	t.Parallel()
	handler := WebsiteObservationOperationHandler(websiteObserverFunc(func(context.Context, string) (webobserve.Result, error) {
		return webobserve.Result{}, errors.Join(targetguard.ErrAddressBlocked, errors.New("10.0.0.8"))
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/security/web", strings.NewReader(`{"url":"https://private.example","acknowledgePublicRequest":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest ||
		strings.Contains(response.Body.String(), "10.0.0.8") ||
		!strings.Contains(response.Body.String(), "contain no credentials, query, or fragment") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestWebsiteObservationSelfContainedHandlerRequiresCSRFBeforeBody(t *testing.T) {
	t.Parallel()
	handler := WebsiteObservationHandler(websiteObserverFunc(func(context.Context, string) (webobserve.Result, error) {
		t.Fatal("observer should not be called")
		return webobserve.Result{}, nil
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/security/web", strings.NewReader(`{"url":"https://example.com","acknowledgePublicRequest":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}
