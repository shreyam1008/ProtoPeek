package standalone

import (
	"context"
	"errors"
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

	snapshot    transfer.Snapshot
	snapshotErr error
	startHealth transfer.Health
	startErr    error
	addResult   transfer.AddResult
	addErr      error
	retryResult transfer.AddResult
	actionErr   error

	calls   []string
	lastAdd transfer.AddRequest
	lastID  string
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

func (service *fakeTransferService) Add(_ context.Context, request transfer.AddRequest) (transfer.AddResult, error) {
	service.record("add")
	service.lastAdd = request
	return service.addResult, service.addErr
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
