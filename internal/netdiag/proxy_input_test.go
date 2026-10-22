package netdiag

import (
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProxyURLFormsCannotDowngradeTransportOrSendCredentials(t *testing.T) {
	var accepted atomic.Int32
	address := tcpFixture(t, func(conn net.Conn) {
		accepted.Add(1)
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		data := make([]byte, 4096)
		_, _ = conn.Read(data)
		_, _ = io.WriteString(conn, "HTTP/1.1 200 Accepted\r\n\r\n")
	})
	for _, mode := range []string{"http-proxy", "socks5-proxy"} {
		for _, proxy := range []string{"https://" + address, "http://" + address, address + "/path", address + "?query=value", address + "#fragment", "user:password@" + address, address + "\\path"} {
			t.Run(mode+"/"+strings.ReplaceAll(proxy, "/", "_"), func(t *testing.T) {
				dialed := 0
				engine := Engine{Dial: func(ctx context.Context, network, target string) (net.Conn, error) {
					dialed++
					return (&net.Dialer{}).DialContext(ctx, network, target)
				}}
				input := request(mode, "127.0.0.1:443")
				input.Proxy, input.ProxyUsername, input.ProxyPassword = proxy, "fixture-user", "fixture-password"
				_, err := engine.Run(context.Background(), input)
				if !errors.Is(err, ErrInvalid) || dialed != 0 || accepted.Load() != 0 {
					t.Fatalf("invalid proxy address reached transport: invalid=%t dialed=%d accepted=%d", errors.Is(err, ErrInvalid), dialed, accepted.Load())
				}
			})
		}
	}
}

func TestProxyBracketedIPv6HostPortRemainsSupportedAndDestinationZonesFail(t *testing.T) {
	for _, mode := range []string{"http-proxy", "socks5-proxy"} {
		input := request(mode, "127.0.0.1:443")
		input.Proxy = "[::1]:8080"
		dialed := 0
		engine := Engine{Dial: func(_ context.Context, network, address string) (net.Conn, error) {
			dialed++
			if network != "tcp" || address != "[::1]:8080" {
				t.Fatalf("proxy endpoint changed %q %q", network, address)
			}
			return nil, errors.New("fixture: no remote operation")
		}}
		if _, err := engine.Run(context.Background(), input); err != nil || dialed != 1 {
			t.Fatalf("bracketed IPv6 proxy was rejected: %v calls=%d", err, dialed)
		}
		input.Target = "[fe80::1%3]:443"
		if _, err := engine.Run(context.Background(), input); !errors.Is(err, ErrInvalid) || dialed != 1 {
			t.Fatalf("destination zone encoded through proxy: %v calls=%d", err, dialed)
		}
	}
}
