package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/netpath"
)

type pathServiceFunc struct {
	capabilities func(context.Context) netpath.CapabilitiesResponse
	trace        func(context.Context, netpath.Request) (netpath.Response, error)
}

func (service pathServiceFunc) Capabilities(ctx context.Context) netpath.CapabilitiesResponse {
	return service.capabilities(ctx)
}

func (service pathServiceFunc) Trace(ctx context.Context, request netpath.Request) (netpath.Response, error) {
	return service.trace(ctx, request)
}

func TestPathCapabilitiesHandlerReturnsTruthfulNoProbeContract(t *testing.T) {
	t.Parallel()
	traceCalls := 0
	service := pathServiceFunc{
		capabilities: func(context.Context) netpath.CapabilitiesResponse {
			return netpath.CapabilitiesResponse{
				Perspective: "protopeek-process",
				OS:          "fixture-os",
				Capabilities: []netpath.Capability{{
					Backend:     "fixture-native",
					Method:      "udp",
					Families:    []string{"ipv4"},
					Available:   true,
					Privilege:   "none",
					Install:     "built-in",
					Limitations: []string{},
				}},
				Limits:   netpath.FixedLimits(),
				Warnings: []string{},
			}
		},
		trace: func(context.Context, netpath.Request) (netpath.Response, error) {
			traceCalls++
			return netpath.Response{}, nil
		},
	}

	handler := pathCapabilitiesHandler(service)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/path/capabilities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", response.Header())
	}
	if got := response.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	var payload netpath.CapabilitiesResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.OS != "fixture-os" || len(payload.Capabilities) != 1 || !payload.Capabilities[0].Available {
		t.Fatalf("payload = %#v", payload)
	}
	if traceCalls != 0 {
		t.Fatalf("GET capabilities sent %d traces", traceCalls)
	}

	wrongMethod := httptest.NewRecorder()
	handler.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodPost, "/api/path/capabilities", bytes.NewBufferString(`{}`)))
	if wrongMethod.Code != http.StatusMethodNotAllowed || wrongMethod.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("wrong-method status = %d, Allow = %q", wrongMethod.Code, wrongMethod.Header().Get("Allow"))
	}
}

func TestPathTraceHandlerReturnsBoundedJSONObservation(t *testing.T) {
	t.Parallel()
	service := pathServiceFunc{
		capabilities: func(context.Context) netpath.CapabilitiesResponse {
			return netpath.CapabilitiesResponse{}
		},
		trace: func(_ context.Context, request netpath.Request) (netpath.Response, error) {
			if request.Destination != "service.example" || !request.Consent.ActiveProbe || !request.Consent.PublicTarget {
				t.Fatalf("request = %#v", request)
			}
			return netpath.Response{
				Perspective: "protopeek-process",
				Status:      "complete",
				Termination: "reached",
				Reached:     true,
				Backend:     "fixture-native",
				Method:      "udp",
				Hops:        []netpath.Hop{},
				Warnings:    []string{},
			}, nil
		},
	}

	handler := pathTraceHandler(service)
	request := httptest.NewRequest(http.MethodPost, "/api/path/trace", bytes.NewBufferString(
		`{"destination":"service.example","consent":{"activeProbe":true,"publicTarget":true}}`,
	))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", response.Header())
	}
	var payload netpath.Response
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Reached || payload.Backend != "fixture-native" || payload.Method != "udp" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestPathTraceHandlerMapsPublicEngineErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "invalid", err: fmt.Errorf("detail: %w", netpath.ErrInvalidRequest), status: http.StatusBadRequest},
		{name: "consent", err: fmt.Errorf("detail: %w", netpath.ErrConsentRequired), status: http.StatusForbidden},
		{name: "unsupported", err: fmt.Errorf("detail: %w", netpath.ErrUnsupported), status: http.StatusNotImplemented},
		{name: "resolution", err: fmt.Errorf("detail: %w", netpath.ErrResolve), status: http.StatusBadGateway},
		{name: "cancelled", err: context.Canceled, status: 499},
		{name: "deadline", err: context.DeadlineExceeded, status: http.StatusGatewayTimeout},
		{name: "backend", err: errors.New("fixture backend failure"), status: http.StatusServiceUnavailable},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := pathServiceFunc{
				capabilities: func(context.Context) netpath.CapabilitiesResponse { return netpath.CapabilitiesResponse{} },
				trace: func(context.Context, netpath.Request) (netpath.Response, error) {
					return netpath.Response{}, test.err
				},
			}
			handler := pathTraceHandler(service)
			request := httptest.NewRequest(http.MethodPost, "/api/path/trace", bytes.NewBufferString(
				`{"destination":"127.0.0.1","consent":{"activeProbe":true}}`,
			))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d, body = %q", response.Code, test.status, response.Body.String())
			}
		})
	}
}

func TestPathTraceHandlerRejectsMethodMediaTypeAndOversizedBodyBeforeTracing(t *testing.T) {
	t.Parallel()
	var traceCalls atomic.Int32
	service := pathServiceFunc{
		capabilities: func(context.Context) netpath.CapabilitiesResponse { return netpath.CapabilitiesResponse{} },
		trace: func(context.Context, netpath.Request) (netpath.Response, error) {
			traceCalls.Add(1)
			return netpath.Response{}, nil
		},
	}
	handler := pathTraceHandler(service)
	tests := []struct {
		name        string
		method      string
		contentType string
		body        string
		status      int
	}{
		{name: "method", method: http.MethodGet, status: http.StatusMethodNotAllowed},
		{name: "media type", method: http.MethodPost, contentType: "text/plain", body: `{}`, status: http.StatusUnsupportedMediaType},
		{name: "malformed JSON", method: http.MethodPost, contentType: "application/json", body: `{`, status: http.StatusBadRequest},
		{name: "oversized", method: http.MethodPost, contentType: "application/json", body: strings.Repeat("x", maxPathTraceBodyBytes+1), status: http.StatusRequestEntityTooLarge},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, "/api/path/trace", strings.NewReader(test.body))
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d, body = %q", response.Code, test.status, response.Body.String())
			}
		})
	}
	if traceCalls.Load() != 0 {
		t.Fatalf("invalid requests triggered %d traces", traceCalls.Load())
	}
}

func TestHandlerWiresPathEndpointsAndProtectsActiveTrace(t *testing.T) {
	t.Parallel()
	var capabilityCalls atomic.Int32
	var traceCalls atomic.Int32
	handler := Handler(nil, "", nil, nil, optFunc(func(options *handlerOptions) {
		options.pathCapabilitiesHandler = http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			capabilityCalls.Add(1)
			writer.WriteHeader(http.StatusNoContent)
		})
		options.pathTraceHandler = http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			traceCalls.Add(1)
			writer.WriteHeader(http.StatusNoContent)
		})
	}))

	capabilities := httptest.NewRecorder()
	handler.ServeHTTP(capabilities, httptest.NewRequest(http.MethodGet, "/api/path/capabilities", nil))
	if capabilities.Code != http.StatusNoContent || capabilityCalls.Load() != 1 {
		t.Fatalf("capabilities status = %d, calls = %d", capabilities.Code, capabilityCalls.Load())
	}

	missingCSRF := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/path/trace", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(missingCSRF, request)
	if missingCSRF.Code != http.StatusUnauthorized || traceCalls.Load() != 0 {
		t.Fatalf("missing-CSRF status = %d, trace calls = %d", missingCSRF.Code, traceCalls.Load())
	}

	cookie := workspaceUploadCSRFCookie(t, handler)
	valid := admissionRequest(cookie, http.MethodPost, "/api/path/trace", "application/json", strings.NewReader(`{}`))
	response := performAdmissionRequest(handler, valid)
	if response.Code != http.StatusNoContent || traceCalls.Load() != 1 {
		t.Fatalf("valid status = %d, trace calls = %d", response.Code, traceCalls.Load())
	}
}

func TestHandlerDefaultPathCapabilitiesExposeFixedLimitsWithoutCSRF(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/path/capabilities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload netpath.CapabilitiesResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Perspective != "protopeek-process" || payload.OS == "" || len(payload.Capabilities) != 3 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Limits.MaxHops != 32 || payload.Limits.MaxTotalProbes != 96 || payload.Limits.MaxProbesPerSecond != 20 {
		t.Fatalf("limits = %#v", payload.Limits)
	}
	for _, capability := range payload.Capabilities {
		if capability.Method == "" || capability.Backend == "" || capability.Privilege == "" || capability.Install == "" || capability.Families == nil || capability.Limitations == nil {
			t.Fatalf("capability = %#v", capability)
		}
	}
}

func TestHandlerRejectsSaturatedPathTraceBeforeReadingBody(t *testing.T) {
	started := make(chan struct{}, maxConcurrentPathTraces+1)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	handler := Handler(nil, "", nil, nil, optFunc(func(options *handlerOptions) {
		options.pathTraceHandler = http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			started <- struct{}{}
			select {
			case <-release:
				writer.WriteHeader(http.StatusNoContent)
			case <-request.Context().Done():
			}
		})
	}))
	cookie := workspaceUploadCSRFCookie(t, handler)
	holders := startAdmissionRequests(handler, cookie, "/api/path/trace", `{}`, maxConcurrentPathTraces)
	for range maxConcurrentPathTraces {
		waitAdmissionSignal(t, started, "held path trace")
	}

	assertAdmissionPolicyPrecedesCapacity(t, handler, cookie, "/api/path/trace")
	unread := &admissionUnreadBody{}
	busy := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/path/trace", "application/json", unread))
	assertAdmissionBusy(t, busy, unread, "path trace")

	releaseOnce.Do(func() { close(release) })
	assertAdmissionResponses(t, holders, maxConcurrentPathTraces, http.StatusNoContent)
	afterRelease := performAdmissionRequest(handler, admissionRequest(cookie, http.MethodPost, "/api/path/trace", "application/json", strings.NewReader(`{}`)))
	if afterRelease.Code != http.StatusNoContent {
		t.Fatalf("post-release status = %d, body = %q", afterRelease.Code, afterRelease.Body.String())
	}
}
