package webobserve

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (function resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return function(ctx, network, host)
}

func TestObservePinsDNSAndDoesNotFollowRedirect(t *testing.T) {
	t.Parallel()

	var redirectHits atomic.Int32
	redirectServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		redirectHits.Add(1)
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer redirectServer.Close()
	redirectURL, err := url.Parse(redirectServer.URL)
	if err != nil {
		t.Fatalf("parse redirect server URL: %v", err)
	}
	_, redirectPort, err := net.SplitHostPort(redirectURL.Host)
	if err != nil {
		t.Fatalf("split redirect server URL: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodHead {
			t.Fatalf("method = %s, want HEAD", request.Method)
		}
		writer.Header().Set("Content-Security-Policy", "default-src 'none'")
		writer.Header().Set("Set-Cookie", "secret=value")
		writer.Header().Set("Location", "http://redirect.test:"+redirectPort+"/landing?token=secret#fragment")
		writer.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server URL: %v", err)
	}
	_, port, err := net.SplitHostPort(serverURL.Host)
	if err != nil {
		t.Fatalf("split server URL: %v", err)
	}

	var lookups atomic.Int32
	resolver := resolverFunc(func(_ context.Context, _ string, host string) ([]netip.Addr, error) {
		lookups.Add(1)
		if host != "target.test." {
			t.Fatalf("unexpected lookup for %q", host)
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	})
	observer, err := New(Options{Policy: targetguard.LocalDevelopment, Resolver: resolver})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	result, err := observer.Observe(context.Background(), "http://target.test:"+port+"/start")
	if err != nil {
		t.Fatalf("Observe() error = %v", err)
	}

	if lookups.Load() != 1 {
		t.Fatalf("resolver calls = %d, want 1", lookups.Load())
	}
	if redirectHits.Load() != 0 {
		t.Fatalf("redirect destination was contacted %d times", redirectHits.Load())
	}
	if result.HTTP.StatusCode != http.StatusFound || result.Method != http.MethodHead {
		t.Fatalf("HTTP evidence = %#v", result.HTTP)
	}
	if result.HTTP.RedirectLocation != "http://redirect.test:"+redirectPort+"/landing" {
		t.Fatalf("redirect location = %q", result.HTTP.RedirectLocation)
	}
	if _, exists := result.HTTP.Headers["Set-Cookie"]; exists {
		t.Fatal("Set-Cookie leaked into retained evidence")
	}
	if result.HTTP.Headers["Content-Security-Policy"][0] != "default-src 'none'" {
		t.Fatalf("headers = %#v", result.HTTP.Headers)
	}
	if len(result.DNS.PinnedAddresses) != 1 || result.DNS.PinnedAddresses[0] != "127.0.0.1" {
		t.Fatalf("pinned addresses = %#v", result.DNS.PinnedAddresses)
	}
	if result.TLS != nil || result.Timings.TotalMS < 0 {
		t.Fatalf("unexpected transport evidence = %#v, %#v", result.TLS, result.Timings)
	}
}

func TestPublicObserverBlocksPrivateResolutionBeforeRequest(t *testing.T) {
	t.Parallel()
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("10.0.0.8")}, nil
	})
	observer, err := New(Options{Policy: targetguard.PublicOnly, Resolver: resolver})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	_, err = observer.Observe(context.Background(), "https://private.example.test/")
	if err == nil {
		t.Fatal("Observe() unexpectedly allowed a private DNS answer")
	}
}

func TestObserveRejectsQueryAndFragmentBeforeResolution(t *testing.T) {
	t.Parallel()
	var lookups atomic.Int32
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		lookups.Add(1)
		return []netip.Addr{netip.MustParseAddr("203.0.113.20")}, nil
	})
	observer, err := New(Options{Policy: targetguard.PublicOnly, Resolver: resolver})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	for _, target := range []string{
		"https://example.com/path?token=secret",
		"https://example.com/path?",
		"https://example.com/path#private",
	} {
		if _, err := observer.Observe(context.Background(), target); !errors.Is(err, targetguard.ErrInvalidTarget) {
			t.Fatalf("Observe(%q) error = %v, want ErrInvalidTarget", target, err)
		}
	}
	if got := lookups.Load(); got != 0 {
		t.Fatalf("resolver was called %d times for rejected URLs", got)
	}
}

func TestTLSEvidenceIsBoundedAndTruthful(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	state := &tls.ConnectionState{
		Version:            tls.VersionTLS13,
		CipherSuite:        tls.TLS_AES_128_GCM_SHA256,
		NegotiatedProtocol: "h2",
		ServerName:         "example.test",
		PeerCertificates: []*x509.Certificate{{
			Subject:   pkix.Name{CommonName: "example.test"},
			Issuer:    pkix.Name{CommonName: "Example CA"},
			NotBefore: now.Add(-time.Hour),
			NotAfter:  now.Add(time.Hour),
			DNSNames:  []string{"example.test", "www.example.test"},
		}},
		VerifiedChains: [][]*x509.Certificate{{{}}},
	}
	evidence := tlsEvidence(state)
	if evidence == nil {
		t.Fatal("tlsEvidence() = nil")
	}
	if evidence.Version != "TLS 1.3" || evidence.CipherSuite != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("TLS evidence = %#v", evidence)
	}
	if evidence.VerifiedChains != 1 || len(evidence.DNSNames) != 2 {
		t.Fatalf("TLS verification evidence = %#v", evidence)
	}
}

func TestSafeObservedURLRedactsCredentialLikeQueryValues(t *testing.T) {
	t.Parallel()
	input, err := url.Parse("https://example.test/report?token=secret&page=2#private")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	if got := safeObservedURL(input); got != "https://example.test/report?page=2&token=%5Bredacted%5D" {
		t.Fatalf("safeObservedURL() = %q", got)
	}
}
