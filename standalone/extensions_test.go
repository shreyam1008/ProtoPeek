package standalone

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/extensions"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type extensionConfigService struct {
	*fakeTransferService
	path  string
	err   error
	reads int
}

func TestExtensionsHandlesTypedNilTransferService(t *testing.T) {
	t.Parallel()
	var service *transfer.Service
	mux := http.NewServeMux()
	registerExtensions(mux, service)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions", nil))
	var snapshot extensions.Snapshot
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil {
		t.Fatalf("typed nil response = %d %s", response.Code, response.Body.String())
	}
	if len(snapshot.Extensions) != 5 || snapshot.Extensions[4].Status != "unavailable" || snapshot.Extensions[4].Path != "" {
		t.Fatalf("typed nil aria2 = %#v", snapshot.Extensions)
	}
}

func (service *extensionConfigService) ConfiguredAria2Path() (string, error) {
	service.reads++
	return service.path, service.err
}

func TestExtensionsEndpointIsRegisteredAndRejectsMutations(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("GET = %d %s", response.Code, response.Body.String())
	}
	var snapshot extensions.Snapshot
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Platform != runtime.GOOS || snapshot.Architecture != runtime.GOARCH || snapshot.SchemaVersion != 1 || len(snapshot.Extensions) != 5 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if snapshot.Extensions[4].Status != "unavailable" {
		t.Fatalf("missing downloader service = %#v", snapshot.Extensions[4])
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		mux := http.NewServeMux()
		service := &extensionConfigService{fakeTransferService: &fakeTransferService{}}
		registerExtensions(mux, service)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(method, "/api/extensions", nil))
		if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != http.MethodGet || service.reads != 0 {
			t.Fatalf("%s = %d, reads %d", method, response.Code, service.reads)
		}
	}
}

func TestExtensionsReadsOnlyOptionalHostConfigContract(t *testing.T) {
	dir := t.TempDir()
	name := "configured-aria2"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("must not run"), 0o700); err != nil {
		t.Fatal(err)
	}
	service := &extensionConfigService{fakeTransferService: &fakeTransferService{}, path: path}
	mux := http.NewServeMux()
	registerExtensions(mux, service)
	for _, configErr := range []error{nil, errors.New("unreadable private settings")} {
		service.err = configErr
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/extensions", nil))
		if response.Code != http.StatusOK || response.Body.Len() > 32<<10 || len(service.calls) != 0 {
			t.Fatalf("response = %d; queue calls %v", response.Code, service.calls)
		}
		var snapshot extensions.Snapshot
		if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
			t.Fatal(err)
		}
		aria2 := snapshot.Extensions[4]
		if configErr == nil && (aria2.Status != "detected" || aria2.Source != "configured" || aria2.Path != path) {
			t.Fatalf("configured aria2 = %#v", aria2)
		}
		if configErr != nil && (aria2.Status != "unavailable" || aria2.Path != "") {
			t.Fatalf("unavailable config = %#v", aria2)
		}
	}
	if service.reads != 2 {
		t.Fatalf("configuration reads = %d", service.reads)
	}
}
