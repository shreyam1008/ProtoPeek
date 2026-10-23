package netdiag

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestTLSDisplayBoundsPreserveRealVerifiedAndReceivedEvidence(t *testing.T) {
	const count = 9
	certs := make([]*x509.Certificate, count)
	keys := make([]ed25519.PrivateKey, count)
	wire := make([][]byte, count)
	now := time.Now()
	for index := count - 1; index >= 0; index-- {
		public, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		keys[index] = key
		template := &x509.Certificate{SerialNumber: new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 1024), big.NewInt(int64(index))), Subject: pkix.Name{CommonName: strings.Repeat("bounded certificate ", 100)}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), BasicConstraintsValid: true, IsCA: index > 0, MaxPathLen: 10, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign}
		if index == 0 {
			template.MaxPathLen = -1
			template.KeyUsage = x509.KeyUsageDigitalSignature
			template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
			template.DNSNames = []string{"good.test"}
			for item := 0; item < 40; item++ {
				template.DNSNames = append(template.DNSNames, strings.Repeat("a", 300)+".example.test")
				template.IPAddresses = append(template.IPAddresses, net.IPv4(192, 0, 2, byte(item+1)))
			}
		}
		parent, signer := template, key
		if index+1 < count {
			parent, signer = certs[index+1], keys[index+1]
		}
		der, err := x509.CreateCertificate(rand.Reader, template, parent, public, signer)
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := x509.ParseCertificate(der)
		if err != nil {
			t.Fatal(err)
		}
		certs[index], wire[index] = parsed, der
	}
	roots := x509.NewCertPool()
	roots.AddCert(certs[count-1])
	address := tcpFixture(t, func(conn net.Conn) {
		server := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{{Certificate: wire, PrivateKey: keys[0]}}, MinVersion: tls.VersionTLS12})
		_ = server.Handshake()
	})
	input := request("tls", address)
	input.TimeoutMS = 3000
	input.ServerName = "good.test"
	result, err := (Engine{Roots: roots}).Run(context.Background(), input)
	if err != nil || result.TLS == nil || !result.TLS.Verified {
		t.Fatalf("valid native fixture was not verified: %+v err=%v", result.TLS, err)
	}
	evidence := result.TLS
	if len(evidence.ReceivedChain) != 8 || len(evidence.VerifiedChain) != 8 || !evidence.Limited {
		t.Fatalf("chain bounds missing: %+v", evidence)
	}
	first := evidence.ReceivedChain[0]
	hash := sha256.Sum256(wire[0])
	if first.SHA256 != hex.EncodeToString(hash[:]) || !first.Limited || len(first.DNSNames) != 32 || len(first.IPAddresses) != 32 {
		t.Fatalf("bounded identity/SAN evidence %+v", first)
	}
	for _, chain := range [][]Certificate{evidence.ReceivedChain, evidence.VerifiedChain} {
		for _, certificate := range chain {
			if len(certificate.Subject) > 1024 || len(certificate.Issuer) > 1024 || len(certificate.Serial) > 128 || !utf8.ValidString(certificate.Subject) || !utf8.ValidString(certificate.Issuer) {
				t.Fatalf("unbounded certificate display %+v", certificate)
			}
			for _, name := range certificate.DNSNames {
				if len(name) > 253 {
					t.Fatalf("unbounded DNS name length %d", len(name))
				}
			}
		}
	}
	input.ServerName = "missing.test"
	untrusted, err := (Engine{Roots: roots}).Run(context.Background(), input)
	if err != nil || untrusted.TLS == nil || untrusted.TLS.Verified || !untrusted.TLS.Limited || len(untrusted.TLS.VerifyError) > 2048 || len(untrusted.TLS.VerifyError) == 0 {
		t.Fatalf("unbounded/missing verification failure %+v err=%v", untrusted.TLS, err)
	}
}
