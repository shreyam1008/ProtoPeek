package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type fakeTransferService struct {
	mu sync.Mutex

	snapshot           transfer.Snapshot
	snapshotErr        error
	startHealth        transfer.Health
	startErr           error
	hostConfig         transfer.HostConfig
	hostConfigErr      error
	hostConfigRevision string
	addResult          transfer.AddResult
	addErr             error
	batchResult        transfer.BatchAddResult
	batchErr           error
	retryResult        transfer.AddResult
	actionErr          error

	calls          []string
	lastAdd        transfer.AddRequest
	lastBatch      transfer.BatchAddRequest
	lastID         string
	lastHostConfig transfer.HostConfig
}

type fakeGoBarryMigrationService struct {
	*fakeTransferService
	preview        transfer.GoBarryMigrationPreview
	previewErr     error
	importResult   transfer.GoBarryImportResult
	importErr      error
	lastImport     transfer.GoBarryImportRequest
	rollbackResult transfer.GoBarryRollbackResult
	rollbackErr    error
	lastRollback   transfer.GoBarryRollbackRequest
}

func (service *fakeGoBarryMigrationService) PreviewGoBarry(context.Context) (transfer.GoBarryMigrationPreview, error) {
	service.record("gobarry-preview")
	return service.preview, service.previewErr
}

func (service *fakeGoBarryMigrationService) ImportGoBarry(_ context.Context, request transfer.GoBarryImportRequest) (transfer.GoBarryImportResult, error) {
	service.record("gobarry-import")
	service.lastImport = request
	return service.importResult, service.importErr
}

func (service *fakeGoBarryMigrationService) RollbackGoBarry(_ context.Context, request transfer.GoBarryRollbackRequest) (transfer.GoBarryRollbackResult, error) {
	service.record("gobarry-rollback")
	service.lastRollback = request
	return service.rollbackResult, service.rollbackErr
}

func (service *fakeTransferService) record(call string) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.calls = append(service.calls, call)
}

func (service *fakeTransferService) Snapshot(context.Context) (transfer.Snapshot, error) {
	service.record("snapshot")
	return service.snapshot, service.snapshotErr
}

func (service *fakeTransferService) Start(context.Context) (transfer.Health, error) {
	service.record("start")
	return service.startHealth, service.startErr
}

func (service *fakeTransferService) ConfigureAndSavePatch(_ string, patch transfer.HostConfigPatch) (transfer.HostConfig, string, error) {
	service.record("configure")
	service.lastHostConfig = patch.Apply(service.hostConfig)
	return service.lastHostConfig, service.hostConfigRevision, service.hostConfigErr
}

func (service *fakeTransferService) Add(_ context.Context, request transfer.AddRequest) (transfer.AddResult, error) {
	service.record("add")
	service.lastAdd = request
	return service.addResult, service.addErr
}

func (service *fakeTransferService) AddBatch(_ context.Context, request transfer.BatchAddRequest) (transfer.BatchAddResult, error) {
	service.record("batch")
	service.lastBatch = request
	return service.batchResult, service.batchErr
}

func (service *fakeTransferService) PauseAll(context.Context) error {
	service.record("pause-all")
	return service.actionErr
}

func (service *fakeTransferService) ResumeAll(context.Context) error {
	service.record("resume-all")
	return service.actionErr
}

func (service *fakeTransferService) Pause(_ context.Context, id string) error {
	service.record("pause")
	service.lastID = id
	return service.actionErr
}

func (service *fakeTransferService) Resume(_ context.Context, id string) error {
	service.record("resume")
	service.lastID = id
	return service.actionErr
}

func (service *fakeTransferService) Retry(_ context.Context, id string) (transfer.AddResult, error) {
	service.record("retry")
	service.lastID = id
	return service.retryResult, service.actionErr
}

func (service *fakeTransferService) Cancel(_ context.Context, id string) error {
	service.record("cancel")
	service.lastID = id
	return service.actionErr
}

func (service *fakeTransferService) Shutdown(context.Context) error {
	service.record("shutdown")
	return nil
}

func TestTransferSnapshotIsObservational(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{snapshot: transfer.Snapshot{
		Health: transfer.Health{Status: "stopped", Message: "Start explicitly."},
		Jobs:   []transfer.Job{},
	}}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/transfers/snapshot", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%q", response.Code, response.Body.String())
	}
	if strings.Join(service.calls, ",") != "snapshot" {
		t.Fatalf("service calls = %#v", service.calls)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestTransferMutationsRequireCSRFBeforeReadingBody(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	body := &failOnReadBody{}
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/add", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%q", response.Code, response.Body.String())
	}
	if body.read {
		t.Fatal("unauthorized request body was read")
	}
	if len(service.calls) != 0 {
		t.Fatalf("unauthorized service calls = %#v", service.calls)
	}
}

func TestTransferStartAndActions(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{
		startHealth: transfer.Health{Ready: true, Status: "running"},
		addResult:   transfer.AddResult{ID: "aabbccdd"},
		retryResult: transfer.AddResult{ID: "eeff0011"},
	}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)

	tests := []struct {
		path string
		body string
		want int
	}{
		{path: "/api/transfers/start", want: http.StatusOK},
		{path: "/api/transfers/add", body: `{"sources":["https://example.com/archive.zip"]}`, want: http.StatusCreated},
		{path: "/api/transfers/pause", body: `{"id":"aabbccdd"}`, want: http.StatusNoContent},
		{path: "/api/transfers/resume", body: `{"id":"aabbccdd"}`, want: http.StatusNoContent},
		{path: "/api/transfers/retry", body: `{"id":"aabbccdd"}`, want: http.StatusOK},
		{path: "/api/transfers/cancel", body: `{"id":"aabbccdd"}`, want: http.StatusNoContent},
	}
	for _, test := range tests {
		test := test
		t.Run(test.path, func(t *testing.T) {
			var body io.Reader
			if test.body != "" {
				body = strings.NewReader(test.body)
			}
			request := httptest.NewRequest(http.MethodPost, test.path, body)
			request.AddCookie(cookie)
			request.Header.Set(csrfHeaderName, cookie.Value)
			if test.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d want=%d body=%q", response.Code, test.want, response.Body.String())
			}
		})
	}
	if service.lastAdd.Sources[0] != "https://example.com/archive.zip" || service.lastID != "aabbccdd" {
		t.Fatalf("last add=%#v last id=%q", service.lastAdd, service.lastID)
	}
}

func TestTransferHostConfigMutationIsStrictBoundedAndValidated(t *testing.T) {
	t.Parallel()
	config := transfer.DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	revision := transfer.HostConfigRevision(config)
	service := &fakeTransferService{hostConfig: config, hostConfigRevision: revision}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)

	validBody := `{"expectedRevision":"` + revision + `","maxActiveJobs":6}`
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", strings.NewReader(validBody))
	request.RemoteAddr = "127.0.0.1:43123"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "downloadDirectory") {
		t.Fatalf("valid config = %d %q", response.Code, response.Body.String())
	}
	wantConfig := config
	wantConfig.MaxActiveJobs = 6
	if service.lastHostConfig != wantConfig {
		t.Fatalf("saved config = %#v, want %#v", service.lastHostConfig, wantConfig)
	}

	tests := []struct {
		name        string
		contentType string
		body        string
		wantStatus  int
	}{
		{name: "unknown field", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","future":true}`, wantStatus: http.StatusBadRequest},
		{name: "duplicate field", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","maxActiveJobs":5,"maxActiveJobs":6}`, wantStatus: http.StatusBadRequest},
		{name: "case-fold duplicate field", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","maxActiveJobs":5,"MaxActiveJobs":6}`, wantStatus: http.StatusBadRequest},
		{name: "null field", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","maxActiveJobs":null}`, wantStatus: http.StatusBadRequest},
		{name: "trailing value", contentType: "application/json", body: `{"expectedRevision":"` + revision + `"} {}`, wantStatus: http.StatusBadRequest},
		{name: "malformed json", contentType: "application/json", body: `{"expectedRevision":"` + revision + `"`, wantStatus: http.StatusBadRequest},
		{name: "invalid revision", contentType: "application/json", body: `{"expectedRevision":"stale","maxActiveJobs":6}`, wantStatus: http.StatusBadRequest},
		{name: "wrong content type", contentType: "text/plain", body: validBody, wantStatus: http.StatusUnsupportedMediaType},
		{name: "oversized", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","aria2Path":"` + strings.Repeat("x", maxTransferConfigBodyBytes) + `"}`, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "invalid config", contentType: "application/json", body: `{"expectedRevision":"` + revision + `","maxActiveJobs":17}`, wantStatus: http.StatusBadRequest},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", strings.NewReader(test.body))
			request.RemoteAddr = "127.0.0.1:43123"
			request.Header.Set("Content-Type", test.contentType)
			request.Header.Set(csrfHeaderName, cookie.Value)
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d body=%q, want %d", response.Code, response.Body.String(), test.wantStatus)
			}
		})
	}
	service.mu.Lock()
	configureCalls := 0
	for _, call := range service.calls {
		if call == "configure" {
			configureCalls++
		}
	}
	service.mu.Unlock()
	if configureCalls != 1 {
		t.Fatalf("configure calls = %d, want only the valid request", configureCalls)
	}
}

func TestTransferHostConfigMutationChecksCSRFAndLoopbackBeforeBody(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)

	missingCSRFBody := &failOnReadBody{}
	missingCSRF := httptest.NewRequest(http.MethodPost, "/api/transfers/config", missingCSRFBody)
	missingCSRF.RemoteAddr = "203.0.113.4:1234"
	missingCSRF.Header.Set("Content-Type", "application/json")
	missingCSRFResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingCSRFResponse, missingCSRF)
	if missingCSRFResponse.Code != http.StatusUnauthorized || missingCSRFBody.read {
		t.Fatalf("missing CSRF = %d reads=%v body=%q", missingCSRFResponse.Code, missingCSRFBody.read, missingCSRFResponse.Body.String())
	}

	remoteBody := &failOnReadBody{}
	remote := httptest.NewRequest(http.MethodPost, "/api/transfers/config", remoteBody)
	remote.RemoteAddr = "203.0.113.4:1234"
	remote.Header.Set("Content-Type", "application/json")
	remote.Header.Set(csrfHeaderName, cookie.Value)
	remote.AddCookie(cookie)
	remoteResponse := httptest.NewRecorder()
	handler.ServeHTTP(remoteResponse, remote)
	if remoteResponse.Code != http.StatusForbidden || remoteBody.read {
		t.Fatalf("remote peer = %d reads=%v body=%q", remoteResponse.Code, remoteBody.read, remoteResponse.Body.String())
	}

	for _, remoteAddr := range []string{"127.0.0.1", "[::1]", "not-a-remote-address"} {
		body := &failOnReadBody{}
		request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", body)
		request.RemoteAddr = remoteAddr
		request.Header.Set("X-Forwarded-For", "127.0.0.1")
		request.Header.Set("X-Forwarded-Host", "localhost")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || body.read {
			t.Fatalf("malformed/direct peer %q = %d reads=%v body=%q", remoteAddr, response.Code, body.read, response.Body.String())
		}
	}

	for _, header := range []string{"Forwarded", "X-Forwarded-For", "X-Real-IP", "X-Forwarded-Host", "X-Forwarded-Proto"} {
		body := &failOnReadBody{}
		request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", body)
		request.RemoteAddr = "127.0.0.1:43123"
		request.Header.Set(header, "127.0.0.1")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || body.read {
			t.Fatalf("forwarding header %q = %d reads=%v body=%q", header, response.Code, body.read, response.Body.String())
		}
	}
}

func TestTransferHostConfigMutationMapsHeldLockTruthfully(t *testing.T) {
	t.Parallel()
	config := transfer.DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	service := &fakeTransferService{hostConfigErr: transfer.ErrLockHeld}
	service.hostConfig = config
	service.hostConfigRevision = transfer.HostConfigRevision(config)
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	body := `{"expectedRevision":"` + service.hostConfigRevision + `","maxActiveJobs":6}`
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:43123"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusLocked {
		t.Fatalf("held-lock status = %d body=%q, want %d", response.Code, response.Body.String(), http.StatusLocked)
	}
	if !strings.Contains(response.Body.String(), "Another ProtoPeek process already owns the downloader") {
		t.Fatalf("held-lock body = %q", response.Body.String())
	}
}

func TestTransferHostConfigMutationReturnsCommittedDurabilityWarning(t *testing.T) {
	t.Parallel()
	config := transfer.DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	revision := transfer.HostConfigRevision(config)
	updated := config
	updated.MaxActiveJobs = 6
	service := &fakeTransferService{
		hostConfig:         config,
		hostConfigRevision: transfer.HostConfigRevision(updated),
		hostConfigErr:      transfer.NewConfigCommitError(errors.New("directory sync unavailable")),
	}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	body := `{"expectedRevision":"` + revision + `","maxActiveJobs":6}`
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/config", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:43123"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("committed durability response = %d body=%q", response.Code, response.Body.String())
	}
	var decoded struct {
		transfer.HostConfig
		ConfigRevision string `json:"configRevision"`
		Warning        string `json:"warning"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode committed durability response: %v", err)
	}
	if decoded.MaxActiveJobs != 6 || decoded.ConfigRevision != transfer.HostConfigRevision(updated) || decoded.Warning == "" {
		t.Fatalf("committed durability response = %#v", decoded)
	}
}

func TestTransferBatchReportsPartialSuccessWithoutReflectingCredentials(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{batchResult: transfer.BatchAddResult{
		RequestedCount: 2,
		QueuedCount:    1,
		FailedCount:    1,
		Results: []transfer.BatchAddItemResult{
			{Index: 0, Queued: true, ID: "aabbccdd"},
			{Index: 1, FailureCode: transfer.BatchFailureQueueFull},
		},
	}}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	secret := "Bearer private-credential"
	body := `{"jobs":[{"sources":["https://example.com/one?token=private"],"headers":[{"name":"Authorization","value":"` + secret + `"}]},{"sources":["https://example.com/two"]}]}`
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/batch", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusMultiStatus || !strings.Contains(response.Body.String(), `"queuedCount":1`) {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), secret) || strings.Contains(response.Body.String(), "example.com") {
		t.Fatalf("batch response leaked request data: %q", response.Body.String())
	}
	if len(service.lastBatch.Jobs) != 2 || service.lastBatch.Jobs[0].Headers[0].Value != secret {
		t.Fatalf("decoded batch = %#v", service.lastBatch)
	}
}

func TestTransferGlobalControlsUseExplicitRealServiceMethods(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	for _, path := range []string{"/api/transfers/pause-all", "/api/transfers/resume-all"} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("%s response = %d %q", path, response.Code, response.Body.String())
		}
	}
	if got := strings.Join(service.calls, ","); got != "pause-all,resume-all" {
		t.Fatalf("global calls = %q", got)
	}

	service.calls = nil
	service.actionErr = transfer.ErrQueueStateNotPersisted
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/pause-all", nil)
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "persistenceWarning") {
		t.Fatalf("partial pause-all = %d %q", response.Code, response.Body.String())
	}
}

func TestTransferJSONBoundsAndUnknownFields(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)

	for _, test := range []struct {
		name string
		body string
		want int
	}{
		{name: "unknown", body: `{"sources":["https://example.com/a"],"deleteFiles":true}`, want: http.StatusBadRequest},
		{name: "oversized", body: `{"sources":["` + strings.Repeat("a", maxTransferAddBodyBytes) + `"]}`, want: http.StatusRequestEntityTooLarge},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/transfers/add", strings.NewReader(test.body))
			request.AddCookie(cookie)
			request.Header.Set(csrfHeaderName, cookie.Value)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d want=%d body=%q", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestTransferErrorStatusMapping(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		err  error
		want int
	}{
		{name: "lock", err: transfer.ErrLockHeld, want: http.StatusLocked},
		{name: "binary", err: transfer.ErrAria2NotFound, want: http.StatusServiceUnavailable},
		{name: "invalid add", err: transfer.ErrInvalidAddRequest, want: http.StatusBadRequest},
		{name: "not running", err: transfer.ErrEngineNotRunning, want: http.StatusConflict},
		{name: "retry metadata", err: transfer.ErrRetryMetadataMissing, want: http.StatusConflict},
		{name: "disk", err: transfer.ErrInsufficientDisk, want: http.StatusInsufficientStorage},
		{name: "deadline", err: context.DeadlineExceeded, want: http.StatusGatewayTimeout},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			service := &fakeTransferService{startErr: test.err}
			handler := Handler(nil, "", nil, nil, WithTransferService(service))
			cookie := handlerCSRFCookie(t, handler)
			request := httptest.NewRequest(http.MethodPost, "/api/transfers/start", nil)
			request.AddCookie(cookie)
			request.Header.Set(csrfHeaderName, cookie.Value)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d want=%d body=%q", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestTransferPartialSuccessReturnsWarningWithoutInvitingRetry(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{actionErr: transfer.ErrQueueStateNotPersisted}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/pause", strings.NewReader(`{"id":"aabbccdd"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "persistenceWarning") {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
	if strings.Join(service.calls, ",") != "pause" {
		t.Fatalf("service calls = %#v", service.calls)
	}
}

func TestTransferAddReturnsQueuedPersistenceWarning(t *testing.T) {
	t.Parallel()
	service := &fakeTransferService{addResult: transfer.AddResult{
		ID:                 "aabbccdd",
		Verification:       "pending",
		PersistenceWarning: transfer.PersistenceWarningMessage,
	}}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/add", strings.NewReader(`{"sources":["https://example.com/file"]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), "persistenceWarning") {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
}

func TestTransferErrorsNeverEchoSourceURLOrProviderText(t *testing.T) {
	t.Parallel()
	secret := "https://example.com/file?signature=private-secret"
	service := &fakeTransferService{startErr: errors.New("provider rejected " + secret)}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/start", nil)
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
	if strings.Contains(response.Body.String(), "example.com") || strings.Contains(response.Body.String(), "private-secret") {
		t.Fatalf("public error leaked provider detail: %q", response.Body.String())
	}
}

func TestGoBarryMigrationPreviewAndExplicitImport(t *testing.T) {
	t.Parallel()
	service := &fakeGoBarryMigrationService{
		fakeTransferService: &fakeTransferService{},
		preview: transfer.GoBarryMigrationPreview{
			Available:        true,
			PreferencesFound: true,
			SessionFound:     true,
			SessionEntries:   2,
			CanImport:        true,
			PreviewRevision:  strings.Repeat("a", 64),
		},
		importResult: transfer.GoBarryImportResult{
			Imported:            true,
			PreferencesImported: true,
			SessionImported:     true,
			SourcePreserved:     true,
		},
	}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)

	wrongMethod := httptest.NewRecorder()
	handler.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodGet, "/api/transfers/migrations/gobarry/preview", nil))
	if wrongMethod.Code != http.StatusMethodNotAllowed || wrongMethod.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("GET preview = %d Allow=%q", wrongMethod.Code, wrongMethod.Header().Get("Allow"))
	}
	previewResponse := httptest.NewRecorder()
	previewRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/preview", nil)
	previewRequest.Header.Set(csrfHeaderName, cookie.Value)
	previewRequest.AddCookie(cookie)
	handler.ServeHTTP(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusOK || !strings.Contains(previewResponse.Body.String(), `"sessionEntries":2`) {
		t.Fatalf("preview = %d %q", previewResponse.Code, previewResponse.Body.String())
	}

	nonEmptyPreview := httptest.NewRecorder()
	nonEmptyRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/preview", strings.NewReader(`{}`))
	nonEmptyRequest.Header.Set(csrfHeaderName, cookie.Value)
	nonEmptyRequest.AddCookie(cookie)
	handler.ServeHTTP(nonEmptyPreview, nonEmptyRequest)
	if nonEmptyPreview.Code != http.StatusBadRequest {
		t.Fatalf("non-empty preview = %d %q", nonEmptyPreview.Code, nonEmptyPreview.Body.String())
	}

	request := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/import", strings.NewReader(`{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":"`+strings.Repeat("a", 64)+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sourcePreserved":true`) {
		t.Fatalf("import = %d %q", response.Code, response.Body.String())
	}
	if !service.lastImport.ImportPreferences || !service.lastImport.ImportSession || !service.lastImport.AcknowledgeSourcePreserved || service.lastImport.ExpectedRevision != strings.Repeat("a", 64) {
		t.Fatalf("request = %#v", service.lastImport)
	}
}

func TestGoBarryMigrationImportMapsPreviewConflictToRefresh(t *testing.T) {
	t.Parallel()
	service := &fakeGoBarryMigrationService{
		fakeTransferService: &fakeTransferService{},
		importErr:           transfer.ErrGoBarryPreviewConflict,
	}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/import", strings.NewReader(`{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":"`+strings.Repeat("a", 64)+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "check again") {
		t.Fatalf("preview conflict = %d %q", response.Code, response.Body.String())
	}
	if !strings.Contains(strings.Join(service.calls, ","), "gobarry-import") {
		t.Fatalf("service call = %#v", service.calls)
	}
}

func TestGoBarryMigrationImportRejectsInvalidPreviewRevisionBeforeService(t *testing.T) {
	tests := map[string]string{
		"missing":   `{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true}`,
		"null":      `{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":null}`,
		"short":     `{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":"abc"}`,
		"uppercase": `{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":"` + strings.Repeat("A", 64) + `"}`,
		"non-hex":   `{"importPreferences":true,"importSession":true,"acknowledgeSourcePreserved":true,"expectedRevision":"` + strings.Repeat("z", 64) + `"}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			service := &fakeGoBarryMigrationService{fakeTransferService: &fakeTransferService{}}
			handler := Handler(nil, "", nil, nil, WithTransferService(service))
			cookie := handlerCSRFCookie(t, handler)
			request := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/import", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set(csrfHeaderName, cookie.Value)
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "valid GoBarryGo migration preview revision") {
				t.Fatalf("invalid revision = %d %q", response.Code, response.Body.String())
			}
			if strings.Contains(strings.Join(service.calls, ","), "gobarry-import") {
				t.Fatalf("invalid revision reached service: %#v", service.calls)
			}
		})
	}
}

func TestGoBarryMigrationPreviewAndImportRequireCSRFFirstAndMapSafeErrors(t *testing.T) {
	t.Parallel()
	service := &fakeGoBarryMigrationService{fakeTransferService: &fakeTransferService{}}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	previewBody := &failOnReadBody{}
	previewRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/preview", previewBody)
	previewResponse := httptest.NewRecorder()
	handler.ServeHTTP(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusUnauthorized || previewBody.read || len(service.calls) != 0 {
		t.Fatalf("unauthorized preview = %d read=%v calls=%v", previewResponse.Code, previewBody.read, service.calls)
	}

	body := &failOnReadBody{}
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/import", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || body.read || len(service.calls) != 0 {
		t.Fatalf("unauthorized import = %d read=%v calls=%v", response.Code, body.read, service.calls)
	}

	service.previewErr = fmt.Errorf("wrapped: %w", transfer.ErrGoBarryUnsafeState)
	cookie := handlerCSRFCookie(t, handler)
	unsafeRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/preview", nil)
	unsafeRequest.Header.Set(csrfHeaderName, cookie.Value)
	unsafeRequest.AddCookie(cookie)
	unsafeResponse := httptest.NewRecorder()
	handler.ServeHTTP(unsafeResponse, unsafeRequest)
	if unsafeResponse.Code != http.StatusUnprocessableEntity || strings.Contains(unsafeResponse.Body.String(), "wrapped") {
		t.Fatalf("unsafe preview = %d %q", unsafeResponse.Code, unsafeResponse.Body.String())
	}
}

func TestGoBarryMigrationRollbackUsesReceiptAndPreservesConflict(t *testing.T) {
	t.Parallel()
	service := &fakeGoBarryMigrationService{
		fakeTransferService: &fakeTransferService{},
		rollbackResult: transfer.GoBarryRollbackResult{
			RolledBack:      true,
			ReceiptID:       "20260823T120000.000000000Z-aabbccddeeff",
			SourcePreserved: true,
		},
	}
	handler := Handler(nil, "", nil, nil, WithTransferService(service))
	cookie := handlerCSRFCookie(t, handler)
	body := `{"receiptId":"20260823T120000.000000000Z-aabbccddeeff","acknowledgeCurrentStateCheck":true}`
	request := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/rollback", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"rolledBack":true`) {
		t.Fatalf("rollback = %d %q", response.Code, response.Body.String())
	}
	if service.lastRollback.ReceiptID == "" || !service.lastRollback.AcknowledgeCurrentStateCheck {
		t.Fatalf("rollback request = %#v", service.lastRollback)
	}

	service.rollbackErr = transfer.ErrGoBarryRollbackConflict
	conflictRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/rollback", strings.NewReader(body))
	conflictRequest.Header.Set("Content-Type", "application/json")
	conflictRequest.Header.Set(csrfHeaderName, cookie.Value)
	conflictRequest.AddCookie(cookie)
	conflict := httptest.NewRecorder()
	handler.ServeHTTP(conflict, conflictRequest)
	if conflict.Code != http.StatusConflict || strings.Contains(conflict.Body.String(), "ErrGoBarry") {
		t.Fatalf("conflict = %d %q", conflict.Code, conflict.Body.String())
	}

	service.rollbackErr = transfer.ErrGoBarryImportActive
	activeRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/rollback", strings.NewReader(body))
	activeRequest.Header.Set("Content-Type", "application/json")
	activeRequest.Header.Set(csrfHeaderName, cookie.Value)
	activeRequest.AddCookie(cookie)
	active := httptest.NewRecorder()
	handler.ServeHTTP(active, activeRequest)
	if active.Code != http.StatusConflict || !strings.Contains(active.Body.String(), "before rolling back") || strings.Contains(active.Body.String(), "before importing") {
		t.Fatalf("active rollback = %d %q", active.Code, active.Body.String())
	}

	service.rollbackErr = errors.New("state was restored but marker save failed")
	indeterminateRequest := httptest.NewRequest(http.MethodPost, "/api/transfers/migrations/gobarry/rollback", strings.NewReader(body))
	indeterminateRequest.Header.Set("Content-Type", "application/json")
	indeterminateRequest.Header.Set(csrfHeaderName, cookie.Value)
	indeterminateRequest.AddCookie(cookie)
	indeterminate := httptest.NewRecorder()
	handler.ServeHTTP(indeterminate, indeterminateRequest)
	if indeterminate.Code != http.StatusInternalServerError {
		t.Fatalf("indeterminate rollback = %d %q", indeterminate.Code, indeterminate.Body.String())
	}
	for _, want := range []string{"may already have been restored", "Retry the same receipt", "retained recovery journal"} {
		if !strings.Contains(indeterminate.Body.String(), want) {
			t.Fatalf("indeterminate rollback = %d %q; want %q", indeterminate.Code, indeterminate.Body.String(), want)
		}
	}
	if strings.Contains(indeterminate.Body.String(), "marker save failed") {
		t.Fatalf("indeterminate rollback exposed provider error: %q", indeterminate.Body.String())
	}
}

func handlerCSRFCookie(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	cookies := response.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue CSRF cookie")
	}
	return cookies[0]
}

type failOnReadBody struct {
	read bool
}

func (body *failOnReadBody) Read([]byte) (int, error) {
	body.read = true
	return 0, errors.New("body should not be read")
}

func (*failOnReadBody) Close() error { return nil }
