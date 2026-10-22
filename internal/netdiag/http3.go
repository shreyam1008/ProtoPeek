package netdiag

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
)

func (engine Engine) http3(parent context.Context, input Request, target endpoint, address netip.Addr, result *Result) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	evidence := &HTTP3Evidence{Address: net.JoinHostPort(address.String(), target.port)}
	result.HTTP3 = evidence
	result.Outcome, result.Summary = "failed", "No verified HTTP/3 response was observed. No TCP fallback or redirect was attempted."
	name := input.ServerName
	if name == "" {
		name = target.host
	}
	if parsed, err := netip.ParseAddr(name); err == nil {
		name = parsed.WithZone("").String()
	}
	roots := engine.Roots
	if input.CAPEM != "" {
		if roots == nil {
			roots, _ = x509.SystemCertPool()
		} else {
			roots = roots.Clone()
		}
		if roots == nil {
			roots = x509.NewCertPool()
		}
		roots.AppendCertsFromPEM([]byte(input.CAPEM)) // validated before any network operation
	}
	network, bind := "udp4", &net.UDPAddr{IP: net.IPv4zero}
	if address.Is6() {
		network, bind = "udp6", &net.UDPAddr{IP: net.IPv6unspecified}
	}
	socket, err := net.ListenUDP(network, bind)
	if err != nil {
		evidence.Detail = "The operating system could not open a UDP socket."
		return
	}
	defer socket.Close()
	transport := &quic.Transport{Conn: socket}
	defer transport.Close()
	remote, err := net.ResolveUDPAddr(network, evidence.Address)
	if err != nil {
		evidence.Detail = "The numeric UDP destination could not be encoded."
		return
	}
	handshakeCtx, stopHandshake := context.WithTimeout(ctx, time.Duration(input.TimeoutMS)*time.Millisecond)
	started := time.Now()
	conn, err := transport.Dial(handshakeCtx, remote, &tls.Config{ServerName: name, RootCAs: roots, MinVersion: tls.VersionTLS13, NextProtos: []string{http3.NextProtoH3}}, &quic.Config{
		HandshakeIdleTimeout: 3 * time.Second, MaxIdleTimeout: 5 * time.Second, MaxIncomingStreams: -1, MaxIncomingUniStreams: 8,
		InitialStreamReceiveWindow: 64 << 10, MaxStreamReceiveWindow: 128 << 10, InitialConnectionReceiveWindow: 128 << 10, MaxConnectionReceiveWindow: 256 << 10,
	})
	stopHandshake()
	evidence.HandshakeMS = elapsed(started)
	if err != nil {
		_, evidence.Detail = networkError(err)
		return
	}
	defer conn.CloseWithError(0, "diagnostic complete")
	state := conn.ConnectionState()
	evidence.Local, evidence.QUICVersion, evidence.TLSVersion, evidence.ALPN = conn.LocalAddr().String(), state.Version.String(), tls.VersionName(state.TLS.Version), state.TLS.NegotiatedProtocol
	// Use this exact connection: the pooled transport's automatic reconnect policy
	// would make a single diagnostic's observations ambiguous.
	httpTransport := &http3.Transport{MaxResponseHeaderBytes: 64 << 10, DisableCompression: true}
	defer httpTransport.Close()
	client := httpTransport.NewClientConn(conn)
	request := &http.Request{Method: http.MethodHead, URL: &url.URL{Scheme: "https", Host: target.authority(), Path: "/"}, Header: make(http.Header), Host: target.authority()}
	response, err := client.RoundTrip(request.WithContext(ctx))
	if err != nil {
		evidence.Detail = "Verified QUIC handshake succeeded; no complete bounded HTTP/3 response headers were received."
		return
	}
	defer response.Body.Close()
	evidence.Status = response.StatusCode
	evidence.Detail = "One HEAD / request on the displayed pinned QUIC connection. Response headers and body are not retained. Redirects, 0-RTT and datagrams are disabled."
	result.Outcome, result.Summary = "success", "A verified HTTP/3 response was received. The displayed HTTP status is application evidence, not a health guarantee."
}
