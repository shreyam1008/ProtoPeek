package targetguard

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/publicsuffix"
)

const hardMaxRedirects = 10

var (
	ErrRedirectDowngrade = errors.New("HTTPS redirect downgrade is blocked")
	ErrCrossSiteRedirect = errors.New("cross-site redirect requires explicit approval")
	ErrRedirectLimit     = errors.New("redirect limit reached")
)

type RedirectPolicy struct {
	MaxRedirects   int
	AllowCrossSite bool
}

type TransportOptions struct {
	TLSHandshakeTimeout    time.Duration
	ResponseHeaderTimeout  time.Duration
	MaxResponseHeaderBytes int64
}

type SessionConfig struct {
	Redirect  RedirectPolicy
	Transport TransportOptions
}

// Session owns a proxy-disabled HTTP client and the immutable pin set approved
// for one redirect chain.
type Session struct {
	guard      *Guard
	redirect   RedirectPolicy
	transport  *http.Transport
	client     *http.Client
	pinsMu     sync.RWMutex
	pins       map[string]*Target
	initial    *Target
	initialURL url.URL
}

func (guard *Guard) NewSession(ctx context.Context, input string, config SessionConfig) (*Session, error) {
	if config.Redirect.MaxRedirects < 0 || config.Redirect.MaxRedirects > hardMaxRedirects {
		return nil, fmt.Errorf("%w: max redirects must be between 0 and %d", ErrInvalidTarget, hardMaxRedirects)
	}
	initial, err := guard.ResolveAndPin(ctx, input)
	if err != nil {
		return nil, err
	}
	tlsTimeout := config.Transport.TLSHandshakeTimeout
	if tlsTimeout == 0 {
		tlsTimeout = 5 * time.Second
	}
	headerTimeout := config.Transport.ResponseHeaderTimeout
	if headerTimeout == 0 {
		headerTimeout = 10 * time.Second
	}
	maxHeaders := config.Transport.MaxResponseHeaderBytes
	if maxHeaders == 0 {
		maxHeaders = 256 << 10
	}
	if tlsTimeout < 0 || headerTimeout < 0 || maxHeaders < 1 || maxHeaders > 1<<20 {
		return nil, fmt.Errorf("%w: invalid transport bounds", ErrInvalidTarget)
	}

	session := &Session{
		guard:      guard,
		redirect:   config.Redirect,
		pins:       make(map[string]*Target),
		initial:    initial,
		initialURL: *initial.URL(),
	}
	session.register(initial)
	session.transport = &http.Transport{
		Proxy:                  nil,
		DialContext:            session.dialContext,
		ForceAttemptHTTP2:      true,
		DisableCompression:     true,
		DisableKeepAlives:      true,
		MaxConnsPerHost:        2,
		TLSHandshakeTimeout:    tlsTimeout,
		ResponseHeaderTimeout:  headerTimeout,
		ExpectContinueTimeout:  time.Second,
		MaxResponseHeaderBytes: maxHeaders,
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
	}
	session.client = &http.Client{
		Transport:     session.transport,
		CheckRedirect: session.checkRedirect,
	}
	return session, nil
}

func (session *Session) InitialURL() *url.URL {
	value := session.initialURL
	return &value
}

// InitialAddresses returns a copy of the complete DNS answer set that was
// approved and pinned before this session could make a request.
func (session *Session) InitialAddresses() []netip.Addr {
	if session.initial == nil {
		return nil
	}
	return session.initial.Addresses()
}

func (session *Session) Client() *http.Client { return session.client }

func (session *Session) CloseIdleConnections() {
	session.transport.CloseIdleConnections()
}

func (session *Session) register(target *Target) {
	session.pinsMu.Lock()
	defer session.pinsMu.Unlock()
	session.pins[target.authority()] = target
}

func (session *Session) targetForAuthority(authority string) *Target {
	session.pinsMu.RLock()
	defer session.pinsMu.RUnlock()
	return session.pins[authority]
}

func (session *Session) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("%w: expected host:port", ErrUnpinnedAddress)
	}
	host, err = NormalizeHostname(strings.Trim(host, "[]"))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid transport hostname", ErrUnpinnedAddress)
	}
	target := session.targetForAuthority(net.JoinHostPort(host, port))
	if target == nil {
		return nil, fmt.Errorf("%w: %s", ErrUnpinnedAddress, net.JoinHostPort(host, port))
	}
	return session.guard.dialTarget(ctx, network, target)
}

func (session *Session) checkRedirect(request *http.Request, via []*http.Request) error {
	if len(via) == 0 {
		return fmt.Errorf("%w: missing previous request", ErrInvalidTarget)
	}
	if session.redirect.MaxRedirects == 0 {
		// Returning ErrUseLastResponse keeps the original redirect response
		// visible to an evidence-only caller without resolving or contacting the
		// Location target.
		return http.ErrUseLastResponse
	}
	if len(via) > session.redirect.MaxRedirects {
		return ErrRedirectLimit
	}
	previousURL := via[len(via)-1].URL
	previousHost, err := NormalizeHostname(previousURL.Hostname())
	if err != nil {
		return err
	}
	previousPort := previousURL.Port()
	if previousPort == "" {
		if strings.EqualFold(previousURL.Scheme, "https") {
			previousPort = "443"
		} else {
			previousPort = "80"
		}
	}
	previous := session.targetForAuthority(net.JoinHostPort(previousHost, previousPort))
	if previous == nil {
		return fmt.Errorf("%w: previous redirect target was not pinned", ErrUnpinnedAddress)
	}
	next, err := session.guard.ValidateRedirect(request.Context(), previous, request.URL, session.redirect)
	if err != nil {
		return err
	}
	session.register(next)
	if !sameOrigin(previous.URL(), next.URL()) {
		stripSensitiveRedirectHeaders(request.Header)
	}
	request.URL = next.URL()
	request.Host = ""
	return nil
}

// ValidateRedirect re-normalizes and re-resolves every redirect destination.
// It rejects HTTPS downgrade before DNS and blocks cross-site movement unless
// the caller separately approved it.
func (guard *Guard) ValidateRedirect(ctx context.Context, previous *Target, nextURL *url.URL, policy RedirectPolicy) (*Target, error) {
	if previous == nil || nextURL == nil {
		return nil, fmt.Errorf("%w: redirect endpoints are required", ErrInvalidTarget)
	}
	normalized, err := NormalizeURL(nextURL.String())
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(previous.url.Scheme, "https") && normalized.Scheme == "http" {
		return nil, ErrRedirectDowngrade
	}
	if !policy.AllowCrossSite && !SameSite(previous.URL(), normalized) {
		return nil, ErrCrossSiteRedirect
	}
	return guard.ResolveAndPinURL(ctx, normalized)
}

// SameSite compares registrable domains. IP literals must match exactly.
func SameSite(left, right *url.URL) bool {
	if left == nil || right == nil {
		return false
	}
	leftHost, leftErr := NormalizeHostname(left.Hostname())
	rightHost, rightErr := NormalizeHostname(right.Hostname())
	if leftErr != nil || rightErr != nil {
		return false
	}
	leftIP := net.ParseIP(leftHost)
	rightIP := net.ParseIP(rightHost)
	if leftIP != nil || rightIP != nil {
		return leftIP != nil && rightIP != nil && leftIP.Equal(rightIP)
	}
	leftSite, leftErr := publicsuffix.EffectiveTLDPlusOne(leftHost)
	rightSite, rightErr := publicsuffix.EffectiveTLDPlusOne(rightHost)
	if leftErr != nil || rightErr != nil {
		return leftHost == rightHost
	}
	return leftSite == rightSite
}

func sameOrigin(left, right *url.URL) bool {
	if left == nil || right == nil || !strings.EqualFold(left.Scheme, right.Scheme) {
		return false
	}
	leftHost, leftErr := NormalizeHostname(left.Hostname())
	rightHost, rightErr := NormalizeHostname(right.Hostname())
	if leftErr != nil || rightErr != nil || leftHost != rightHost {
		return false
	}
	return effectivePort(left) == effectivePort(right)
}

func effectivePort(value *url.URL) string {
	if port := value.Port(); port != "" {
		return port
	}
	if strings.EqualFold(value.Scheme, "https") {
		return "443"
	}
	return "80"
}

func stripSensitiveRedirectHeaders(headers http.Header) {
	for _, name := range []string{
		"Authorization",
		"Proxy-Authorization",
		"Cookie",
		"Cookie2",
		"X-Api-Key",
		"X-Auth-Token",
	} {
		headers.Del(name)
	}
}
