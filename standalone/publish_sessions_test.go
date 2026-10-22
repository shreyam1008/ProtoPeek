package standalone

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/publishsession"
)

type fakePublishService struct {
	calls   int
	request publishsession.Request
	start   publishsession.StartRequest
	stop    string
	err     error
}

func (s *fakePublishService) Preview(_ context.Context, input publishsession.Request) (publishsession.Preview, error) {
	s.calls++
	s.request = input
	return publishsession.Preview{}, s.err
}
func (s *fakePublishService) Start(_ context.Context, input publishsession.StartRequest) (publishsession.Session, error) {
	s.calls++
	s.start = input
	return publishsession.Session{}, nil
}
func (s *fakePublishService) Inspect(context.Context) (publishsession.Snapshot, error) {
	s.calls++
	return publishsession.Snapshot{}, nil
}
func (s *fakePublishService) Stop(_ context.Context, id string) (publishsession.Session, error) {
	s.calls++
	s.stop = id
	return publishsession.Session{}, nil
}
func (s *fakePublishService) Verify(_ context.Context, id string) (publishsession.Session, error) {
	s.calls++
	return publishsession.Session{}, nil
}

func TestPublishingSessionsRequireLocalAdmissionAndStrictClosedInput(t *testing.T) {
	s := &fakePublishService{}
	mux := http.NewServeMux()
	registerPublishSessionHandlers(mux, s)
	for _, test := range []struct {
		method, path, body, remote, forward string
		csrf                                bool
		status                              int
	}{
		{"GET", "preview", "", "127.0.0.1:1234", "", true, 405},
		{"POST", "preview", `{}`, "127.0.0.1:1234", "", false, 401},
		{"POST", "preview", `{}`, "192.0.2.1:1234", "", true, 403},
		{"POST", "preview", `{}`, "127.0.0.1:1234", "127.0.0.1", true, 403},
		{"POST", "preview", `{"mode":"quick","arguments":["reset"]}`, "127.0.0.1:1234", "", true, 400},
		{"POST", "start", `{"revision":"reviewed","confirmed":true,"origin":"other"}`, "127.0.0.1:1234", "", true, 400},
		{"POST", "stop", `{"pid":1234}`, "127.0.0.1:1234", "", true, 400},
		{"POST", "verify", `{"id":"owned","url":"https://unreviewed.example"}`, "127.0.0.1:1234", "", true, 400},
		{"POST", "status", `{}`, "127.0.0.1:1234", "", true, 400},
		{"POST", "start", strings.Repeat("x", 1025), "127.0.0.1:1234", "", true, 413},
	} {
		r := httptest.NewRequest(test.method, "/api/publish/"+test.path, strings.NewReader(test.body))
		r.RemoteAddr = test.remote
		r.Header.Set("Content-Type", "application/json")
		if test.csrf {
			r.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "publish-test"})
			r.Header.Set(csrfHeaderName, "publish-test")
		}
		if test.forward != "" {
			r.Header.Set("X-Forwarded-For", test.forward)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != test.status || s.calls != 0 {
			t.Fatalf("%s %s status=%d calls=%d body=%s", test.method, test.path, w.Code, s.calls, w.Body.String())
		}
	}
	for operation, body := range map[string]string{
		"preview": `{"mode":"quick","origin":"http://127.0.0.1:3000","port":0,"minutes":15}`,
		"start":   `{"revision":"review-token","confirmed":true}`,
		"stop":    `{"id":"owned-session"}`, "status": "", "verify": `{"id":"owned-session"}`,
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/publish/"+operation, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "publish-test"})
		r.Header.Set(csrfHeaderName, "publish-test")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("valid %s status=%d body=%s", operation, w.Code, w.Body.String())
		}
	}
	if s.calls != 5 || s.request.Mode != "quick" || s.start.Revision != "review-token" || !s.start.Confirmed || s.stop != "owned-session" {
		t.Fatalf("typed contracts not preserved: %+v", s)
	}
}

func TestPublishingSessionsAreDisabledWithoutExplicitInjection(t *testing.T) {
	mux := http.NewServeMux()
	registerPublishSessionHandlers(mux, nil)
	r := httptest.NewRequest(http.MethodPost, "/api/publish/status", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "publish-test"})
	r.Header.Set(csrfHeaderName, "publish-test")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "Publishing sessions are disabled for this host") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestPublishingSessionErrorsExposeOnlyReviewedDomainGuidance(t *testing.T) {
	supervisor := publishsession.New()
	t.Cleanup(func() { _ = supervisor.Close() })
	for _, test := range []struct {
		name    string
		service PublishSessionService
		body    string
		status  int
		message string
	}{
		{"validation", supervisor, `{"mode":"unknown","origin":"https://user:private-token@example.com/path?key=secret"}`, http.StatusConflict, "choose Quick Tunnel, private Serve or public Funnel"},
		{"unexpected provider", &fakePublishService{err: errors.New("native process private-token C:\\Users\\private\\credential.txt")}, `{}`, http.StatusConflict, "Publishing operation could not complete; check this session before retrying."},
		{"cancelled", &fakePublishService{err: context.Canceled}, `{}`, http.StatusRequestTimeout, "Publishing operation cancelled."},
		{"timeout", &fakePublishService{err: context.DeadlineExceeded}, `{}`, http.StatusGatewayTimeout, "Publishing operation timed out."},
	} {
		t.Run(test.name, func(t *testing.T) {
			mux := http.NewServeMux()
			registerPublishSessionHandlers(mux, test.service)
			r := httptest.NewRequest(http.MethodPost, "/api/publish/preview", strings.NewReader(test.body))
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "publish-test"})
			r.Header.Set(csrfHeaderName, "publish-test")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != test.status || strings.TrimSpace(w.Body.String()) != test.message {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("error response lost private response headers")
			}
		})
	}
}
