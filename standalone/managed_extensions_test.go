package standalone

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManagedExtensionInventoryReadAndGuards(t *testing.T) {
	mux := http.NewServeMux()
	registerManagedExtensions(mux)
	for _, tc := range []struct {
		query, peer, site string
		want              int
	}{
		{"", "127.0.0.1:1234", "same-origin", 200},
		{"?id=cloudflared", "127.0.0.1:1234", "", 200},
		{"?id=yt-dlp", "127.0.0.1:1234", "", 200},
		{"?id=gallery-dl", "127.0.0.1:1234", "", 200},
		{"?id=deno", "127.0.0.1:1234", "", 200},
		{"?id=ffmpeg", "127.0.0.1:1234", "", 200},
		{"?id=cloudflared&id=aria2", "127.0.0.1:1234", "", 400},
		{"?id=cloudflared&", "127.0.0.1:1234", "", 400},
		{"?id=unknown", "127.0.0.1:1234", "", 400},
		{"", "192.0.2.1:1234", "", 403},
		{"", "127.0.0.1:1234", "cross-site", 403},
	} {
		req := httptest.NewRequest(http.MethodGet, "http://localhost/api/extensions/managed"+tc.query, nil)
		req.RemoteAddr = tc.peer
		req.Header.Set("Sec-Fetch-Site", tc.site)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != tc.want {
			t.Errorf("query %q peer %q site %q: got %d, want %d", tc.query, tc.peer, tc.site, response.Code, tc.want)
		}
		if tc.want == 200 && !json.Valid(response.Body.Bytes()) {
			t.Errorf("invalid JSON: %s", response.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodPost, "http://localhost/api/extensions/managed/install", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, req)
	if response.Code < 400 {
		t.Fatalf("unauthenticated install accepted: %d", response.Code)
	}
}

func TestManagedMediaWritesDirectUsersToOwnedMediaService(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	req := httptest.NewRequest(http.MethodPost, "/api/extensions/managed/install", strings.NewReader(`{"id":"gallery-dl"}`))
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, cookie.Value)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "media service") {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
}
