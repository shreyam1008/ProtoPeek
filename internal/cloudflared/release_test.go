package cloudflared

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestLatestReleaseUsesFixedUnauthenticatedEndpointAndComparesVersion(t *testing.T) {
	t.Parallel()
	checkedAt := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != latestReleaseAPI || request.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
		}
		if request.Header.Get("Authorization") != "" || request.Header.Get("User-Agent") == "" || request.Header.Get("X-GitHub-Api-Version") == "" {
			t.Fatalf("unsafe or missing headers: %v", request.Header)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(`{
				"tag_name":"2026.9.1",
				"published_at":"2026-09-01T01:02:03Z",
				"html_url":"https://github.com/cloudflare/cloudflared/releases/tag/2026.9.1"
			}`)),
			Request: request,
		}, nil
	})}
	inspector := NewInspectorWithHTTPClient(client)
	inspector.now = func() time.Time { return checkedAt }
	result, err := inspector.LatestRelease(context.Background(), ToolObservation{Found: true, Version: "cloudflared version 2026.8.3 (built 2026-08-20)"})
	if err != nil {
		t.Fatal(err)
	}
	if result.CheckedAt != checkedAt || result.InstalledVersion != "2026.8.3" || result.LatestVersion != "2026.9.1" || result.Status != "update-available" || result.SupportStatus != "supported" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ReleaseURL != "https://github.com/cloudflare/cloudflared/releases/tag/2026.9.1" || result.DownloadsURL != DownloadsURL {
		t.Fatalf("unexpected links: %#v", result)
	}
}

func TestLatestReleaseBoundsResponseAndDoesNotReflectIt(t *testing.T) {
	t.Parallel()
	secret := "invalid-password-invalid-token"
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(strings.Repeat(secret, maxReleaseBytes))), Request: request}, nil
	})}
	result, err := NewInspectorWithHTTPClient(client).LatestRelease(context.Background(), ToolObservation{Found: true, Version: "2026.8.3"})
	if err != nil || result.Status != "unknown" || !strings.Contains(result.Note, "256 KiB") {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if strings.Contains(result.Note, secret) {
		t.Fatalf("response content leaked: %q", result.Note)
	}
}

func TestVersionAndSupportComparisons(t *testing.T) {
	t.Parallel()
	tests := []struct {
		installed string
		latest    string
		status    int
		support   string
	}{
		{installed: "2026.9.1", latest: "v2026.9.1", status: 0, support: "supported"},
		{installed: "2025.9.1", latest: "2026.9.9", status: -1, support: "supported"},
		{installed: "2025.8.9", latest: "2026.9.1", status: -1, support: "out-of-support"},
		{installed: "2027.1.0", latest: "2026.9.1", status: 1, support: "supported"},
		{installed: "1.2.3", latest: "2.0.0", status: -1, support: "unknown"},
	}
	for _, test := range tests {
		_, installed, installedOK := parseCloudflaredVersion(test.installed)
		_, latest, latestOK := parseCloudflaredVersion(test.latest)
		if !installedOK || !latestOK || compareVersionParts(installed, latest) != test.status || cloudflaredSupportStatus(installed, latest) != test.support {
			t.Fatalf("installed=%q latest=%q got compare=%d support=%q", test.installed, test.latest, compareVersionParts(installed, latest), cloudflaredSupportStatus(installed, latest))
		}
	}
}

func TestFreshnessStatusNames(t *testing.T) {
	t.Parallel()
	tests := []struct {
		installed []int
		latest    []int
		want      string
	}{
		{installed: []int{2026, 8, 3}, latest: []int{2026, 9, 1}, want: "update-available"},
		{installed: []int{2026, 9, 1}, latest: []int{2026, 9, 1}, want: "current"},
		{installed: []int{2026, 10, 0}, latest: []int{2026, 9, 1}, want: "newer"},
	}
	for _, test := range tests {
		if got := cloudflaredFreshnessStatus(test.installed, test.latest); got != test.want {
			t.Fatalf("installed=%v latest=%v got=%q want=%q", test.installed, test.latest, got, test.want)
		}
	}
}

func TestReleaseRedirectPolicyAllowsOnlyBoundedGitHubAPIRedirects(t *testing.T) {
	t.Parallel()
	unsafeClient := &http.Client{Jar: testCookieJar{}}
	client := safeReleaseClient(unsafeClient)
	if client.Timeout != releaseTimeout || client.Jar != nil {
		t.Fatalf("release client did not enforce timeout/no-cookie policy: %#v", client)
	}
	allowed, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/cloudflare/cloudflared/releases/latest", nil)
	if err := client.CheckRedirect(allowed, []*http.Request{{}, {}}); err != nil {
		t.Fatalf("same-host redirect rejected: %v", err)
	}
	blocked, _ := http.NewRequest(http.MethodGet, "https://example.test/steal", nil)
	if err := client.CheckRedirect(blocked, nil); err == nil {
		t.Fatal("cross-host redirect accepted")
	}
}

type testCookieJar struct{}

func (testCookieJar) SetCookies(*url.URL, []*http.Cookie) {}
func (testCookieJar) Cookies(*url.URL) []*http.Cookie     { return nil }
