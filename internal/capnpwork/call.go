package capnpwork

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"time"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/rpc"
	"capnproto.org/go/capnp/v3/rpc/transport"
)

type CallRequest struct {
	Address     string          `json:"address"`
	Transport   string          `json:"transport"`
	ServerName  string          `json:"serverName,omitempty"`
	RootCAPEM   string          `json:"rootCaPem,omitempty"`
	InterfaceID string          `json:"interfaceId"`
	Ordinal     uint16          `json:"ordinal"`
	TimeoutMs   int             `json:"timeoutMs"`
	Params      json.RawMessage `json:"params"`
}

type CallResult struct {
	Address       string          `json:"address"`
	RemoteAddress string          `json:"remoteAddress"`
	Transport     string          `json:"transport"`
	TLSVersion    string          `json:"tlsVersion,omitempty"`
	DurationMs    int64           `json:"durationMs"`
	ObservedAt    time.Time       `json:"observedAt"`
	Result        json.RawMessage `json:"result"`
}

func (s *Schema) Call(parent context.Context, input CallRequest) (CallResult, error) {
	result := CallResult{Address: input.Address, Transport: input.Transport}
	started := time.Now()
	if len(input.Address) > 320 || input.TimeoutMs < 100 || input.TimeoutMs > 30000 || (input.Transport != "tcp" && input.Transport != "tls") {
		return result, errors.New("choose TCP or verified TLS and a timeout between 100 and 30000 ms")
	}
	host, port, err := net.SplitHostPort(input.Address)
	portNum, portErr := strconv.ParseUint(port, 10, 16)
	if err != nil || portErr != nil || portNum == 0 || host == "" || strings.ContainsAny(host, "/\\@?#\r\n\t ") {
		return result, errors.New("enter a host:port target, with brackets around IPv6")
	}
	if len(input.ServerName) > 253 || strings.ContainsAny(input.ServerName, "/\\@?#\r\n\t :") {
		return result, errors.New("TLS server name must be a hostname")
	}
	var roots *x509.CertPool
	if input.RootCAPEM != "" {
		if input.Transport != "tls" || len(input.RootCAPEM) > 32<<10 {
			return result, errors.New("custom CA requires TLS and at most 32 KiB of PEM certificates")
		}
		roots, err = x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM([]byte(input.RootCAPEM)) {
			return result, errors.New("custom CA contains no valid PEM certificate")
		}
	}
	method, interfaceID, err := s.method(input.InterfaceID, input.Ordinal)
	if err != nil {
		return result, err
	}
	argsMsg, args, err := s.EncodeParams(method.ParamStructType(), input.Params)
	if err != nil {
		return result, fmt.Errorf("request parameters: %w", err)
	}
	defer argsMsg.Release()
	ctx, cancel := context.WithTimeout(parent, time.Duration(input.TimeoutMs)*time.Millisecond)
	defer cancel()
	addresses, err := resolveTarget(ctx, host)
	if err != nil {
		return result, err
	}
	var socket net.Conn
	for _, address := range addresses {
		dialer := net.Dialer{Timeout: 3 * time.Second}
		socket, err = dialer.DialContext(ctx, "tcp", net.JoinHostPort(address.String(), port))
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
	}
	if err != nil {
		return result, fmt.Errorf("connect: %w", err)
	}
	defer socket.Close()
	stopCancel := context.AfterFunc(ctx, func() { _ = socket.Close() })
	defer stopCancel()
	deadline, _ := ctx.Deadline()
	_ = socket.SetDeadline(deadline)
	result.RemoteAddress = socket.RemoteAddr().String()
	var stream net.Conn = socket
	if input.Transport == "tls" {
		serverName := input.ServerName
		if serverName == "" {
			serverName = host
		}
		secure := tls.Client(socket, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: serverName, RootCAs: roots})
		if err := secure.HandshakeContext(ctx); err != nil {
			return result, fmt.Errorf("TLS verification: %w", err)
		}
		result.TLSVersion = tls.VersionName(secure.ConnectionState().Version)
		stream = secure
	}
	codec := newWireCodec(stream)
	connection := rpc.NewConn(transport.New(codec), &rpc.Options{AbortTimeout: 100 * time.Millisecond, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	defer func() { _ = socket.Close(); _ = connection.Close() }()
	bootstrap := connection.Bootstrap(ctx)
	defer bootstrap.Release()
	answer, release := bootstrap.SendCall(ctx, capnp.Send{Method: capnp.Method{InterfaceID: interfaceID, MethodID: input.Ordinal}, ArgsSize: args.Size(), PlaceArgs: func(target capnp.Struct) error { return target.CopyFrom(args) }})
	defer release()
	response, err := answer.Struct()
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if err != nil {
		return result, fmt.Errorf("RPC failed: %.4096s", err.Error())
	}
	result.Result, err = s.DecodeResults(method.ResultStructType(), response)
	if err != nil {
		return result, fmt.Errorf("decode response: %w", err)
	}
	result.DurationMs, result.ObservedAt = time.Since(started).Milliseconds(), time.Now().UTC()
	return result, nil
}

func resolveTarget(ctx context.Context, host string) ([]netip.Addr, error) {
	var addresses []netip.Addr
	if address, err := netip.ParseAddr(host); err == nil {
		addresses = []netip.Addr{address}
	} else {
		var err error
		addresses, err = net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve target: %w", err)
		}
	}
	if len(addresses) == 0 || len(addresses) > 8 {
		return nil, errors.New("target must resolve to 1–8 unicast addresses")
	}
	for i, a := range addresses {
		if !a.IsValid() || a.IsUnspecified() || a.IsMulticast() || a.Unmap() == netip.MustParseAddr("255.255.255.255") {
			return nil, errors.New("target must resolve to unicast addresses")
		}
		addresses[i] = a.Unmap()
	}
	sort.SliceStable(addresses, func(i, j int) bool { return addresses[i].Is4() && !addresses[j].Is4() })
	return addresses, nil
}

// The peer cannot retain unbounded wire messages while a call is pending.
// Independent RX/TX totals are touched by their respective transport goroutines.
type wireConn struct {
	net.Conn
	received, sent int64
}

func (c *wireConn) Read(p []byte) (int, error) {
	left := int64(4<<20) - c.received
	if left <= 0 {
		return 0, errors.New("RPC receive budget exceeded")
	}
	if int64(len(p)) > left {
		p = p[:left]
	}
	n, err := c.Conn.Read(p)
	c.received += int64(n)
	return n, err
}
func (c *wireConn) Write(p []byte) (int, error) {
	if int64(len(p)) > int64(4<<20)-c.sent {
		return 0, errors.New("RPC send budget exceeded")
	}
	n, err := c.Conn.Write(p)
	c.sent += int64(n)
	return n, err
}

type wireCodec struct {
	*capnp.Decoder
	*capnp.Encoder
	io.Closer
	messages int
}

func newWireCodec(conn net.Conn) *wireCodec {
	bounded := &wireConn{Conn: conn}
	d := capnp.NewDecoder(bounded)
	d.MaxMessageSize = 2 << 20
	return &wireCodec{Decoder: d, Encoder: capnp.NewEncoder(bounded), Closer: bounded}
}
func (c *wireCodec) Decode() (*capnp.Message, error) {
	c.messages++
	if c.messages > 128 {
		return nil, errors.New("RPC message count exceeded")
	}
	m, err := c.Decoder.Decode()
	if m != nil {
		m.TraverseLimit, m.DepthLimit = 4<<20, 32
	}
	return m, err
}
