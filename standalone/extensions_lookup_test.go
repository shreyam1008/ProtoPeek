package standalone

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/extensions"
)

func fixtureExtensionSnapshot(version int, ids ...string) extensions.Snapshot {
	value := extensions.Snapshot{SchemaVersion: version, Platform: "fixture", Architecture: "test", ObservedAt: "2026-10-23T00:00:00Z", Extensions: make([]extensions.Extension, 0, len(ids))}
	for _, id := range ids {
		value.Extensions = append(value.Extensions, extensions.Extension{ID: id, Status: "missing", Source: "none", Message: "Fixture CLI not located."})
	}
	return value
}

func TestExtensionQueryValidationAndCatalogPrecedeAllHostIO(t *testing.T) {
	service := &extensionConfigService{fakeTransferService: &fakeTransferService{}}
	mux := http.NewServeMux()
	registerExtensionsWithInspector(mux, service,
		func(extensions.Options) extensions.Snapshot {
			t.Error("unexpected bulk lookup")
			return extensions.Snapshot{}
		},
		func(string, extensions.Options) (extensions.Snapshot, error) {
			t.Error("unexpected single lookup")
			return extensions.Snapshot{}, nil
		},
	)
	for _, query := range []string{"?id=", "?id=unknown", "?id=caddy&id=ngrok", "?id=caddy&extra=x", "?extra=x", "?id=%zz", "?id=caddy;extra=x", "?id=../caddy", "?id=caddy&", "?&id=caddy", "?&&id=caddy", "?id=caddy&&", "?&", "?&&"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions"+query, nil))
		if response.Code != 400 || service.reads != 0 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("query=%q status=%d reads=%d", query, response.Code, service.reads)
		}
	}
	for _, path := range []string{"/api/extensions", "/api/extensions?id=caddy", "/api/extensions/catalog"} {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodHead} {
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(method, path, nil))
			if response.Code != 405 || response.Header().Get("Allow") != http.MethodGet || service.reads != 0 {
				t.Fatalf("%s %s status=%d reads=%d", method, path, response.Code, service.reads)
			}
		}
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions/catalog", nil))
	var catalog extensions.Catalog
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &catalog) != nil || catalog.SchemaVersion != 1 || len(catalog.Extensions) != 20 || service.reads != 0 || strings.Contains(response.Body.String(), "observedAt") || strings.Contains(response.Body.String(), "path") {
		t.Fatalf("static catalog=%d %s reads=%d", response.Code, response.Body.String(), service.reads)
	}
}

func TestExtensionSingleSchemaAndAria2SettingsAreIsolatedFromLegacy(t *testing.T) {
	service := &extensionConfigService{fakeTransferService: &fakeTransferService{}}
	mux := http.NewServeMux()
	registerExtensionsWithInspector(mux, service,
		func(options extensions.Options) extensions.Snapshot {
			if !options.Aria2ConfigKnown {
				t.Error("legacy lookup did not receive optional engine settings")
			}
			return fixtureExtensionSnapshot(1, "tailscale", "cloudflared", "wireshark", "nmap", "aria2", "netbird")
		},
		func(id string, options extensions.Options) (extensions.Snapshot, error) {
			if options.Aria2ConfigKnown != (id == "aria2") || options.Aria2Path != "" || options.Aria2ConfigError != nil {
				t.Errorf("unselected or invalid optional engine settings for %s: %+v", id, options)
			}
			return fixtureExtensionSnapshot(2, id), nil
		},
	)
	for _, id := range []string{"chatgpt", "caddy", "lm-studio", "aria2"} {
		before := service.reads
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions?id="+id, nil))
		var snapshot extensions.Snapshot
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil || snapshot.SchemaVersion != 2 || len(snapshot.Extensions) != 1 || snapshot.Extensions[0].ID != id {
			t.Fatalf("single %s=%d %s", id, response.Code, response.Body.String())
		}
		wantReads := before
		if id == "aria2" {
			wantReads++
		}
		if service.reads != wantReads {
			t.Fatalf("%s read unselected engine settings", id)
		}
		if id == "chatgpt" && (snapshot.Extensions[0].Status != "external" || snapshot.Extensions[0].Path != "") {
			t.Fatal("ChatGPT must not imply a local application was found")
		}
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions", nil))
	var snapshot extensions.Snapshot
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil || snapshot.SchemaVersion != 1 || len(snapshot.Extensions) != 6 {
		t.Fatalf("legacy=%d %s", response.Code, response.Body.String())
	}
	for i, id := range []string{"tailscale", "cloudflared", "wireshark", "nmap", "aria2", "netbird"} {
		if snapshot.Extensions[i].ID != id || snapshot.Extensions[i].Status == "external" {
			t.Fatalf("legacy identity/order/status changed: %+v", snapshot.Extensions)
		}
	}
	if service.reads != 2 {
		t.Fatalf("engine settings reads=%d", service.reads)
	}
}

func TestExtensionCancellationDetachesButRetainsBothLookupSlots(t *testing.T) {
	mux := http.NewServeMux()
	started := make(chan string, 2)
	finished := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	lookup := func(id string) extensions.Snapshot {
		calls.Add(1)
		started <- id
		<-release // Models a filesystem PATH/stat operation that cannot be interrupted.
		finished <- struct{}{}
		if id == "" {
			return fixtureExtensionSnapshot(1, "tailscale", "cloudflared", "wireshark", "nmap", "aria2", "netbird")
		}
		return fixtureExtensionSnapshot(2, id)
	}
	registerExtensionsWithInspector(mux, nil,
		func(extensions.Options) extensions.Snapshot {
			return lookup("")
		},
		func(id string, _ extensions.Options) (extensions.Snapshot, error) {
			return lookup(id), nil
		},
	)
	var cancel []context.CancelFunc
	var done []chan int
	for _, path := range []string{"/api/extensions", "/api/extensions?id=caddy"} {
		ctx, stop := context.WithCancel(context.Background())
		cancel = append(cancel, stop)
		t.Cleanup(stop)
		result := make(chan int, 1)
		done = append(done, result)
		go func() {
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx))
			result <- response.Code
		}()
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("lookup did not start")
		}
	}
	checkBusy := func() {
		t.Helper()
		for _, path := range []string{"/api/extensions", "/api/extensions?id=openssh"} {
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != 429 || response.Header().Get("Retry-After") != "1" || calls.Load() != 2 {
				t.Fatalf("lookup gate released early: path=%s status=%d calls=%d", path, response.Code, calls.Load())
			}
		}
	}
	checkBusy()
	for i, stop := range cancel {
		stop()
		select {
		case status := <-done[i]:
			if status != 499 {
				t.Fatalf("cancelled status=%d", status)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cancellation failed to detach")
		}
	}
	checkBusy()
	metadata := httptest.NewRecorder()
	mux.ServeHTTP(metadata, httptest.NewRequest(http.MethodGet, "/api/extensions/catalog", nil))
	if metadata.Code != 200 {
		t.Fatal("metadata required a filesystem lookup slot")
	}
	external := httptest.NewRecorder()
	mux.ServeHTTP(external, httptest.NewRequest(http.MethodGet, "/api/extensions?id=chatgpt", nil))
	var externalSnapshot extensions.Snapshot
	if external.Code != 200 || json.Unmarshal(external.Body.Bytes(), &externalSnapshot) != nil || externalSnapshot.SchemaVersion != 2 || len(externalSnapshot.Extensions) != 1 || externalSnapshot.Extensions[0].ID != "chatgpt" || externalSnapshot.Extensions[0].Status != "external" || externalSnapshot.Extensions[0].Path != "" || calls.Load() != 2 {
		t.Fatalf("external guidance required a filesystem lookup: %d %s calls=%d", external.Code, external.Body.String(), calls.Load())
	}
	releaseOnce.Do(func() { close(release) })
	for range 2 {
		select {
		case <-finished:
		case <-time.After(2 * time.Second):
			t.Fatal("lookup did not return")
		}
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions?id=openssh", nil))
		if response.Code == 200 {
			break
		}
		if response.Code != 429 || time.Now().After(deadline) {
			t.Fatalf("slot not reclaimed after actual completion: %d", response.Code)
		}
		time.Sleep(time.Millisecond)
	}
}

type extensionCallbackConfigService struct {
	*fakeTransferService
	read func() (string, error)
}

func (service extensionCallbackConfigService) ConfiguredAria2Path() (string, error) {
	return service.read()
}

func TestExtensionWorkerPanicsReturnSanitized503AndReclaimSlots(t *testing.T) {
	for _, test := range []struct{ name, path string }{
		{"bulk", "/api/extensions"},
		{"single", "/api/extensions?id=caddy"},
		{"configuration", "/api/extensions?id=aria2"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var shouldPanic atomic.Bool
			shouldPanic.Store(true)
			maybePanic := func(stage string) {
				if stage == test.name && shouldPanic.Load() {
					panic("private-path-and-credential-sentinel")
				}
			}
			service := extensionCallbackConfigService{fakeTransferService: &fakeTransferService{}, read: func() (string, error) {
				maybePanic("configuration")
				return "", nil
			}}
			mux := http.NewServeMux()
			registerExtensionsWithInspector(mux, service,
				func(extensions.Options) extensions.Snapshot {
					maybePanic("bulk")
					return fixtureExtensionSnapshot(1, "tailscale", "cloudflared", "wireshark", "nmap", "aria2", "netbird")
				},
				func(id string, _ extensions.Options) (extensions.Snapshot, error) {
					maybePanic("single")
					return fixtureExtensionSnapshot(2, id), nil
				},
			)
			for range 3 {
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
				if response.Code != 503 || response.Body.String() != "extension lookup could not complete\n" {
					t.Fatalf("panic escaped or leaked details: status=%d body=%q", response.Code, response.Body.String())
				}
			}
			shouldPanic.Store(false)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != 200 {
				t.Fatalf("worker panic leaked a lookup slot: %d", response.Code)
			}
		})
	}
}
