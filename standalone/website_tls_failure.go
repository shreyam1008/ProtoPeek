package standalone

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// These are unverified certificate claims retained from a rejected handshake.
// TLS verification remains enabled and no HTTP request is sent after rejection.
type websiteTLSFailure struct {
	Reason    string   `json:"reason"`
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	NotBefore string   `json:"notBefore"`
	NotAfter  string   `json:"notAfter"`
	DNSNames  []string `json:"dnsNames"`
}

func certificateFailure(err error) *websiteTLSFailure {
	var verification *tls.CertificateVerificationError
	if !errors.As(err, &verification) || len(verification.UnverifiedCertificates) == 0 || verification.UnverifiedCertificates[0] == nil {
		return nil
	}
	leaf := verification.UnverifiedCertificates[0]
	result := &websiteTLSFailure{Reason: "Certificate verification failed", Subject: boundedTLSField(leaf.Subject.String(), 256), Issuer: boundedTLSField(leaf.Issuer.String(), 256), NotBefore: leaf.NotBefore.UTC().Format(time.RFC3339), NotAfter: leaf.NotAfter.UTC().Format(time.RFC3339), DNSNames: []string{}}
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	switch {
	case errors.As(verification.Err, &unknown):
		result.Reason = "Certificate authority is not trusted"
	case errors.As(verification.Err, &hostname):
		result.Reason = "Certificate does not match the requested hostname"
	case errors.As(verification.Err, &invalid) && invalid.Reason == x509.Expired:
		result.Reason = "Certificate is expired or not yet valid"
	}
	for _, name := range leaf.DNSNames {
		result.DNSNames = append(result.DNSNames, boundedTLSField(name, 128))
		if len(result.DNSNames) == 8 {
			break
		}
	}
	return result
}

func boundedTLSField(value string, limit int) string {
	value = strings.ToValidUTF8(value, "")
	if len(value) > limit {
		value = value[:limit]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}
