// A loopback-only browser QA harness for rejected TLS certificates. The normal
// website endpoint remains public-only; only this separate test server permits
// the generated local TLS target. It never disables certificate verification.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"github.com/shreyam1008/ProtoPeek/internal/webobserve"
	"github.com/shreyam1008/ProtoPeek/standalone"
)

func main() {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	certificate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Expired ProtoPeek QA certificate"}, NotBefore: time.Now().Add(-48 * time.Hour), NotAfter: time.Now().Add(-24 * time.Hour), DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.PublicKey, key)
	if err != nil {
		log.Fatal(err)
	}
	fixture := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Print("UNEXPECTED HTTP REQUEST AFTER TLS REJECTION")
		w.WriteHeader(200)
	}))
	fixture.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	fixture.StartTLS()
	defer fixture.Close()
	observer, err := webobserve.New(webobserve.Options{Policy: targetguard.LocalDevelopment})
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/security/web", standalone.WebsiteObservationHandler(observer))
	mux.Handle("/", standalone.Handler(nil, "", nil, nil))
	fmt.Printf("QA browser: http://127.0.0.1:43114/#/security\nExpired TLS target: %s\n", fixture.URL)
	server := &http.Server{Addr: "127.0.0.1:43114", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(server.ListenAndServe())
}
