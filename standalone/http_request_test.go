package standalone

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestHTTPRequestHandlerSuccessHeadersAndBody(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read target request: %v", err)
		}
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		if got := r.Header.Get("X-Trace-ID"); got != "trace-1" {
			t.Errorf("X-Trace-ID = %q, want trace-1", got)
		}
		if string(body) != `{"name":"ProtoPeek"}` {
			t.Errorf("body = %q", body)
		}
		w.Header().Add("X-Reply", "one")
		w.Header().Add("X-Reply", "two")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))
	defer target.Close()

	res := performHTTPRequestHandler(t, HTTPRequest{
		Method:    http.MethodPatch,
		URL:       target.URL + "/resources/1",
		Headers:   []HTTPHeader{{Name: "X-Trace-ID", Value: "trace-1"}, {Name: "Content-Type", Value: "application/json"}},
		Body:      `{"name":"ProtoPeek"}`,
		TimeoutMs: 1000,
	}, "application/json; charset=utf-8")
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var got HTTPResponse
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.StatusCode != http.StatusCreated || got.Status != "201 Created" {
		t.Fatalf("HTTP status = %q (%d)", got.Status, got.StatusCode)
	}
	if got.Body != "created" || got.BodyEncoding != "text" || got.Bytes != 7 || got.Truncated {
		t.Fatalf("unexpected body metadata: %#v", got)
	}
	if got.Proto == "" || got.RemoteIP == "" {
		t.Fatalf("missing transport evidence: %#v", got)
	}
	if got.Timings.TotalMs < 0 {
		t.Fatalf("negative total timing: %#v", got.Timings)
	}
	if values := headerValues(got.Headers, "X-Reply"); len(values) != 2 {
		t.Fatalf("X-Reply values = %#v, want two values", values)
	}
}

func TestHTTPRequestRedirectPolicy(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/done", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte("done"))
	}))
	defer target.Close()

	withoutFollow, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL + "/start"})
	if err != nil {
		t.Fatalf("redirect-off request: %v", err)
	}
	if withoutFollow.StatusCode != http.StatusFound || len(withoutFollow.Redirects) != 1 {
		t.Fatalf("redirect-off response = %#v", withoutFollow)
	}

	withFollow, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL + "/start", FollowRedirects: true})
	if err != nil {
		t.Fatalf("redirect-on request: %v", err)
	}
	if withFollow.StatusCode != http.StatusOK || withFollow.Body != "done" || len(withFollow.Redirects) != 1 {
		t.Fatalf("redirect-on response = %#v", withFollow)
	}
}

func TestHTTPRequestRedirectStripsCredentialsAcrossOrigins(t *testing.T) {
	t.Parallel()

	type observedRequest struct {
		headers http.Header
		host    string
	}
	received := make(chan observedRequest, 1)
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- observedRequest{headers: r.Header.Clone(), host: r.Host}
		_, _ = w.Write([]byte("done"))
	}))
	defer destination.Close()

	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	result, err := executeHTTPRequest(context.Background(), HTTPRequest{
		Method: http.MethodPost,
		URL:    source.URL,
		Headers: []HTTPHeader{
			{Name: "Authorization", Value: "Bearer top-secret"},
			{Name: "Cookie", Value: "session=top-secret"},
			{Name: "X-API-Key", Value: "top-secret"},
			{Name: "Host", Value: "override.example.test"},
			{Name: "Accept", Value: "application/json"},
			{Name: "Content-Type", Value: "application/json"},
		},
		Body:            `{}`,
		FollowRedirects: true,
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if result.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", result.StatusCode)
	}
	observed := <-received
	headers := observed.headers
	for _, name := range []string{"Authorization", "Cookie", "X-API-Key"} {
		if value := headers.Get(name); value != "" {
			t.Fatalf("%s leaked across origins: %q", name, value)
		}
	}
	if got := headers.Get("Accept"); got != "application/json" {
		t.Fatalf("safe Accept header = %q", got)
	}
	if got := headers.Get("Content-Type"); got != "application/json" {
		t.Fatalf("safe Content-Type header = %q", got)
	}
	if observed.host == "override.example.test" {
		t.Fatalf("custom Host leaked across origins: %q", observed.host)
	}
}

func TestHTTPRequestRejectsRedirectCredentials(t *testing.T) {
	t.Parallel()

	reached := make(chan struct{}, 1)
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer destination.Close()
	destinationURL := strings.Replace(destination.URL, "http://", "http://user:password@", 1)

	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destinationURL, http.StatusFound)
	}))
	defer source.Close()

	_, err := executeHTTPRequest(context.Background(), HTTPRequest{
		URL:             source.URL,
		FollowRedirects: true,
	})
	var requestErr *httpRequestError
	if !errors.As(err, &requestErr) || requestErr.status != http.StatusBadRequest {
		t.Fatalf("error = %v, want HTTP 400", err)
	}
	select {
	case <-reached:
		t.Fatal("redirect destination received a request")
	default:
	}
}

func TestHTTPRedirectOriginAndDowngradePolicy(t *testing.T) {
	t.Parallel()

	parse := func(value string) *url.URL {
		t.Helper()
		parsed, err := url.Parse(value)
		if err != nil {
			t.Fatalf("parse %q: %v", value, err)
		}
		return parsed
	}
	if !sameHTTPOrigin(parse("https://example.test/path"), parse("https://EXAMPLE.test:443/next")) {
		t.Fatal("default HTTPS port should be the same origin")
	}
	if sameHTTPOrigin(parse("https://example.test"), parse("https://example.test:8443")) {
		t.Fatal("a changed port must be a different origin")
	}
	if err := validateHTTPRedirectTarget(parse("https://example.test"), parse("http://example.test")); err == nil {
		t.Fatal("HTTPS downgrade unexpectedly accepted")
	}
}

func TestHTTPRequestRejectsUnsupportedSchemeAndURLCredentials(t *testing.T) {
	t.Parallel()

	for _, target := range []string{"ftp://example.test/file", "http://user:pass@example.test/"} {
		target := target
		t.Run(target, func(t *testing.T) {
			t.Parallel()
			_, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target})
			var requestErr *httpRequestError
			if !errors.As(err, &requestErr) || requestErr.status != http.StatusBadRequest {
				t.Fatalf("error = %v, want HTTP 400 request error", err)
			}
		})
	}
}

func TestHTTPRequestTimeoutAndCancellation(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(250 * time.Millisecond):
			_, _ = w.Write([]byte("late"))
		case <-r.Context().Done():
		}
	}))
	defer target.Close()

	_, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL, TimeoutMs: 20})
	var timeoutErr *httpRequestError
	if !errors.As(err, &timeoutErr) || timeoutErr.status != http.StatusGatewayTimeout {
		t.Fatalf("timeout error = %v, want HTTP 504", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = executeHTTPRequest(ctx, HTTPRequest{URL: target.URL})
	var cancelErr *httpRequestError
	if !errors.As(err, &cancelErr) || cancelErr.status != 499 {
		t.Fatalf("cancel error = %v, want HTTP 499", err)
	}
}

func TestHTTPRequestResponseTruncationAndBinaryEncoding(t *testing.T) {
	t.Parallel()

	t.Run("truncates text", func(t *testing.T) {
		t.Parallel()
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			_, _ = io.CopyN(w, strings.NewReader(strings.Repeat("a", maxHTTPResponseBodyBytes+1)), maxHTTPResponseBodyBytes+1)
		}))
		defer target.Close()

		got, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL})
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		if !got.Truncated || got.Bytes != maxHTTPResponseBodyBytes || len(got.Body) != maxHTTPResponseBodyBytes {
			t.Fatalf("truncation metadata = truncated %v, bytes %d, body length %d", got.Truncated, got.Bytes, len(got.Body))
		}
	})

	t.Run("encodes binary", func(t *testing.T) {
		t.Parallel()
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write([]byte{0, 1, 2, 255})
		}))
		defer target.Close()

		got, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL})
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		if got.BodyEncoding != "base64" || got.Body != base64.StdEncoding.EncodeToString([]byte{0, 1, 2, 255}) {
			t.Fatalf("binary response = %#v", got)
		}
	})
}

func TestHTTPRequestLimitsAndContentType(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	tooLarge := performHTTPRequestHandler(t, HTTPRequest{
		URL:  target.URL,
		Body: strings.Repeat("x", maxHTTPRequestBodyBytes+1),
	}, "application/json")
	if tooLarge.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body status = %d, body = %s", tooLarge.Code, tooLarge.Body.String())
	}

	wrongType := performHTTPRequestHandler(t, HTTPRequest{URL: target.URL}, "text/plain")
	if wrongType.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("wrong content type status = %d", wrongType.Code)
	}

	oversizedEnvelope := httptest.NewRequest(http.MethodPost, "/api/http/request", strings.NewReader(strings.Repeat(" ", maxHTTPRequestEnvelopeBytes+1)))
	oversizedEnvelope.Header.Set("Content-Type", "application/json")
	oversizedResponse := httptest.NewRecorder()
	HTTPRequestHandler().ServeHTTP(oversizedResponse, oversizedEnvelope)
	if oversizedResponse.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large envelope status = %d, body = %s", oversizedResponse.Code, oversizedResponse.Body.String())
	}

	_, err := executeHTTPRequest(context.Background(), HTTPRequest{
		URL:       target.URL,
		TimeoutMs: int64(^uint64(0) >> 1),
	})
	var timeoutErr *httpRequestError
	if !errors.As(err, &timeoutErr) || timeoutErr.status != http.StatusBadRequest {
		t.Fatalf("overflowing timeout error = %v, want HTTP 400", err)
	}
}

func TestHTTPRequestRejectsMalformedHeadersBeforeDispatch(t *testing.T) {
	t.Parallel()

	reached := make(chan struct{}, 3)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	for _, header := range []HTTPHeader{
		{Name: "Bad Header", Value: "value"},
		{Name: "X-Test", Value: "value\r\ninjected: yes"},
		{Name: "Host", Value: "bad host"},
	} {
		_, err := executeHTTPRequest(context.Background(), HTTPRequest{
			URL:     target.URL,
			Headers: []HTTPHeader{header},
		})
		var requestErr *httpRequestError
		if !errors.As(err, &requestErr) || requestErr.status != http.StatusBadRequest {
			t.Fatalf("header %#v error = %v, want HTTP 400", header, err)
		}
	}
	select {
	case <-reached:
		t.Fatal("target received a malformed-header request")
	default:
	}
}

func TestHTTPRequestKeepsTLSVerificationEnabled(t *testing.T) {
	t.Parallel()

	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("unsafe"))
	}))
	defer target.Close()

	_, err := executeHTTPRequest(context.Background(), HTTPRequest{URL: target.URL})
	var requestErr *httpRequestError
	if !errors.As(err, &requestErr) || requestErr.status != http.StatusBadGateway {
		t.Fatalf("TLS error = %v, want verification failure", err)
	}
}

func performHTTPRequestHandler(t *testing.T, input HTTPRequest, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/http/request", bytes.NewReader(payload))
	req.Header.Set("Content-Type", contentType)
	res := httptest.NewRecorder()
	HTTPRequestHandler().ServeHTTP(res, req)
	return res
}

func headerValues(headers []HTTPHeader, name string) []string {
	values := make([]string, 0)
	for _, header := range headers {
		if strings.EqualFold(header.Name, name) {
			values = append(values, header.Value)
		}
	}
	return values
}
