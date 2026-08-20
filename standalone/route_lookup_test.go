package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

type routeResolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (function routeResolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return function(ctx, network, host)
}

func TestRouteLookupHandlerResolvesCapsAndPreservesPerAddressFailure(t *testing.T) {
	t.Parallel()
	resolved := make([]netip.Addr, 0, 10)
	for index := 1; index <= 10; index++ {
		resolved = append(resolved, netip.MustParseAddr("192.0.2."+strconv.Itoa(index)))
	}
	resolver := routeResolverFunc(func(_ context.Context, network, host string) ([]netip.Addr, error) {
		if network != "ip" || host != "example.test" {
			t.Fatalf("lookup = %q %q", network, host)
		}
		return resolved, nil
	})
	var active atomic.Int32
	var maximum atomic.Int32
	lookup := func(_ context.Context, address netip.Addr) netroute.Result {
		current := active.Add(1)
		defer active.Add(-1)
		for current > maximum.Load() && !maximum.CompareAndSwap(maximum.Load(), current) {
		}
		time.Sleep(5 * time.Millisecond)
		status := "ok"
		errorMessage := ""
		if address == resolved[2] {
			status = "error"
			errorMessage = "fixture route failure"
		}
		return netroute.Result{Destination: address.String(), Family: "ipv4", Status: status, Backend: "fixture", Notes: []string{}, Error: errorMessage}
	}

	response := performRouteLookup(t, routeLookupHandler(resolver, lookup), `{"destination":"example.test","family":"auto"}`, "application/json")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload RouteLookupResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Perspective != "protopeek-process" || payload.ObservedAt == "" || len(payload.Results) != maxRouteAddresses {
		t.Fatalf("response = %#v", payload)
	}
	if payload.Results[2].Status != "error" || payload.Results[2].Error == "" {
		t.Fatalf("per-address failure = %#v", payload.Results[2])
	}
	if maximum.Load() > maxConcurrentRoutes {
		t.Fatalf("maximum concurrency = %d", maximum.Load())
	}
}

func TestRouteLookupValidationAndResolverErrors(t *testing.T) {
	t.Parallel()
	resolver := routeResolverFunc(func(_ context.Context, _, _ string) ([]netip.Addr, error) {
		return nil, errors.New("fixture DNS failure")
	})
	handler := routeLookupHandler(resolver, netroute.Lookup)

	for _, test := range []struct {
		name   string
		body   string
		status int
	}{
		{name: "unspecified", body: `{"destination":"0.0.0.0"}`, status: http.StatusBadRequest},
		{name: "multicast", body: `{"destination":"224.0.0.1"}`, status: http.StatusBadRequest},
		{name: "broadcast", body: `{"destination":"255.255.255.255"}`, status: http.StatusBadRequest},
		{name: "unzoned link local", body: `{"destination":"fe80::1"}`, status: http.StatusBadRequest},
		{name: "family mismatch", body: `{"destination":"127.0.0.1","family":"ipv6"}`, status: http.StatusBadRequest},
		{name: "invalid family", body: `{"destination":"localhost","family":"any"}`, status: http.StatusBadRequest},
		{name: "destination length", body: `{"destination":"` + strings.Repeat("a", maxRouteDestination+1) + `"}`, status: http.StatusBadRequest},
		{name: "resolver failure", body: `{"destination":"example.test"}`, status: http.StatusBadGateway},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			response := performRouteLookup(t, handler, test.body, "application/json")
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d, body = %q", response.Code, test.status, response.Body.String())
			}
		})
	}
}

func TestRouteLookupHandlerMethodContentTypeBodyAndCancellation(t *testing.T) {
	t.Parallel()
	handler := routeLookupHandler(routeResolverFunc(func(ctx context.Context, _, _ string) ([]netip.Addr, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}), netroute.Lookup)

	method := httptest.NewRecorder()
	handler.ServeHTTP(method, httptest.NewRequest(http.MethodGet, "/api/route/lookup", nil))
	if method.Code != http.StatusMethodNotAllowed || method.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("method status = %d, Allow = %q", method.Code, method.Header().Get("Allow"))
	}
	if method.Header().Get("Cache-Control") != "no-store" || method.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", method.Header())
	}
	wrongType := performRouteLookup(t, handler, `{}`, "text/plain")
	if wrongType.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content-type status = %d", wrongType.Code)
	}
	oversized := performRouteLookup(t, handler, `{"destination":"`+strings.Repeat("x", maxRouteLookupBodyBytes)+`"}`, "application/json")
	if oversized.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d", oversized.Code)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodPost, "/api/route/lookup", bytes.NewBufferString(`{"destination":"example.test"}`)).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	cancelled := httptest.NewRecorder()
	handler.ServeHTTP(cancelled, request)
	if cancelled.Code != 499 {
		t.Fatalf("cancelled status = %d, body = %q", cancelled.Code, cancelled.Body.String())
	}
}

func TestLookupRoutesStopsDispatchAfterCancellation(t *testing.T) {
	t.Parallel()
	addresses := make([]netip.Addr, 0, maxRouteAddresses)
	for index := 1; index <= maxRouteAddresses; index++ {
		addresses = append(addresses, netip.MustParseAddr("192.0.2."+strconv.Itoa(index)))
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls atomic.Int32
	lookup := func(ctx context.Context, address netip.Addr) netroute.Result {
		if calls.Add(1) == 1 {
			cancel()
		}
		<-ctx.Done()
		return cancelledRouteResult(address, ctx.Err())
	}
	results := lookupRoutes(ctx, addresses, lookup)
	if len(results) != len(addresses) {
		t.Fatalf("results = %d, want %d", len(results), len(addresses))
	}
	if calls.Load() > maxConcurrentRoutes {
		t.Fatalf("lookups started after cancellation: %d", calls.Load())
	}
	for _, result := range results {
		if result.Status != "error" || result.Error == "" {
			t.Fatalf("cancelled result = %#v", result)
		}
	}
}

func TestRouteLookupRejectsPreCancelledLiteralWithoutPlatformLookup(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	handler := routeLookupHandler(net.DefaultResolver, func(_ context.Context, address netip.Addr) netroute.Result {
		calls.Add(1)
		return netroute.Result{Destination: address.String(), Status: "ok", Notes: []string{}}
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/route/lookup",
		bytes.NewBufferString(`{"destination":"127.0.0.1"}`),
	).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 499 {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if calls.Load() != 0 {
		t.Fatalf("platform lookups = %d", calls.Load())
	}
}

func performRouteLookup(t *testing.T, handler http.Handler, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/route/lookup", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
