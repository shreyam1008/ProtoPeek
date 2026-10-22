package netdiag

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
	"golang.org/x/net/http2"
)

func request(mode, target string) Request {
	return Request{Mode: mode, Target: target, TimeoutMS: 300, Encoding: "text", Samples: 3}
}

func tcpFixture(t *testing.T, serve func(net.Conn)) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() { defer conn.Close(); serve(conn) }()
		}
	}()
	return listener.Addr().String()
}

func TestConnectSamplingAndRawTCP(t *testing.T) {
	address := tcpFixture(t, func(conn net.Conn) {
		data := make([]byte, 4)
		_, _ = io.ReadFull(conn, data)
		_, _ = conn.Write(append([]byte("ack:"), data...))
	})
	engine := Engine{}
	for _, mode := range []string{"diagnose", "ip-compare", "availability"} {
		result, err := engine.Run(context.Background(), request(mode, address))
		if err != nil || result.Outcome != "success" {
			t.Fatalf("%s: %+v %v", mode, result, err)
		}
		if mode == "availability" && (result.Statistics.Completed != 3 || result.Statistics.Connected != 3 || result.Statistics.P95MS == nil) {
			t.Fatalf("missing finite statistics: %+v", result.Statistics)
		}
	}
	input := request("tcp-exchange", address)
	input.Payload = "ping"
	result, err := engine.Run(context.Background(), input)
	if err != nil || result.Exchange.ReplyText != "ack:ping" || result.Exchange.SentBytes != 4 {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestUDPExchangeAndSilentDeadline(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	go func() {
		data := make([]byte, 32)
		n, peer, err := conn.ReadFrom(data)
		if err == nil {
			_, _ = conn.WriteTo(data[:n], peer)
		}
	}()
	input := request("udp-exchange", conn.LocalAddr().String())
	input.Payload, input.Encoding = "000102ff", "hex"
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || result.Exchange.ReplyHex != input.Payload || result.Checks[0].Outcome != "socket-open" {
		t.Fatalf("%+v %v", result, err)
	}
	input.Payload = ""
	result, err = (Engine{}).Run(context.Background(), input)
	if err != nil || result.Exchange.Outcome != "timeout" {
		t.Fatalf("UDP silence must not be called closed: %+v %v", result, err)
	}
}

func TestCancelClosesRawRead(t *testing.T) {
	closed := make(chan struct{}, 1)
	address := tcpFixture(t, func(conn net.Conn) { _, _ = io.Copy(io.Discard, conn); closed <- struct{}{} })
	ctx, cancel := context.WithCancel(context.Background())
	input := request("tcp-exchange", address)
	input.TimeoutMS = 3000
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	_, err := (Engine{}).Run(ctx, input)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("cancel did not close socket")
	}
}

func TestTLSVerifiedAndReceivedChain(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("TLS inspection must not send HTTP") }))
	defer server.Close()
	input := request("tls", server.URL)
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || result.TLS.Verified || len(result.TLS.ReceivedChain) == 0 || len(result.TLS.VerifiedChain) != 0 {
		t.Fatalf("untrusted chain evidence: %+v %v", result.TLS, err)
	}
	input.CAPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}))
	result, err = (Engine{}).Run(context.Background(), input)
	if err != nil || !result.TLS.Verified || len(result.TLS.VerifiedChain) == 0 {
		t.Fatalf("private CA: %+v %v", result.TLS, err)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "BEGIN CERTIFICATE") {
		t.Fatal("CA input leaked into result")
	}
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	input.CAPEM = ""
	trusted, trustErr := (Engine{Roots: roots}).Run(context.Background(), input)
	if trustErr != nil || !trusted.TLS.Verified {
		t.Fatalf("configured roots: %+v %v", trusted.TLS, trustErr)
	}
	if result.TLS.Version == "" || result.TLS.Cipher == "" {
		t.Fatal("missing negotiated protocol")
	}
}

func TestHTTP2SettingsAndPing(t *testing.T) {
	address := tcpFixture(t, func(conn net.Conn) {
		preface := make([]byte, len(http2.ClientPreface))
		_, _ = io.ReadFull(conn, preface)
		if string(preface) != http2.ClientPreface {
			return
		}
		framer := http2.NewFramer(conn, conn)
		_ = framer.WriteSettings(http2.Setting{ID: http2.SettingMaxConcurrentStreams, Val: 32})
		for {
			frame, err := framer.ReadFrame()
			if err != nil {
				return
			}
			if ping, ok := frame.(*http2.PingFrame); ok {
				_ = framer.WritePing(true, ping.Data)
				_, _ = framer.ReadFrame()
				return
			}
		}
	})
	result, err := (Engine{}).Run(context.Background(), request("http2", address))
	if err != nil || result.Outcome != "success" || !result.HTTP2.PingAck || len(result.HTTP2.Settings) != 1 {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestHTTPProxyCredentialEchoNeverIncluded(t *testing.T) {
	address := tcpFixture(t, func(conn net.Conn) {
		data := make([]byte, 4096)
		_, _ = conn.Read(data)
		_, _ = io.WriteString(conn, "HTTP/1.1 407 secret-sentinel\r\nProxy-Authenticate: secret-sentinel\r\n\r\n")
	})
	input := request("http-proxy", "127.0.0.1:443")
	input.Proxy, input.ProxyUsername, input.ProxyPassword = address, "user", "secret-sentinel"
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || result.Proxy.Status != 407 {
		t.Fatalf("%+v %v", result, err)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "secret-sentinel") || strings.Contains(string(encoded), "dXNlcjpzZWNyZXQ") {
		t.Fatal("proxy credential echo escaped sanitization")
	}
}

func TestSOCKSConnectUsesPinnedAddress(t *testing.T) {
	address := tcpFixture(t, func(conn net.Conn) {
		greeting := make([]byte, 3)
		_, _ = io.ReadFull(conn, greeting)
		_, _ = conn.Write([]byte{5, 0})
		packet := make([]byte, 10)
		_, _ = io.ReadFull(conn, packet)
		if packet[3] != 1 || string(packet[4:8]) != string([]byte{127, 0, 0, 1}) {
			return
		}
		_, _ = conn.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 80})
	})
	input := request("socks5-proxy", "127.0.0.1:443")
	input.Proxy = address
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || result.Proxy.Outcome != "accepted" {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestWireDNSIdentityAndTTL(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	go func() {
		data := make([]byte, 1024)
		n, peer, err := conn.ReadFrom(data)
		if err != nil {
			return
		}
		var message dnsmessage.Message
		if message.Unpack(data[:n]) != nil {
			return
		}
		message.Response = true
		message.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: message.Questions[0].Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeA, TTL: 123}, Body: &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}}}}
		wire, _ := message.Pack()
		_, _ = conn.WriteTo(wire, peer)
	}()
	input := request("dns", "example.test")
	input.RecordType, input.Resolver = "A", conn.LocalAddr().String()
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || len(result.DNS) != 1 || len(result.DNS[0].Records) != 1 || *result.DNS[0].Records[0].TTLSeconds != 123 {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestSubnetExactWideCountsAndPointToPoint(t *testing.T) {
	for _, test := range []struct {
		prefix, count, usable, last string
		eligible                    bool
	}{
		{"192.168.1.17/24", "256", "254", "192.168.1.255", true},
		{"10.1.1.0/31", "2", "2", "10.1.1.1", true},
		{"2001:db8::/64", "18446744073709551616", "18446744073709551616", "2001:db8::ffff:ffff:ffff:ffff", false},
	} {
		result, err := (Engine{}).Run(context.Background(), request("subnet", test.prefix))
		if err != nil || result.Subnet.TotalAddresses != test.count || result.Subnet.UsableHosts != test.usable || result.Subnet.Last != test.last || result.Subnet.DiscoveryEligible != test.eligible {
			t.Fatalf("%s: %+v %v", test.prefix, result.Subnet, err)
		}
	}
}

func TestInputAndDestinationBounds(t *testing.T) {
	for _, raw := range []string{"[[::1]]", "http://user:pass@localhost", "host:0", "host:65536", "host/path", "[::1]:"} {
		if _, err := parseEndpoint(raw, 443); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	for _, raw := range []string{"0.0.0.0", "255.255.255.255", "224.0.0.1", "::", "ff02::1", "fe80::1"} {
		if usableAddress(netip.MustParseAddr(raw), nil) {
			t.Errorf("accepted %s", raw)
		}
	}
	if !usableAddress(netip.MustParseAddr("fe80::1%3"), nil) {
		t.Fatal("explicit IPv6 zone lost")
	}
	called := false
	engine := Engine{Dial: func(context.Context, string, string) (net.Conn, error) {
		called = true
		return nil, errors.New("unexpected")
	}}
	input := request("tcp-exchange", "127.0.0.1:80")
	input.Payload = strings.Repeat("x", MaxPayloadBytes+1)
	if _, err := engine.Run(context.Background(), input); !errors.Is(err, ErrInvalid) || called {
		t.Fatal("oversized payload reached dial")
	}
}

func TestNativeConnectionRefusalIsTyped(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	result, err := (Engine{}).Run(context.Background(), request("availability", address))
	if err != nil || result.Statistics.Refused != 3 || result.Statistics.MinMS != nil {
		t.Fatalf("refusal must not become generic failure or successful latency: %+v %+v %v", result.Statistics, result.Samples, err)
	}
}
