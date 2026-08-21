package standalone

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
)

func TestHandlerServesNetworkCapabilitiesWithoutCSRF(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/network/capabilities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload NetworkDiscoveryCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Perspective != "protopeek-process" || payload.ActiveProbe || len(payload.Profiles) != 4 {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Limits.MinimumPrefix != 24 || payload.Limits.MaxAttempts != 4572 {
		t.Fatalf("limits = %#v", payload.Limits)
	}
}

func TestHandlerProtectsNetworkDiscoveryBeforeReadingOrValidatingBody(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	wrongMethodBody := &admissionUnreadBody{}
	wrongMethod := httptest.NewRecorder()
	handler.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodGet, "/api/network/discover", wrongMethodBody))
	if wrongMethod.Code != http.StatusMethodNotAllowed || wrongMethod.Header().Get("Allow") != http.MethodPost || wrongMethodBody.reads.Load() != 0 {
		t.Fatalf("wrong-method status = %d, Allow = %q, body reads = %d", wrongMethod.Code, wrongMethod.Header().Get("Allow"), wrongMethodBody.reads.Load())
	}

	unread := &admissionUnreadBody{}
	missingCSRF := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/network/discover", unread)
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(missingCSRF, request)
	if missingCSRF.Code != http.StatusUnauthorized || unread.reads.Load() != 0 {
		t.Fatalf("missing-CSRF status = %d, body reads = %d", missingCSRF.Code, unread.reads.Load())
	}

	cookie := workspaceUploadCSRFCookie(t, handler)
	wrongMedia := admissionRequest(cookie, http.MethodPost, "/api/network/discover", "text/plain", strings.NewReader(`{}`))
	wrongMediaResponse := performAdmissionRequest(handler, wrongMedia)
	if wrongMediaResponse.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("wrong-media status = %d, body = %q", wrongMediaResponse.Code, wrongMediaResponse.Body.String())
	}

	invalid := admissionRequest(cookie, http.MethodPost, "/api/network/discover", "application/json", strings.NewReader(`{}`))
	invalidResponse := performAdmissionRequest(handler, invalid)
	if invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, body = %q", invalidResponse.Code, invalidResponse.Body.String())
	}
}

func TestNetworkDiscoveryAdmissionRejectsConcurrentJobBeforeReadingBody(t *testing.T) {
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	handler := networkDiscoveryHandler(func(ctx context.Context, _ netip.Addr, _ uint16) ScanResult {
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return ScanResult{}
	})

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		request := httptest.NewRequest(http.MethodPost, "/api/network/discover", strings.NewReader(`{"cidr":"192.168.1.9/32","profile":"quick","consent":true}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		done <- response
	}()
	for range 4 {
		waitAdmissionSignal(t, started, "network discovery probe")
	}

	unread := &admissionUnreadBody{}
	busy := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/network/discover", unread)
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(busy, request)
	if busy.Code != http.StatusServiceUnavailable || busy.Header().Get("Retry-After") != "1" || unread.reads.Load() != 0 {
		t.Fatalf("busy status = %d, Retry-After = %q, body reads = %d", busy.Code, busy.Header().Get("Retry-After"), unread.reads.Load())
	}

	releaseOnce.Do(func() { close(release) })
	first := waitAdmissionResponse(t, done, "network discovery")
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, body = %q", first.Code, first.Body.String())
	}
	afterRelease := performNetworkDiscovery(t, handler, `{}`)
	if afterRelease.Code != http.StatusBadRequest {
		t.Fatalf("post-release status = %d, body = %q", afterRelease.Code, afterRelease.Body.String())
	}
}
