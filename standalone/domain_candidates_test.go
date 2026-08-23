package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/certnames"
)

type domainCandidatesSearcherFunc func(context.Context, string) (certnames.Result, error)

func (function domainCandidatesSearcherFunc) Search(ctx context.Context, host string) (certnames.Result, error) {
	return function(ctx, host)
}

func TestDomainCandidatesHandlerRequiresPostAndCSRFFirst(t *testing.T) {
	var calls atomic.Int32
	searcher := domainCandidatesSearcherFunc(func(context.Context, string) (certnames.Result, error) {
		calls.Add(1)
		return certnames.Result{}, nil
	})
	handler := DomainCandidatesHandler(searcher)

	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, httptest.NewRequest(http.MethodGet, "/api/domain/candidates", nil))
	if getResponse.Code != http.StatusMethodNotAllowed || getResponse.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("GET status = %d, Allow = %q", getResponse.Code, getResponse.Header().Get("Allow"))
	}

	unread := &domainCandidatesUnreadBody{}
	csrfResponse := httptest.NewRecorder()
	csrfRequest := httptest.NewRequest(http.MethodPost, "/api/domain/candidates", unread)
	handler.ServeHTTP(csrfResponse, csrfRequest)
	if csrfResponse.Code != http.StatusUnauthorized || unread.reads.Load() != 0 {
		t.Fatalf("CSRF status = %d, body reads = %d", csrfResponse.Code, unread.reads.Load())
	}
	if calls.Load() != 0 {
		t.Fatalf("search calls = %d before validation", calls.Load())
	}
	if csrfResponse.Header().Get("Cache-Control") != "no-store" || csrfResponse.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", csrfResponse.Header())
	}

	validRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/domain/candidates",
		strings.NewReader(`{"host":"example.com","acknowledgeThirdParty":true}`),
	)
	validRequest.Header.Set("Content-Type", "application/json")
	validRequest.Header.Set(csrfHeaderName, "domain-candidate-token")
	validRequest.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "domain-candidate-token"})
	validResponse := httptest.NewRecorder()
	handler.ServeHTTP(validResponse, validRequest)
	if validResponse.Code != http.StatusOK || calls.Load() != 1 {
		t.Fatalf("valid status = %d, search calls = %d, body = %q", validResponse.Code, calls.Load(), validResponse.Body.String())
	}
}

func TestDomainCandidatesOperationRequiresExplicitDisclosureAcknowledgement(t *testing.T) {
	var calls atomic.Int32
	operation := DomainCandidatesOperationHandler(domainCandidatesSearcherFunc(func(context.Context, string) (certnames.Result, error) {
		calls.Add(1)
		return certnames.Result{}, nil
	}))

	response := performDomainCandidatesOperation(operation, `{"host":"example.com"}`, "application/json")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "acknowledgeThirdParty must be true") {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if calls.Load() != 0 {
		t.Fatalf("search calls = %d without acknowledgement", calls.Load())
	}
}

func TestDomainCandidatesOperationReturnsPassiveProviderEvidence(t *testing.T) {
	observedAt := time.Date(2026, time.August, 23, 9, 0, 0, 0, time.UTC)
	var receivedHost string
	operation := DomainCandidatesOperationHandler(domainCandidatesSearcherFunc(func(_ context.Context, host string) (certnames.Result, error) {
		receivedHost = host
		return certnames.Result{
			Apex:       "example.com",
			Source:     "https://crt.name/v1/search?apex=example.com",
			ObservedAt: observedAt,
			Candidates: []certnames.Candidate{{Name: "*.api.example.com", Wildcard: true}},
		}, nil
	}))

	response := performDomainCandidatesOperation(
		operation,
		`{"host":"  www.example.com  ","acknowledgeThirdParty":true}`,
		"application/json; charset=utf-8",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if receivedHost != "www.example.com" {
		t.Fatalf("search host = %q", receivedHost)
	}
	var result certnames.Result
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Apex != "example.com" || result.Source == "" || !result.ObservedAt.Equal(observedAt) || len(result.Candidates) != 1 {
		t.Fatalf("result = %#v", result)
	}
	if response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
}

func TestDomainCandidatesOperationBoundsAndValidatesEnvelope(t *testing.T) {
	operation := DomainCandidatesOperationHandler(domainCandidatesSearcherFunc(func(context.Context, string) (certnames.Result, error) {
		return certnames.Result{}, nil
	}))
	tests := []struct {
		name        string
		body        string
		contentType string
		status      int
	}{
		{name: "content type", body: `{}`, contentType: "text/plain", status: http.StatusUnsupportedMediaType},
		{name: "invalid JSON", body: `{`, contentType: "application/json", status: http.StatusBadRequest},
		{name: "empty host", body: `{"host":" ","acknowledgeThirdParty":true}`, contentType: "application/json", status: http.StatusBadRequest},
		{name: "long host", body: `{"host":"` + strings.Repeat("a", maxDomainCandidateHostBytes+1) + `","acknowledgeThirdParty":true}`, contentType: "application/json", status: http.StatusBadRequest},
		{name: "body limit", body: `{"host":"` + strings.Repeat("a", maxDomainCandidatesBodyBytes) + `","acknowledgeThirdParty":true}`, contentType: "application/json", status: http.StatusRequestEntityTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := performDomainCandidatesOperation(operation, test.body, test.contentType)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d, body = %q", response.Code, test.status, response.Body.String())
			}
		})
	}
}

func TestDomainCandidatesOperationMapsErrorsExactly(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		status     int
		body       string
		retryAfter string
	}{
		{name: "cancelled", err: context.Canceled, status: 499, body: "Certificate-name lookup cancelled\n"},
		{name: "deadline", err: context.DeadlineExceeded, status: http.StatusGatewayTimeout, body: "Certificate-name lookup timed out\n"},
		{name: "invalid apex", err: certnames.ErrInvalidApex, status: http.StatusBadRequest, body: "Host must contain a valid registrable domain\n"},
		{name: "busy", err: certnames.ErrProviderBusy, status: http.StatusTooManyRequests, body: "Certificate-name provider is busy; retry shortly\n", retryAfter: "1"},
		{name: "response too large", err: certnames.ErrResponseTooLarge, status: http.StatusBadGateway, body: "Certificate-name provider response exceeded the safety limit\n"},
		{name: "provider failure", err: errors.New("private provider detail"), status: http.StatusBadGateway, body: "Certificate-name lookup failed\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			operation := DomainCandidatesOperationHandler(domainCandidatesSearcherFunc(func(context.Context, string) (certnames.Result, error) {
				return certnames.Result{}, errors.Join(errors.New("wrapped"), test.err)
			}))
			response := performDomainCandidatesOperation(operation, `{"host":"example.com","acknowledgeThirdParty":true}`, "application/json")
			if response.Code != test.status || response.Body.String() != test.body || response.Header().Get("Retry-After") != test.retryAfter {
				t.Fatalf("response = status %d, body %q, Retry-After %q", response.Code, response.Body.String(), response.Header().Get("Retry-After"))
			}
		})
	}
}

func TestDomainCandidatesOperationHandlesUnavailableDependency(t *testing.T) {
	response := performDomainCandidatesOperation(
		DomainCandidatesOperationHandler(nil),
		`{"host":"example.com","acknowledgeThirdParty":true}`,
		"application/json",
	)
	if response.Code != http.StatusServiceUnavailable || response.Body.String() != "Certificate-name lookup is unavailable\n" {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
}

func performDomainCandidatesOperation(handler http.Handler, body, contentType string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/domain/candidates", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

type domainCandidatesUnreadBody struct {
	reads atomic.Int32
}

func (body *domainCandidatesUnreadBody) Read([]byte) (int, error) {
	body.reads.Add(1)
	return 0, io.EOF
}

func (body *domainCandidatesUnreadBody) Close() error { return nil }
