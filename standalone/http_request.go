package standalone

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/net/http/httpguts"
)

const (
	maxHTTPRequestEnvelopeBytes = 2 << 20
	maxHTTPRequestBodyBytes     = 1 << 20
	maxHTTPResponseBodyBytes    = 4 << 20
	maxHTTPHeaderCount          = 128
	maxHTTPRedirects            = 10
	defaultHTTPRequestTimeout   = 30 * time.Second
	maxHTTPRequestTimeout       = 2 * time.Minute
)

// HTTPHeader preserves repeated request and response header fields in JSON.
type HTTPHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// HTTPRequest describes one bounded HTTP/REST request from the browser workbench.
type HTTPRequest struct {
	Method          string       `json:"method"`
	URL             string       `json:"url"`
	Headers         []HTTPHeader `json:"headers"`
	Body            string       `json:"body"`
	TimeoutMs       int64        `json:"timeoutMs"`
	FollowRedirects bool         `json:"followRedirects"`
}

type HTTPRedirect struct {
	URL        string `json:"url"`
	Status     string `json:"status"`
	StatusCode int    `json:"statusCode"`
	Location   string `json:"location"`
}

type HTTPTimings struct {
	DNSMs     float64 `json:"dnsMs"`
	ConnectMs float64 `json:"connectMs"`
	TLSMs     float64 `json:"tlsMs"`
	TTFBMs    float64 `json:"ttfbMs"`
	TotalMs   float64 `json:"totalMs"`
}

type HTTPTLSSummary struct {
	Version       string `json:"version"`
	CipherSuite   string `json:"cipherSuite"`
	ServerName    string `json:"serverName"`
	PeerSubject   string `json:"peerSubject"`
	PeerExpiresAt string `json:"peerExpiresAt"`
	Verified      bool   `json:"verified"`
}

// HTTPResponse keeps HTTP-native evidence visible instead of flattening it
// into the gRPC response model.
type HTTPResponse struct {
	Status       string          `json:"status"`
	StatusCode   int             `json:"statusCode"`
	Proto        string          `json:"proto"`
	Headers      []HTTPHeader    `json:"headers"`
	Body         string          `json:"body"`
	BodyEncoding string          `json:"bodyEncoding"`
	Bytes        int             `json:"bytes"`
	Truncated    bool            `json:"truncated"`
	Redirects    []HTTPRedirect  `json:"redirects"`
	RemoteIP     string          `json:"remoteIp"`
	TLS          *HTTPTLSSummary `json:"tls"`
	Timings      HTTPTimings     `json:"timings"`
}

type httpRequestError struct {
	status int
	msg    string
	err    error
}

func (e *httpRequestError) Error() string {
	if e.err == nil {
		return e.msg
	}
	return fmt.Sprintf("%s: %v", e.msg, e.err)
}

func (e *httpRequestError) Unwrap() error { return e.err }

// HTTPRequestHandler returns the POST endpoint used by the HTTP workbench.
// The caller remains responsible for the same local-access and CSRF wrappers
// used by the rest of the embedded console.
func HTTPRequestHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		var input HTTPRequest
		if !decodeJSONRequest(w, r, maxHTTPRequestEnvelopeBytes, &input) {
			return
		}

		result, err := executeHTTPRequest(r.Context(), input)
		if err != nil {
			status := http.StatusBadGateway
			var requestErr *httpRequestError
			if errors.As(err, &requestErr) {
				status = requestErr.status
			}
			http.Error(w, err.Error(), status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

func executeHTTPRequest(parent context.Context, input HTTPRequest) (*HTTPResponse, error) {
	method := strings.ToUpper(strings.TrimSpace(input.Method))
	if method == "" {
		method = http.MethodGet
	}

	target, err := url.Parse(strings.TrimSpace(input.URL))
	if err != nil || target.Host == "" {
		return nil, &httpRequestError{status: http.StatusBadRequest, msg: "URL must be absolute"}
	}
	target.Scheme = strings.ToLower(target.Scheme)
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, &httpRequestError{status: http.StatusBadRequest, msg: "URL scheme must be http or https"}
	}
	if target.User != nil {
		return nil, &httpRequestError{status: http.StatusBadRequest, msg: "Credentials are not allowed in URLs; use the Auth or Headers tab"}
	}
	if target.Fragment != "" {
		return nil, &httpRequestError{status: http.StatusBadRequest, msg: "URL fragments are not sent in HTTP requests"}
	}
	if len(input.Body) > maxHTTPRequestBodyBytes {
		return nil, &httpRequestError{status: http.StatusRequestEntityTooLarge, msg: fmt.Sprintf("HTTP request body exceeds %d bytes", maxHTTPRequestBodyBytes)}
	}
	if len(input.Headers) > maxHTTPHeaderCount {
		return nil, &httpRequestError{status: http.StatusRequestEntityTooLarge, msg: fmt.Sprintf("HTTP request has more than %d header fields", maxHTTPHeaderCount)}
	}

	timeout := defaultHTTPRequestTimeout
	if input.TimeoutMs != 0 {
		if input.TimeoutMs < 1 || input.TimeoutMs > maxHTTPRequestTimeout.Milliseconds() {
			return nil, &httpRequestError{status: http.StatusBadRequest, msg: fmt.Sprintf("timeoutMs must be between 1 and %d", maxHTTPRequestTimeout.Milliseconds())}
		}
		timeout = time.Duration(input.TimeoutMs) * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	recorder := newHTTPTimingRecorder()
	ctx = httptrace.WithClientTrace(ctx, recorder.trace())
	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewBufferString(input.Body))
	if err != nil {
		return nil, &httpRequestError{status: http.StatusBadRequest, msg: "Invalid HTTP request", err: err}
	}
	for _, header := range input.Headers {
		name := strings.TrimSpace(header.Name)
		if name == "" {
			continue
		}
		if len(name) > 256 || len(header.Value) > 16<<10 {
			return nil, &httpRequestError{status: http.StatusRequestEntityTooLarge, msg: "HTTP header name or value is too large"}
		}
		if !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(header.Value) {
			return nil, &httpRequestError{status: http.StatusBadRequest, msg: fmt.Sprintf("Invalid HTTP header %q", name)}
		}
		if strings.EqualFold(name, "Host") {
			host := strings.TrimSpace(header.Value)
			if host == "" || !httpguts.ValidHostHeader(host) {
				return nil, &httpRequestError{status: http.StatusBadRequest, msg: "Invalid HTTP Host header"}
			}
			req.Host = host
			continue
		}
		req.Header.Add(name, header.Value)
	}

	redirects := make([]HTTPRedirect, 0)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ForceAttemptHTTP2 = true
	transport.MaxResponseHeaderBytes = 1 << 20
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if response := req.Response; response != nil {
				redirects = append(redirects, HTTPRedirect{
					URL:        response.Request.URL.String(),
					Status:     response.Status,
					StatusCode: response.StatusCode,
					Location:   response.Header.Get("Location"),
				})
			}
			if !input.FollowRedirects {
				return http.ErrUseLastResponse
			}
			if len(via) >= maxHTTPRedirects {
				return &httpRequestError{status: http.StatusBadRequest, msg: fmt.Sprintf("Stopped after %d redirects", maxHTTPRedirects)}
			}
			previous := via[len(via)-1]
			if err := validateHTTPRedirectTarget(previous.URL, req.URL); err != nil {
				return err
			}
			if !sameHTTPOrigin(previous.URL, req.URL) {
				req.Header = safeCrossOriginRedirectHeaders(req.Header)
				req.Host = ""
			}
			return nil
		},
	}
	defer transport.CloseIdleConnections()

	started := time.Now()
	recorder.requestStarted = started
	resp, err := client.Do(req)
	if err != nil {
		return nil, classifyHTTPClientError(ctx, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHTTPResponseBodyBytes+1))
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, classifyHTTPClientError(ctx, ctxErr)
		}
		return nil, &httpRequestError{status: http.StatusBadGateway, msg: "Failed to read HTTP response", err: err}
	}
	truncated := len(body) > maxHTTPResponseBodyBytes
	if truncated {
		body = body[:maxHTTPResponseBodyBytes]
	}

	encoding := "text"
	bodyValue := string(body)
	if !isTextualHTTPBody(resp.Header.Get("Content-Type"), body) {
		encoding = "base64"
		bodyValue = base64.StdEncoding.EncodeToString(body)
	}

	timings, remoteIP := recorder.snapshot(time.Since(started))
	return &HTTPResponse{
		Status:       resp.Status,
		StatusCode:   resp.StatusCode,
		Proto:        resp.Proto,
		Headers:      flattenHTTPHeaders(resp.Header),
		Body:         bodyValue,
		BodyEncoding: encoding,
		Bytes:        len(body),
		Truncated:    truncated,
		Redirects:    redirects,
		RemoteIP:     remoteIP,
		TLS:          summarizeTLS(resp.TLS),
		Timings:      timings,
	}, nil
}

func classifyHTTPClientError(ctx context.Context, err error) error {
	var requestErr *httpRequestError
	if errors.As(err, &requestErr) {
		return requestErr
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return &httpRequestError{status: 499, msg: "HTTP request cancelled", err: context.Canceled}
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return &httpRequestError{status: http.StatusGatewayTimeout, msg: "HTTP request timed out", err: context.DeadlineExceeded}
	}
	return &httpRequestError{status: http.StatusBadGateway, msg: "HTTP request failed", err: err}
}

func sameHTTPOrigin(left, right *url.URL) bool {
	return httpOrigin(left) == httpOrigin(right)
}

func validateHTTPRedirectTarget(previous, next *url.URL) error {
	if scheme := strings.ToLower(next.Scheme); scheme != "http" && scheme != "https" {
		return &httpRequestError{status: http.StatusBadRequest, msg: "Redirect URL scheme must be http or https"}
	}
	if next.User != nil {
		return &httpRequestError{status: http.StatusBadRequest, msg: "Redirect URL credentials are not allowed"}
	}
	if strings.EqualFold(previous.Scheme, "https") && strings.EqualFold(next.Scheme, "http") {
		return &httpRequestError{status: http.StatusBadRequest, msg: "HTTPS redirects cannot downgrade to HTTP"}
	}
	return nil
}

func httpOrigin(value *url.URL) string {
	scheme := strings.ToLower(value.Scheme)
	port := value.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}
	return scheme + "://" + net.JoinHostPort(strings.ToLower(value.Hostname()), port)
}

func safeCrossOriginRedirectHeaders(headers http.Header) http.Header {
	safe := http.Header{}
	for _, name := range []string{
		"Accept",
		"Accept-Encoding",
		"Accept-Language",
		"Cache-Control",
		"Content-Type",
		"User-Agent",
	} {
		for _, value := range headers.Values(name) {
			safe.Add(name, value)
		}
	}
	return safe
}

func flattenHTTPHeaders(headers http.Header) []HTTPHeader {
	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]HTTPHeader, 0, len(headers))
	for _, key := range keys {
		for _, value := range headers.Values(key) {
			result = append(result, HTTPHeader{Name: key, Value: value})
		}
	}
	return result
}

func isTextualHTTPBody(contentType string, body []byte) bool {
	if !utf8.Valid(body) || bytes.IndexByte(body, 0) >= 0 {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		return true
	}
	mediaType = strings.ToLower(mediaType)
	return strings.HasPrefix(mediaType, "text/") ||
		strings.Contains(mediaType, "json") ||
		strings.Contains(mediaType, "xml") ||
		strings.Contains(mediaType, "javascript") ||
		mediaType == "application/x-www-form-urlencoded" ||
		mediaType == "image/svg+xml"
}

func summarizeTLS(state *tls.ConnectionState) *HTTPTLSSummary {
	if state == nil {
		return nil
	}
	summary := &HTTPTLSSummary{
		Version:     tlsVersionName(state.Version),
		CipherSuite: tls.CipherSuiteName(state.CipherSuite),
		ServerName:  state.ServerName,
		Verified:    len(state.VerifiedChains) > 0,
	}
	if len(state.PeerCertificates) > 0 {
		peer := state.PeerCertificates[0]
		summary.PeerSubject = peer.Subject.String()
		summary.PeerExpiresAt = peer.NotAfter.UTC().Format(time.RFC3339)
	}
	return summary
}

func tlsVersionName(version uint16) string {
	switch version {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("0x%04x", version)
	}
}

type httpTimingRecorder struct {
	mu sync.Mutex

	dnsStarted     time.Time
	connectStarted map[string]time.Time
	tlsStarted     time.Time
	requestStarted time.Time
	dnsDuration    time.Duration
	connectTime    time.Duration
	tlsDuration    time.Duration
	ttfb           time.Duration
	remoteIP       string
}

func newHTTPTimingRecorder() *httpTimingRecorder {
	return &httpTimingRecorder{connectStarted: make(map[string]time.Time)}
}

func (r *httpTimingRecorder) trace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) {
			r.mu.Lock()
			r.dnsStarted = time.Now()
			r.mu.Unlock()
		},
		DNSDone: func(httptrace.DNSDoneInfo) {
			r.mu.Lock()
			if !r.dnsStarted.IsZero() {
				r.dnsDuration += time.Since(r.dnsStarted)
				r.dnsStarted = time.Time{}
			}
			r.mu.Unlock()
		},
		ConnectStart: func(network, addr string) {
			r.mu.Lock()
			r.connectStarted[network+"\x00"+addr] = time.Now()
			r.mu.Unlock()
		},
		ConnectDone: func(network, addr string, _ error) {
			r.mu.Lock()
			key := network + "\x00" + addr
			if started := r.connectStarted[key]; !started.IsZero() {
				r.connectTime += time.Since(started)
				delete(r.connectStarted, key)
			}
			r.mu.Unlock()
		},
		TLSHandshakeStart: func() {
			r.mu.Lock()
			r.tlsStarted = time.Now()
			r.mu.Unlock()
		},
		TLSHandshakeDone: func(tls.ConnectionState, error) {
			r.mu.Lock()
			if !r.tlsStarted.IsZero() {
				r.tlsDuration += time.Since(r.tlsStarted)
				r.tlsStarted = time.Time{}
			}
			r.mu.Unlock()
		},
		GotConn: func(info httptrace.GotConnInfo) {
			r.mu.Lock()
			r.remoteIP = remoteHost(info.Conn.RemoteAddr())
			r.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			r.mu.Lock()
			if !r.requestStarted.IsZero() {
				r.ttfb = time.Since(r.requestStarted)
			}
			r.mu.Unlock()
		},
	}
}

func (r *httpTimingRecorder) snapshot(total time.Duration) (HTTPTimings, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return HTTPTimings{
		DNSMs:     durationMilliseconds(r.dnsDuration),
		ConnectMs: durationMilliseconds(r.connectTime),
		TLSMs:     durationMilliseconds(r.tlsDuration),
		TTFBMs:    durationMilliseconds(r.ttfb),
		TotalMs:   durationMilliseconds(total),
	}, r.remoteIP
}

func durationMilliseconds(value time.Duration) float64 {
	return float64(value.Microseconds()) / 1000
}

func remoteHost(address net.Addr) string {
	if address == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(address.String())
	if err == nil {
		return host
	}
	return address.String()
}
