package targetguard

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestValidateRedirectRejectsPrivateResolution(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, _ string, host string) ([]netip.Addr, error) {
		switch host {
		case "example.com.":
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		case "private.example.com.":
			return []netip.Addr{netip.MustParseAddr("10.1.2.3")}, nil
		default:
			return nil, errors.New("unexpected host")
		}
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})
	previous, err := guard.ResolveAndPin(context.Background(), "https://example.com")
	if err != nil {
		t.Fatalf("ResolveAndPin() error = %v", err)
	}
	next, _ := url.Parse("https://private.example.com/login")

	_, err = guard.ValidateRedirect(context.Background(), previous, next, RedirectPolicy{})
	if !errors.Is(err, ErrAddressBlocked) {
		t.Fatalf("ValidateRedirect() error = %v, want ErrAddressBlocked", err)
	}
}

func TestValidateRedirectRejectsHTTPSDowngradeBeforeDNS(t *testing.T) {
	lookupCalls := 0
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		lookupCalls++
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})
	previous, err := guard.ResolveAndPin(context.Background(), "https://example.com")
	if err != nil {
		t.Fatalf("ResolveAndPin() error = %v", err)
	}
	next, _ := url.Parse("http://example.com/")

	_, err = guard.ValidateRedirect(context.Background(), previous, next, RedirectPolicy{})
	if !errors.Is(err, ErrRedirectDowngrade) {
		t.Fatalf("ValidateRedirect() error = %v, want ErrRedirectDowngrade", err)
	}
	if lookupCalls != 1 {
		t.Fatalf("resolver calls = %d, want no redirect lookup", lookupCalls)
	}
}

func TestValidateRedirectRequiresCrossSiteApproval(t *testing.T) {
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})
	previous, err := guard.ResolveAndPin(context.Background(), "https://www.example.com")
	if err != nil {
		t.Fatalf("ResolveAndPin() error = %v", err)
	}

	sameSite, _ := url.Parse("https://static.example.com/asset")
	if _, err := guard.ValidateRedirect(context.Background(), previous, sameSite, RedirectPolicy{}); err != nil {
		t.Fatalf("same-site ValidateRedirect() error = %v", err)
	}
	crossSite, _ := url.Parse("https://example.net/")
	if _, err := guard.ValidateRedirect(context.Background(), previous, crossSite, RedirectPolicy{}); !errors.Is(err, ErrCrossSiteRedirect) {
		t.Fatalf("cross-site ValidateRedirect() error = %v, want ErrCrossSiteRedirect", err)
	}
	if _, err := guard.ValidateRedirect(context.Background(), previous, crossSite, RedirectPolicy{AllowCrossSite: true}); err != nil {
		t.Fatalf("approved cross-site ValidateRedirect() error = %v", err)
	}
}

func TestSafeTransportBypassesEnvironmentProxy(t *testing.T) {
	var targetHits atomic.Int32
	targetServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		targetHits.Add(1)
		_, _ = io.WriteString(writer, "target")
	}))
	defer targetServer.Close()
	var proxyHits atomic.Int32
	proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		proxyHits.Add(1)
		_, _ = io.WriteString(writer, "proxy")
	}))
	defer proxyServer.Close()
	t.Setenv("HTTP_PROXY", proxyServer.URL)
	t.Setenv("HTTPS_PROXY", proxyServer.URL)
	t.Setenv("NO_PROXY", "")

	targetURL, err := url.Parse(targetServer.URL)
	if err != nil {
		t.Fatalf("parse target URL: %v", err)
	}
	_, port, err := net.SplitHostPort(targetURL.Host)
	if err != nil {
		t.Fatalf("split target host: %v", err)
	}
	resolver := resolverFunc(func(_ context.Context, _ string, host string) ([]netip.Addr, error) {
		if host != "target.test." {
			t.Fatalf("LookupNetIP() host = %q", host)
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	})
	guard := mustGuard(t, Config{Policy: LocalDevelopment, Resolver: resolver})
	session, err := guard.NewSession(context.Background(), "http://target.test:"+port+"/", SessionConfig{})
	if err != nil {
		t.Fatalf("NewSession() error = %v", err)
	}
	defer session.CloseIdleConnections()

	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, session.InitialURL().String(), nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() error = %v", err)
	}
	response, err := session.Client().Do(request)
	if err != nil {
		t.Fatalf("Client.Do() error = %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if readErr != nil {
		t.Fatalf("read response: %v", readErr)
	}
	if string(body) != "target" || targetHits.Load() != 1 {
		t.Fatalf("target response = %q, hits = %d", body, targetHits.Load())
	}
	if proxyHits.Load() != 0 {
		t.Fatalf("environment proxy was contacted %d times", proxyHits.Load())
	}
	if session.transport.Proxy != nil {
		t.Fatal("safe transport unexpectedly configured a proxy function")
	}
	if !session.transport.DisableCompression {
		t.Fatal("safe transport must disable transparent decompression")
	}
}

func TestRedirectSanitizesSensitiveHeaders(t *testing.T) {
	headers := http.Header{
		"Authorization":       {"Bearer secret"},
		"Proxy-Authorization": {"Basic secret"},
		"Cookie":              {"session=secret"},
		"X-Api-Key":           {"secret"},
		"Accept":              {"application/json"},
	}
	stripSensitiveRedirectHeaders(headers)
	for _, name := range []string{"Authorization", "Proxy-Authorization", "Cookie", "X-Api-Key"} {
		if headers.Get(name) != "" {
			t.Fatalf("header %s was not removed", name)
		}
	}
	if !strings.Contains(headers.Get("Accept"), "application/json") {
		t.Fatal("non-sensitive Accept header was removed")
	}
}
