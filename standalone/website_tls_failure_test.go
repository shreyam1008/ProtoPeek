package standalone

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"github.com/shreyam1008/ProtoPeek/internal/webobserve"
)

func TestRejectedTLSRetainsCertificateWithoutSendingHTTP(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(200) }))
	defer server.Close()
	observer, err := webobserve.New(webobserve.Options{Policy: targetguard.LocalDevelopment})
	if err != nil {
		t.Fatal(err)
	}
	_, err = observer.Observe(context.Background(), server.URL)
	if err == nil {
		t.Fatal("untrusted certificate was accepted")
	}
	w := httptest.NewRecorder()
	writeWebsiteObservationError(w, err)
	var response struct {
		Error      string
		TLSFailure *websiteTLSFailure
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err, w.Body.String())
	}
	if w.Code != 502 || response.TLSFailure == nil || response.TLSFailure.Issuer == "" || requests.Load() != 0 {
		t.Fatalf("certificate failure = %+v, requests=%d", response, requests.Load())
	}
	if !strings.Contains(response.Error, "rejected") {
		t.Fatal(response.Error)
	}
}

func TestCertificateFailureBoundsAndClassification(t *testing.T) {
	leaf := &x509.Certificate{Subject: pkix.Name{CommonName: strings.Repeat("<", 1024)}, Issuer: pkix.Name{CommonName: "fixture CA"}, NotBefore: time.Now().Add(-48 * time.Hour), NotAfter: time.Now().Add(-24 * time.Hour)}
	for i := 0; i < 30; i++ {
		leaf.DNSNames = append(leaf.DNSNames, strings.Repeat("x", 512))
	}
	err := &tls.CertificateVerificationError{UnverifiedCertificates: []*x509.Certificate{leaf}, Err: x509.CertificateInvalidError{Cert: leaf, Reason: x509.Expired}}
	failure := certificateFailure(err)
	if failure == nil || !strings.Contains(failure.Reason, "expired") || len(failure.Subject) > 256 || len(failure.DNSNames) != 8 || len(failure.DNSNames[0]) > 128 {
		t.Fatalf("unbounded failure: %+v", failure)
	}
	encoded, _ := json.Marshal(failure)
	if len(encoded) > 16<<10 {
		t.Fatal("oversized API error")
	}
	if certificateFailure(errors.New("ordinary network failure")) != nil {
		t.Fatal("invented certificate evidence")
	}
}
