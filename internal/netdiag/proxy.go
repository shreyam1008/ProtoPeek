package netdiag

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strconv"
	"strings"
)

func (engine Engine) proxy(ctx context.Context, input Request, destination endpoint, address netip.Addr, result *Result) error {
	if address.Zone() != "" {
		return fmt.Errorf("%w: a proxy tunnel cannot encode a local IPv6 scope zone", ErrInvalid)
	}
	defaultPort := 8080
	if input.Mode == "socks5-proxy" {
		defaultPort = 1080
	}
	// Proxy diagnostics implement plain HTTP CONNECT or SOCKS, not HTTPS proxy
	// transport. Reject URL forms rather than silently discarding a security scheme.
	rawProxy := strings.TrimSpace(input.Proxy)
	if strings.ContainsAny(rawProxy, "/\\?#@") {
		return fmt.Errorf("%w: enter a proxy host and port; URL schemes, paths, queries and credentials in the address are unsupported", ErrInvalid)
	}
	target, err := parseEndpoint(rawProxy, defaultPort)
	if err != nil {
		return fmt.Errorf("%w: enter the proxy host and port without credentials", ErrInvalid)
	}
	proxies, err := engine.resolve(ctx, target.host)
	if err != nil {
		return fmt.Errorf("%w: proxy resolution failed", ErrInvalid)
	}
	protocol := "HTTP CONNECT"
	if input.Mode == "socks5-proxy" {
		protocol = "SOCKS5"
	}
	evidence := &ProxyEvidence{Protocol: protocol, Address: net.JoinHostPort(proxies[0].String(), target.port), Destination: net.JoinHostPort(address.String(), destination.port), Resolution: "Destination resolved by ProtoPeek and pinned to the displayed numeric address. Proxy DNS was not tested.", Outcome: "failed"}
	result.Proxy = evidence
	conn, check, closeConn := engine.connect(ctx, input.TimeoutMS, "tcp", target, proxies[0])
	defer closeConn()
	check.Stage = "proxy-tcp"
	result.Checks = append(result.Checks, check)
	if conn == nil {
		result.Outcome, result.Summary = "failed", "The proxy could not be reached."
		return nil
	}
	if input.Mode == "http-proxy" {
		evidence.Status, err = connectHTTP(conn, evidence.Destination, input.ProxyUsername, input.ProxyPassword)
	} else {
		evidence.Status, err = connectSOCKS(conn, address, destination.port, input.ProxyUsername, input.ProxyPassword)
	}
	if err != nil {
		evidence.Detail = err.Error()
		result.Outcome, result.Summary = "failed", "The proxy did not accept the requested tunnel."
	} else {
		evidence.Outcome = "accepted"
		evidence.Detail = "The proxy accepted the tunnel. No application data was sent through it."
		result.Summary = "Proxy tunnel accepted; end-to-end application health was not tested."
	}
	return nil
}

func connectHTTP(conn net.Conn, destination, username, password string) (int, error) {
	request := "CONNECT " + destination + " HTTP/1.1\r\nHost: " + destination + "\r\n"
	if username != "" {
		request += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password)) + "\r\n"
	}
	if _, err := io.WriteString(conn, request+"\r\n"); err != nil {
		return 0, fmt.Errorf("Could not send the proxy handshake.")
	}
	// Do not reflect proxy-controlled status text or headers: they can echo credentials.
	reader := bufio.NewReader(io.LimitReader(conn, 16<<10))
	line, err := reader.ReadString('\n')
	if err != nil {
		return 0, fmt.Errorf("Incomplete or oversized proxy response.")
	}
	parts := strings.SplitN(strings.TrimSpace(line), " ", 3)
	if len(parts) < 2 || (parts[0] != "HTTP/1.1" && parts[0] != "HTTP/1.0") || len(parts[1]) != 3 {
		return 0, fmt.Errorf("Invalid HTTP proxy status line.")
	}
	status, err := strconv.Atoi(parts[1])
	if err != nil || status < 100 || status > 599 {
		return 0, fmt.Errorf("Invalid HTTP proxy status code.")
	}
	for count := 0; count < 128; count++ {
		line, err = reader.ReadString('\n')
		if err != nil {
			return status, fmt.Errorf("Incomplete or oversized proxy headers.")
		}
		if line == "\r\n" {
			if status >= 200 && status < 300 {
				return status, nil
			}
			return status, fmt.Errorf("Proxy returned HTTP status %d.", status)
		}
	}
	return status, fmt.Errorf("Proxy returned too many headers.")
}

func connectSOCKS(conn net.Conn, address netip.Addr, port, username, password string) (int, error) {
	method := byte(0)
	if username != "" {
		method = 2
	}
	if _, err := conn.Write([]byte{5, 1, method}); err != nil {
		return 0, fmt.Errorf("Could not send SOCKS greeting.")
	}
	var reply [2]byte
	if _, err := io.ReadFull(conn, reply[:]); err != nil || reply[0] != 5 || reply[1] != method {
		return 0, fmt.Errorf("SOCKS proxy rejected the requested authentication method.")
	}
	if method == 2 {
		packet := append([]byte{1, byte(len(username))}, []byte(username)...)
		packet = append(packet, byte(len(password)))
		packet = append(packet, []byte(password)...)
		if _, err := conn.Write(packet); err != nil {
			return 0, fmt.Errorf("Could not send SOCKS authentication.")
		}
		if _, err := io.ReadFull(conn, reply[:]); err != nil || reply[0] != 1 || reply[1] != 0 {
			return 0, fmt.Errorf("SOCKS authentication was not accepted.")
		}
	}
	packet := []byte{5, 1, 0, 1}
	if address.Is6() {
		packet[3] = 4
	}
	packet = append(packet, address.WithZone("").AsSlice()...)
	portValue, _ := strconv.Atoi(port)
	packet = binary.BigEndian.AppendUint16(packet, uint16(portValue))
	if _, err := conn.Write(packet); err != nil {
		return 0, fmt.Errorf("Could not send SOCKS connect request.")
	}
	var header [4]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil || header[0] != 5 || header[2] != 0 {
		return 0, fmt.Errorf("Invalid SOCKS connect response.")
	}
	if header[1] != 0 {
		return int(header[1]), fmt.Errorf("SOCKS proxy returned connect status %d.", header[1])
	}
	length := 0
	switch header[3] {
	case 1:
		length = 4
	case 4:
		length = 16
	case 3:
		var size [1]byte
		if _, err := io.ReadFull(conn, size[:]); err != nil {
			return 0, fmt.Errorf("Incomplete SOCKS bound address.")
		}
		length = int(size[0])
	default:
		return 0, fmt.Errorf("Invalid SOCKS address type.")
	}
	if _, err := io.CopyN(io.Discard, conn, int64(length+2)); err != nil {
		return 0, fmt.Errorf("Incomplete SOCKS bound address.")
	}
	return 0, nil
}
