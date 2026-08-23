// Package webobserve provides one explicit, bounded HTTP/TLS observation for
// a public website. It does no work until Observe is called and never follows
// redirects, sends credentials, reads a response body, or contacts private
// address space.
package webobserve

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

const defaultWallTimeout = 15 * time.Second

type Options struct {
	Policy   targetguard.Policy
	Resolver targetguard.Resolver
	Timeout  time.Duration
}

type Observer struct {
	guard   *targetguard.Guard
	timeout time.Duration
	now     func() time.Time
}

type Result struct {
	ObservedAt time.Time      `json:"observedAt"`
	URL        string         `json:"url"`
	Method     string         `json:"method"`
	DNS        DNSEvidence    `json:"dns"`
	HTTP       HTTPEvidence   `json:"http"`
	TLS        *TLSEvidence   `json:"tls,omitempty"`
	Timings    TimingEvidence `json:"timings"`
}

type DNSEvidence struct {
	Hostname        string   `json:"hostname"`
	PinnedAddresses []string `json:"pinnedAddresses"`
	ResolutionMS    float64  `json:"resolutionMs"`
}

type HTTPEvidence struct {
	StatusCode       int                 `json:"statusCode"`
	Status           string              `json:"status"`
	Protocol         string              `json:"protocol"`
	Headers          map[string][]string `json:"headers"`
	RedirectLocation string              `json:"redirectLocation,omitempty"`
}

type TLSEvidence struct {
	Version            string    `json:"version"`
	CipherSuite        string    `json:"cipherSuite"`
	NegotiatedProtocol string    `json:"negotiatedProtocol,omitempty"`
	ServerName         string    `json:"serverName"`
	Subject            string    `json:"subject"`
	Issuer             string    `json:"issuer"`
	NotBefore          time.Time `json:"notBefore"`
	NotAfter           time.Time `json:"notAfter"`
	DNSNames           []string  `json:"dnsNames"`
	VerifiedChains     int       `json:"verifiedChains"`
}

type TimingEvidence struct {
	ConnectMS      *float64 `json:"connectMs,omitempty"`
	TLSHandshakeMS *float64 `json:"tlsHandshakeMs,omitempty"`
	FirstByteMS    *float64 `json:"firstByteMs,omitempty"`
	TotalMS        float64  `json:"totalMs"`
}

func New(options Options) (*Observer, error) {
	if options.Timeout == 0 {
		options.Timeout = defaultWallTimeout
	}
	if options.Timeout < time.Second || options.Timeout > 30*time.Second {
		return nil, fmt.Errorf("website observation timeout must be between 1 and 30 seconds")
	}
	guard, err := targetguard.New(targetguard.Config{Policy: options.Policy, Resolver: options.Resolver})
	if err != nil {
		return nil, err
	}
	return &Observer{guard: guard, timeout: options.Timeout, now: time.Now}, nil
}

// Observe makes one credential-free HEAD request to the normalized target.
// Redirects are returned as evidence and are never followed.
func (observer *Observer) Observe(parent context.Context, rawURL string) (Result, error) {
	started := observer.now()
	ctx, cancel := context.WithTimeout(parent, observer.timeout)
	defer cancel()

	parsedInput, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return Result{}, fmt.Errorf("%w: URL must be valid", targetguard.ErrInvalidTarget)
	}
	if parsedInput.RawQuery != "" || parsedInput.ForceQuery || parsedInput.Fragment != "" {
		return Result{}, fmt.Errorf("%w: website observation URLs cannot contain a query or fragment", targetguard.ErrInvalidTarget)
	}

	resolutionStarted := observer.now()
	session, err := observer.guard.NewSession(ctx, parsedInput.String(), targetguard.SessionConfig{
		Redirect:  targetguard.RedirectPolicy{MaxRedirects: 0},
		Transport: targetguard.TransportOptions{},
	})
	if err != nil {
		return Result{}, err
	}
	defer session.CloseIdleConnections()
	resolutionEnded := observer.now()

	trace := newTimingTrace(observer.now, started)
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, session.InitialURL().String(), nil)
	if err != nil {
		return Result{}, fmt.Errorf("create website observation: %w", err)
	}
	request.Header.Set("Accept", "*/*")
	request.Header.Set("User-Agent", "ProtoPeek website observation")
	request = request.WithContext(httptrace.WithClientTrace(request.Context(), trace.clientTrace()))

	response, err := session.Client().Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("observe website: %w", err)
	}
	_ = response.Body.Close()
	finished := observer.now()

	addresses := session.InitialAddresses()
	pinned := make([]string, 0, len(addresses))
	for _, address := range addresses {
		pinned = append(pinned, address.Unmap().String())
	}
	sort.Strings(pinned)

	result := Result{
		ObservedAt: finished.UTC(),
		URL:        safeObservedURL(session.InitialURL()),
		Method:     http.MethodHead,
		DNS: DNSEvidence{
			Hostname:        session.InitialURL().Hostname(),
			PinnedAddresses: pinned,
			ResolutionMS:    milliseconds(resolutionEnded.Sub(resolutionStarted)),
		},
		HTTP: HTTPEvidence{
			StatusCode:       response.StatusCode,
			Status:           boundedString(response.Status, 128),
			Protocol:         boundedString(response.Proto, 32),
			Headers:          selectedHeaders(response.Header),
			RedirectLocation: safeRedirectLocation(session.InitialURL(), response.Header.Get("Location")),
		},
		TLS:     tlsEvidence(response.TLS),
		Timings: trace.result(finished),
	}
	return result, nil
}

type timingTrace struct {
	now            func() time.Time
	started        time.Time
	connectStarted time.Time
	connectDone    time.Time
	tlsStarted     time.Time
	tlsDone        time.Time
	firstByte      time.Time
}

func newTimingTrace(now func() time.Time, started time.Time) *timingTrace {
	return &timingTrace{now: now, started: started}
}

func (trace *timingTrace) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		ConnectStart:         func(_, _ string) { trace.connectStarted = trace.now() },
		ConnectDone:          func(_, _ string, _ error) { trace.connectDone = trace.now() },
		TLSHandshakeStart:    func() { trace.tlsStarted = trace.now() },
		TLSHandshakeDone:     func(tls.ConnectionState, error) { trace.tlsDone = trace.now() },
		GotFirstResponseByte: func() { trace.firstByte = trace.now() },
	}
}

func (trace *timingTrace) result(finished time.Time) TimingEvidence {
	return TimingEvidence{
		ConnectMS:      durationBetween(trace.connectStarted, trace.connectDone),
		TLSHandshakeMS: durationBetween(trace.tlsStarted, trace.tlsDone),
		FirstByteMS:    durationBetween(trace.started, trace.firstByte),
		TotalMS:        milliseconds(finished.Sub(trace.started)),
	}
}

func durationBetween(start, end time.Time) *float64 {
	if start.IsZero() || end.IsZero() || end.Before(start) {
		return nil
	}
	value := milliseconds(end.Sub(start))
	return &value
}

func milliseconds(duration time.Duration) float64 {
	if duration < 0 {
		return 0
	}
	return float64(duration.Microseconds()) / 1000
}

var retainedHeaders = map[string]struct{}{
	"Age": {}, "Cache-Control": {}, "Content-Length": {}, "Content-Security-Policy": {},
	"Content-Type": {}, "Date": {}, "ETag": {}, "Expires": {}, "Last-Modified": {},
	"Permissions-Policy": {}, "Referrer-Policy": {}, "Server": {},
	"Strict-Transport-Security": {}, "Vary": {}, "Via": {}, "X-Content-Type-Options": {},
	"X-Frame-Options": {},
}

func selectedHeaders(headers http.Header) map[string][]string {
	result := make(map[string][]string)
	for name := range retainedHeaders {
		values := headers.Values(name)
		if len(values) == 0 {
			continue
		}
		if len(values) > 8 {
			values = values[:8]
		}
		bounded := make([]string, 0, len(values))
		for _, value := range values {
			bounded = append(bounded, boundedString(value, 2048))
		}
		result[name] = bounded
	}
	return result
}

func safeRedirectLocation(base *url.URL, raw string) string {
	if base == nil || strings.TrimSpace(raw) == "" || len(raw) > 8*1024 {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(parsed)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	resolved.User = nil
	resolved.RawQuery = ""
	resolved.Fragment = ""
	return boundedString(resolved.String(), 8*1024)
}

func safeObservedURL(input *url.URL) string {
	if input == nil {
		return ""
	}
	value := *input
	value.User = nil
	query := value.Query()
	for key := range query {
		switch strings.ToLower(key) {
		case "access_token", "api_key", "apikey", "auth", "credential", "key", "password", "secret", "signature", "sig", "token":
			query.Set(key, "[redacted]")
		}
	}
	value.RawQuery = query.Encode()
	value.Fragment = ""
	value.RawFragment = ""
	return boundedString(value.String(), 8*1024)
}

func tlsEvidence(state *tls.ConnectionState) *TLSEvidence {
	if state == nil || len(state.PeerCertificates) == 0 {
		return nil
	}
	certificate := state.PeerCertificates[0]
	dnsNames := append([]string(nil), certificate.DNSNames...)
	if len(dnsNames) > 64 {
		dnsNames = dnsNames[:64]
	}
	for index := range dnsNames {
		dnsNames[index] = boundedString(dnsNames[index], 253)
	}
	return &TLSEvidence{
		Version:            tlsVersion(state.Version),
		CipherSuite:        tls.CipherSuiteName(state.CipherSuite),
		NegotiatedProtocol: boundedString(state.NegotiatedProtocol, 64),
		ServerName:         boundedString(state.ServerName, 253),
		Subject:            boundedString(certificate.Subject.String(), 2048),
		Issuer:             boundedString(certificate.Issuer.String(), 2048),
		NotBefore:          certificate.NotBefore.UTC(),
		NotAfter:           certificate.NotAfter.UTC(),
		DNSNames:           dnsNames,
		VerifiedChains:     len(state.VerifiedChains),
	}
}

func tlsVersion(version uint16) string {
	switch version {
	case tls.VersionTLS13:
		return "TLS 1.3"
	case tls.VersionTLS12:
		return "TLS 1.2"
	default:
		return "0x" + strconv.FormatUint(uint64(version), 16)
	}
}

func boundedString(value string, maximum int) string {
	if len(value) <= maximum {
		return value
	}
	return value[:maximum]
}
