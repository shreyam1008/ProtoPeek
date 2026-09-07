package standalone

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"github.com/shreyam1008/ProtoPeek/internal/webobserve"
)

func pathPlanRequest(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/security/paths", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func TestWebsitePathPlanUsesFiveHEADsAndDoesNotFollowRedirect(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodHead || r.Header.Get("Cookie") != "" {
			t.Errorf("unexpected request: %s", r.Method)
		}
		switch r.URL.Path {
		case "/robots.txt":
			w.Header().Set("Content-Type", "text/plain")
			w.Header().Set("Content-Length", "42")
			w.WriteHeader(200)
		case "/sitemap.xml":
			w.Header().Set("Location", "http://127.0.0.1/never-follow")
			w.WriteHeader(302)
		case "/.well-known/security.txt":
			w.WriteHeader(405)
		case "/security.txt", "/.__protopeek_missing_resource__":
			w.WriteHeader(404)
		default:
			t.Errorf("unplanned request: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	observer, err := webobserve.New(webobserve.Options{Policy: targetguard.LocalDevelopment})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	WebsitePathsOperationHandler(observer).ServeHTTP(w, pathPlanRequest(`{"url":"`+server.URL+`/ignored/path","acknowledgePublicRequest":true}`))
	var result websitePathResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err, w.Body.String())
	}
	if requests.Load() != 5 || len(result.Paths) != 5 || result.Partial || result.Origin != server.URL {
		t.Fatalf("requests=%d result=%+v", requests.Load(), result)
	}
	if result.Paths[0].ContentLength != "42" || result.Paths[0].ContentType != "text/plain" || result.Paths[1].StatusCode != 302 || result.Paths[2].StatusCode != 405 {
		t.Fatalf("wrong evidence: %+v", result.Paths)
	}
}

func TestWebsitePathPlanCancellationBoundsWorkersAndRetainsPartial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var started atomic.Int32
	bothStarted := make(chan struct{})
	observer := websiteObserverFunc(func(ctx context.Context, _ string) (webobserve.Result, error) {
		if started.Add(1) == 2 {
			close(bothStarted)
		}
		<-ctx.Done()
		return webobserve.Result{}, ctx.Err()
	})
	r := pathPlanRequest(`{"url":"https://example.com","acknowledgePublicRequest":true}`).WithContext(ctx)
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); WebsitePathsOperationHandler(observer).ServeHTTP(w, r) }()
	<-bothStarted
	cancel()
	<-done
	var result websitePathResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if started.Load() != 2 || !result.Partial || len(result.Paths) != 5 {
		t.Fatalf("unexpected cancellation: calls=%d result=%+v", started.Load(), result)
	}
	for _, entry := range result.Paths {
		if entry.Error == "" || entry.StatusCode != 0 {
			t.Fatalf("invented response: %+v", entry)
		}
	}
}

func TestWebsitePathPlanRejectsMalformedAndUnacknowledgedInputBeforeIO(t *testing.T) {
	for _, body := range []string{
		`{"url":"https://example.com"}`, `{"url":"https://u:p@example.com","acknowledgePublicRequest":true}`,
		`{"url":"https://example.com/?secret=value","acknowledgePublicRequest":true}`,
		`{"url":"https://example.com/?","acknowledgePublicRequest":true}`,
		`{"url":"https://example.com/#fragment","acknowledgePublicRequest":true}`,
		`{"url":"file:///etc/passwd","acknowledgePublicRequest":true}`,
		`{"url":"https://example.com","acknowledgePublicRequest":true,"paths":["/admin"]}`,
	} {
		var called atomic.Bool
		observer := websiteObserverFunc(func(context.Context, string) (webobserve.Result, error) {
			called.Store(true)
			return webobserve.Result{}, nil
		})
		w := httptest.NewRecorder()
		WebsitePathsOperationHandler(observer).ServeHTTP(w, pathPlanRequest(body))
		if w.Code != 400 || called.Load() {
			t.Fatalf("accepted %s: %d", body, w.Code)
		}
	}
}

func TestWebsitePathPlanPreservesProductionPublicAddressPolicy(t *testing.T) {
	observer, err := webobserve.New(webobserve.Options{Policy: targetguard.PublicOnly})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	WebsitePathsOperationHandler(observer).ServeHTTP(w, pathPlanRequest(`{"url":"http://127.0.0.1","acknowledgePublicRequest":true}`))
	var result websitePathResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Partial {
		t.Fatal("loopback should be blocked")
	}
	for _, entry := range result.Paths {
		if entry.Error == "" {
			t.Fatal("loopback request accepted")
		}
	}
}
