package netdiag

import (
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

var ErrInvalid = errors.New("invalid diagnostic")

type endpoint struct {
	host string
	port string
}

func (value endpoint) authority() string { return net.JoinHostPort(value.host, value.port) }

func parseEndpoint(input string, defaultPort int) (endpoint, error) {
	raw := strings.TrimSpace(input)
	if raw == "" || len(raw) > 1024 || !utf8.ValidString(raw) || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return endpoint{}, fmt.Errorf("%w: enter a host, host:port, or HTTP(S) URL", ErrInvalid)
	}
	var host, port string
	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.User != nil || parsed.Opaque != "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return endpoint{}, fmt.Errorf("%w: use an HTTP(S) address without credentials", ErrInvalid)
		}
		host, port = parsed.Hostname(), parsed.Port()
		if port == "" {
			if strings.HasSuffix(parsed.Host, ":") {
				return endpoint{}, fmt.Errorf("%w: port is empty", ErrInvalid)
			}
			if parsed.Scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
	} else {
		if strings.ContainsAny(raw, "/?#@\\") {
			return endpoint{}, fmt.Errorf("%w: use a host or host:port without paths or credentials", ErrInvalid)
		}
		literal := raw
		if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
			literal = raw[1 : len(raw)-1]
		}
		if parsed, err := netip.ParseAddr(literal); err == nil {
			host = parsed.String()
		} else if strings.Contains(raw, ":") {
			var err error
			host, port, err = net.SplitHostPort(raw)
			if err != nil || port == "" {
				return endpoint{}, fmt.Errorf("%w: use host:port; bracket IPv6 addresses", ErrInvalid)
			}
		} else {
			host = raw
		}
	}
	if address, err := netip.ParseAddr(host); err == nil {
		zone := address.Zone()
		if len(zone) > 64 || strings.IndexFunc(zone, func(r rune) bool {
			return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_.-", r))
		}) >= 0 {
			return endpoint{}, fmt.Errorf("%w: invalid IPv6 zone", ErrInvalid)
		}
		host = address.Unmap().String()
	} else {
		var err error
		host, err = targetguard.NormalizeHostname(host)
		if err != nil {
			return endpoint{}, fmt.Errorf("%w: invalid hostname", ErrInvalid)
		}
	}
	if port == "" {
		port = strconv.Itoa(defaultPort)
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return endpoint{}, fmt.Errorf("%w: port must be 1–65535", ErrInvalid)
	}
	return endpoint{host: host, port: strconv.Itoa(number)}, nil
}

func validateRequest(input Request) error {
	switch input.Mode {
	case "diagnose", "dns", "dns-compare", "tls", "ip-compare", "availability", "tcp-exchange", "udp-exchange", "http-proxy", "socks5-proxy", "http2", "http3", "subnet":
	default:
		return fmt.Errorf("%w: choose a supported diagnostic", ErrInvalid)
	}
	if input.TimeoutMS < 100 || input.TimeoutMS > 3000 {
		return fmt.Errorf("%w: timeout must be 100–3000 ms", ErrInvalid)
	}
	if len(input.CAPEM) > 64<<10 {
		return fmt.Errorf("%w: private CA PEM exceeds 64 KiB", ErrInvalid)
	}
	if input.CAPEM != "" && !x509.NewCertPool().AppendCertsFromPEM([]byte(input.CAPEM)) {
		return fmt.Errorf("%w: private CA must contain a PEM certificate", ErrInvalid)
	}
	if input.Mode == "http3" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(input.Target)), "http://") {
		return fmt.Errorf("%w: HTTP/3 requires HTTPS", ErrInvalid)
	}
	if len(input.ServerName) > 253 || strings.IndexFunc(input.ServerName, unicode.IsControl) >= 0 {
		return fmt.Errorf("%w: invalid TLS server name", ErrInvalid)
	}
	if len(input.ALPN) > 8 {
		return fmt.Errorf("%w: choose at most 8 ALPN protocols", ErrInvalid)
	}
	for _, value := range input.ALPN {
		if value == "" || len(value) > 64 || strings.IndexFunc(value, func(r rune) bool { return r < 33 || r > 126 }) >= 0 {
			return fmt.Errorf("%w: invalid ALPN protocol", ErrInvalid)
		}
	}
	if input.Mode == "availability" && (input.Samples < 1 || input.Samples > 20 || input.IntervalMS < 0 || input.IntervalMS > 1000) {
		return fmt.Errorf("%w: use 1–20 samples and 0–1000 ms interval", ErrInvalid)
	}
	if len(input.ProxyUsername) > 255 || len(input.ProxyPassword) > 255 || strings.ContainsAny(input.ProxyUsername+input.ProxyPassword, "\r\n\x00") {
		return fmt.Errorf("%w: proxy credentials are invalid or exceed 255 bytes", ErrInvalid)
	}
	if input.ProxyPassword != "" && input.ProxyUsername == "" {
		return fmt.Errorf("%w: provide a proxy username", ErrInvalid)
	}
	if input.Mode == "tcp-exchange" || input.Mode == "udp-exchange" {
		if strings.Contains(input.Target, "://") {
			return fmt.Errorf("%w: raw exchange requires host:port without a URL", ErrInvalid)
		}
		_, err := payloadBytes(input)
		return err
	}
	return nil
}

func payloadBytes(input Request) ([]byte, error) {
	if len(input.Payload) > 3*MaxPayloadBytes {
		return nil, fmt.Errorf("%w: payload exceeds 4 KiB", ErrInvalid)
	}
	var data []byte
	switch input.Encoding {
	case "text":
		if !utf8.ValidString(input.Payload) {
			return nil, fmt.Errorf("%w: payload must be UTF-8 text or hex", ErrInvalid)
		}
		data = []byte(input.Payload)
	case "hex":
		text := strings.Join(strings.Fields(input.Payload), "")
		var err error
		data, err = hex.DecodeString(text)
		if err != nil {
			return nil, fmt.Errorf("%w: enter complete hexadecimal byte pairs", ErrInvalid)
		}
	default:
		return nil, fmt.Errorf("%w: choose text or hex payload", ErrInvalid)
	}
	if len(data) > MaxPayloadBytes {
		return nil, fmt.Errorf("%w: payload exceeds 4 KiB", ErrInvalid)
	}
	return data, nil
}
