package netdiag

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"time"
)

func (engine Engine) inspectTLS(ctx context.Context, conn net.Conn, input Request, target endpoint, address netip.Addr) (*TLSEvidence, error) {
	started := time.Now()
	name := input.ServerName
	if name == "" {
		name = target.host
	}
	if parsed, err := netip.ParseAddr(name); err == nil {
		name = parsed.WithZone("").String()
	}
	roots := engine.Roots
	verifier := "system trust roots"
	if input.CAPEM != "" {
		if roots == nil {
			roots, _ = x509.SystemCertPool()
		} else {
			roots = roots.Clone()
		}
		if roots == nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM([]byte(input.CAPEM)) {
			return nil, fmt.Errorf("%w: private CA must contain a PEM certificate", ErrInvalid)
		}
		verifier = "system trust roots plus the in-memory private CA"
	} else if roots != nil {
		verifier = "configured trust roots"
	}
	evidence := &TLSEvidence{Address: net.JoinHostPort(address.String(), target.port), ServerName: name, Verifier: verifier,
		ReceivedChain: []Certificate{}, VerifiedChain: []Certificate{}}
	config := &tls.Config{ServerName: name, RootCAs: roots, NextProtos: input.ALPN, MinVersion: tls.VersionTLS12}
	// Capture the server-supplied chain before verification; the ordinary Go verifier
	// still decides whether the handshake is trusted. No insecure fallback occurs.
	config.VerifyPeerCertificate = func(raw [][]byte, chains [][]*x509.Certificate) error {
		for _, data := range raw {
			if cert, err := x509.ParseCertificate(data); err == nil {
				appendCertificate(&evidence.ReceivedChain, cert, &evidence.Limited)
			}
		}
		return nil
	}
	client := tls.Client(conn, config)
	err := client.HandshakeContext(ctx)
	state := client.ConnectionState()
	// VerifyPeerCertificate is not called when normal validation fails.
	if len(evidence.ReceivedChain) == 0 {
		for _, cert := range state.PeerCertificates {
			appendCertificate(&evidence.ReceivedChain, cert, &evidence.Limited)
		}
	}
	evidence.DurationMS = elapsed(started)
	evidence.Version, evidence.Cipher, evidence.ALPN = tls.VersionName(state.Version), tls.CipherSuiteName(state.CipherSuite), state.NegotiatedProtocol
	if err != nil {
		var verification *tls.CertificateVerificationError
		if len(evidence.ReceivedChain) == 0 && errors.As(err, &verification) {
			for _, cert := range verification.UnverifiedCertificates {
				appendCertificate(&evidence.ReceivedChain, cert, &evidence.Limited)
			}
		}
		// TLS errors contain certificate names but never the request/CA/credentials.
		evidence.VerifyError = boundedCertificateText(err.Error(), 2048, &evidence.Limited)
		return evidence, nil
	}
	evidence.Verified = len(state.VerifiedChains) > 0
	if len(state.VerifiedChains) > 0 {
		for _, cert := range state.VerifiedChains[0] {
			appendCertificate(&evidence.VerifiedChain, cert, &evidence.Limited)
		}
	}
	return evidence, nil
}

func describeCertificate(cert *x509.Certificate) Certificate {
	digest := sha256.Sum256(cert.Raw)
	limited := false
	ips := make([]string, 0, min(32, len(cert.IPAddresses)))
	for _, address := range cert.IPAddresses {
		if len(ips) == 32 {
			limited = true
			break
		}
		ips = append(ips, address.String())
	}
	names := make([]string, 0, min(32, len(cert.DNSNames)))
	for _, name := range cert.DNSNames {
		if len(names) == 32 {
			limited = true
			break
		}
		names = append(names, boundedCertificateText(name, 253, &limited))
	}
	subject := boundedCertificateText(cert.Subject.String(), 1024, &limited)
	issuer := boundedCertificateText(cert.Issuer.String(), 1024, &limited)
	serial := ""
	if cert.SerialNumber != nil {
		serial = boundedCertificateText(cert.SerialNumber.String(), 128, &limited)
	}
	return Certificate{Subject: subject, Issuer: issuer, DNSNames: names, IPAddresses: ips, Limited: limited,
		NotBefore: cert.NotBefore.UTC().Format(time.RFC3339), NotAfter: cert.NotAfter.UTC().Format(time.RFC3339), SHA256: hex.EncodeToString(digest[:]), Serial: serial}
}

func appendCertificate(chain *[]Certificate, cert *x509.Certificate, limited *bool) {
	if len(*chain) == 8 {
		*limited = true
		return
	}
	value := describeCertificate(cert)
	*limited = *limited || value.Limited
	*chain = append(*chain, value)
}

func boundedCertificateText(value string, maximum int, limited *bool) string {
	if len(value) <= maximum {
		return value
	}
	*limited = true
	return strings.ToValidUTF8(value[:maximum-len("…")], "") + "…"
}
