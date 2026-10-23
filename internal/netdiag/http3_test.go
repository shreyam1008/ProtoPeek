package netdiag

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/quic-go/quic-go/http3"
)

func TestHTTP3OnePinnedVerifiedHEADWithoutRedirect(t *testing.T) {
	certSource := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certificate := certSource.TLS.Certificates[0]
	root := certSource.Certificate()
	certSource.Close()
	packet, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	server := &http3.Server{TLSConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13}, Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		if request.Method != "HEAD" || request.URL.Path != "/" || request.ProtoMajor != 3 {
			t.Errorf("unexpected request %s %s %s", request.Method, request.URL, request.Proto)
		}
		writer.Header().Set("Location", "https://127.0.0.1:1/never-follow")
		writer.WriteHeader(302)
	})}
	done := make(chan error, 1)
	go func() { done <- server.Serve(packet) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = packet.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("HTTP/3 fixture did not stop")
		}
	})
	roots := x509.NewCertPool()
	roots.AddCert(root)
	input := request("http3", packet.LocalAddr().String())
	input.TimeoutMS = 3000
	result, err := (Engine{Roots: roots}).Run(context.Background(), input)
	if err != nil || result.Outcome != "success" || result.HTTP3.Status != 302 || result.HTTP3.ALPN != "h3" || result.HTTP3.TLSVersion != "TLS 1.3" || requests.Load() != 1 {
		t.Fatalf("%+v evidence=%+v requests=%d err=%v", result, result.HTTP3, requests.Load(), err)
	}
	untrusted, err := (Engine{Roots: x509.NewCertPool()}).Run(context.Background(), input)
	if err != nil || untrusted.Outcome != "failed" || requests.Load() != 1 {
		t.Fatalf("untrusted endpoint received an application request: %+v %v", untrusted, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Engine{}).Run(ctx, input); err != context.Canceled {
		t.Fatalf("cancelled request: %v", err)
	}
	if result.HTTP3.Address != "127.0.0.1:"+strconv.Itoa(packet.LocalAddr().(*net.UDPAddr).Port) {
		t.Fatal("destination was not pinned")
	}
}
