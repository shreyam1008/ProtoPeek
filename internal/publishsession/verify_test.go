package publishsession

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestEndpointCheckIsExplicitAndDoesNotConfuseHTTPFailureWithTLSReachability(t *testing.T) {
	s, _ := fixture(t)
	var checks atomic.Int32
	s.verify = func(context.Context, string) (int, error) { checks.Add(1); return 503, nil }
	value := startFixture(t, s, "quick")
	value = awaitState(t, s, "running")
	if checks.Load() != 0 {
		t.Fatal("endpoint probed without explicit action")
	}
	if _, err := s.Verify(context.Background(), "unowned"); err == nil || checks.Load() != 0 {
		t.Fatal("unowned endpoint accepted")
	}
	verified, err := s.Verify(context.Background(), value.ID)
	if err != nil || !verified.EndpointVerified || verified.EndpointStatus != 503 || verified.EndpointCheckedAt == nil {
		t.Fatalf("missing independent evidence: %+v %v", verified, err)
	}
	if _, err := s.Stop(context.Background(), value.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Verify(context.Background(), value.ID); err == nil || checks.Load() != 1 {
		t.Fatal("stopped endpoint was probed")
	}
}

func TestEndpointHEADPreservesTLSVerificationAndDoesNotFollowRedirects(t *testing.T) {
	var redirected atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("probe method %s", r.Method)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credentials sent")
		}
		if r.URL.Path == "/redirect" {
			redirected.Add(1)
		}
		w.Header().Set("Location", "/redirect")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	if code, err := verifyEndpoint(context.Background(), server.URL); err == nil || code != 0 {
		t.Fatal("untrusted TLS fixture was trusted by default")
	}
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, MaxResponseHeaderBytes: 16 << 10}
	code, err := verifyWithTransport(context.Background(), server.URL, transport)
	if err != nil || code != 307 || redirected.Load() != 0 {
		t.Fatalf("HEAD evidence code=%d redirects=%d err=%v", code, redirected.Load(), err)
	}
}
