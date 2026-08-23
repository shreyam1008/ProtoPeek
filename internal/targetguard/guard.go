// Package targetguard provides resolve-once, validate-all, and dial-pinned
// primitives for bounded website observations. It never probes a target by
// itself; callers must explicitly resolve a URL and perform an operation.
package targetguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

const (
	defaultMaxAddresses = 8
	hardMaxAddresses    = 32
)

var (
	ErrInvalidTarget    = errors.New("invalid website target")
	ErrTooManyAddresses = errors.New("target resolved to too many addresses")
	ErrUnpinnedAddress  = errors.New("transport refused an unpinned address")
)

// Resolver is the narrow DNS contract used by Guard and deterministic tests.
type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

// DialContextFunc is compatible with net.Dialer.DialContext.
type DialContextFunc func(context.Context, string, string) (net.Conn, error)

// Config controls address policy and hard resource bounds.
type Config struct {
	Policy       Policy
	Resolver     Resolver
	MaxAddresses int
	DialContext  DialContextFunc
}

// Guard validates and pins targets. It is safe for concurrent use.
type Guard struct {
	policy       Policy
	resolver     Resolver
	maxAddresses int
	dialContext  DialContextFunc
}

// New constructs a Guard without performing DNS or network I/O.
func New(config Config) (*Guard, error) {
	if !config.Policy.valid() {
		return nil, fmt.Errorf("%w: unknown address policy", ErrInvalidTarget)
	}
	if config.Resolver == nil {
		config.Resolver = net.DefaultResolver
	}
	if config.MaxAddresses == 0 {
		config.MaxAddresses = defaultMaxAddresses
	}
	if config.MaxAddresses < 1 || config.MaxAddresses > hardMaxAddresses {
		return nil, fmt.Errorf("%w: max addresses must be between 1 and %d", ErrInvalidTarget, hardMaxAddresses)
	}
	if config.DialContext == nil {
		dialer := &net.Dialer{}
		config.DialContext = dialer.DialContext
	}
	return &Guard{
		policy:       config.Policy,
		resolver:     config.Resolver,
		maxAddresses: config.MaxAddresses,
		dialContext:  config.DialContext,
	}, nil
}

// Target is a normalized URL plus the complete, policy-approved DNS answer
// set observed at resolution time. Its fields are immutable outside this
// package; accessors return copies where mutation would matter.
type Target struct {
	url       url.URL
	hostname  string
	port      string
	addresses []netip.Addr
}

func (target *Target) URL() *url.URL {
	value := target.url
	return &value
}

func (target *Target) Hostname() string { return target.hostname }
func (target *Target) Port() string     { return target.port }

func (target *Target) Addresses() []netip.Addr {
	return append([]netip.Addr(nil), target.addresses...)
}

func (target *Target) authority() string {
	return net.JoinHostPort(target.hostname, target.port)
}

// NormalizeHostname converts Unicode DNS names with the IDNA Lookup profile,
// canonicalizes IP literals, removes one absolute-DNS trailing dot, and rejects
// ambiguous or invalid labels.
func NormalizeHostname(input string) (string, error) {
	hostname := strings.TrimSpace(input)
	if hostname == "" || !utf8.ValidString(hostname) {
		return "", fmt.Errorf("%w: hostname is required", ErrInvalidTarget)
	}
	if strings.ContainsAny(hostname, "[]/%?#@\t\r\n ") {
		return "", fmt.Errorf("%w: hostname contains forbidden characters", ErrInvalidTarget)
	}
	if address, err := netip.ParseAddr(hostname); err == nil {
		if address.Zone() != "" {
			return "", fmt.Errorf("%w: zoned IP literals are not supported", ErrInvalidTarget)
		}
		return address.Unmap().String(), nil
	}
	hostname = strings.TrimSuffix(hostname, ".")
	if hostname == "" || strings.HasSuffix(hostname, ".") {
		return "", fmt.Errorf("%w: hostname has an empty label", ErrInvalidTarget)
	}
	ascii, err := idna.Lookup.ToASCII(hostname)
	if err != nil {
		return "", fmt.Errorf("%w: invalid IDNA hostname: %v", ErrInvalidTarget, err)
	}
	ascii = strings.ToLower(ascii)
	if len(ascii) > 253 {
		return "", fmt.Errorf("%w: hostname exceeds 253 bytes", ErrInvalidTarget)
	}
	for _, label := range strings.Split(ascii, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", fmt.Errorf("%w: invalid DNS label", ErrInvalidTarget)
		}
		for _, character := range label {
			if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '-' {
				continue
			}
			return "", fmt.Errorf("%w: invalid DNS label", ErrInvalidTarget)
		}
	}
	return ascii, nil
}

// NormalizeURL accepts HTTP(S) only, rejects user-info, normalizes IDNA and IP
// literals, validates the port, and strips fragments that are never sent on the
// wire.
func NormalizeURL(input string) (*url.URL, error) {
	raw := strings.TrimSpace(input)
	if raw == "" || !utf8.ValidString(raw) || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return nil, fmt.Errorf("%w: URL must be valid text", ErrInvalidTarget)
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.Opaque != "" {
		return nil, fmt.Errorf("%w: URL must be absolute", ErrInvalidTarget)
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%w: URL scheme must be http or https", ErrInvalidTarget)
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("%w: URL user-info is not allowed", ErrInvalidTarget)
	}
	hostname, err := NormalizeHostname(parsed.Hostname())
	if err != nil {
		return nil, err
	}
	port := parsed.Port()
	if port != "" {
		number, conversionErr := strconv.Atoi(port)
		if conversionErr != nil || number < 1 || number > 65535 {
			return nil, fmt.Errorf("%w: URL port must be between 1 and 65535", ErrInvalidTarget)
		}
		parsed.Host = net.JoinHostPort(hostname, port)
	} else if strings.Contains(hostname, ":") {
		parsed.Host = "[" + hostname + "]"
	} else {
		parsed.Host = hostname
	}
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return parsed, nil
}

// ResolveAndPin normalizes an absolute HTTP(S) URL, resolves its hostname once,
// validates every returned answer, and retains only that complete answer set.
func (guard *Guard) ResolveAndPin(ctx context.Context, input string) (*Target, error) {
	normalized, err := NormalizeURL(input)
	if err != nil {
		return nil, err
	}
	return guard.ResolveAndPinURL(ctx, normalized)
}

// ResolveAndPinURL is the parsed-URL form of ResolveAndPin.
func (guard *Guard) ResolveAndPinURL(ctx context.Context, input *url.URL) (*Target, error) {
	if input == nil {
		return nil, fmt.Errorf("%w: URL is required", ErrInvalidTarget)
	}
	normalized, err := NormalizeURL(input.String())
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	hostname := normalized.Hostname()
	port := normalized.Port()
	if port == "" {
		if normalized.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	var resolved []netip.Addr
	if address, parseErr := netip.ParseAddr(hostname); parseErr == nil {
		resolved = []netip.Addr{address.Unmap()}
	} else {
		if guard.policy == PublicOnly && !strings.Contains(hostname, ".") {
			return nil, fmt.Errorf("%w: public hostname must be fully qualified", ErrInvalidTarget)
		}
		// A trailing dot prevents the platform resolver from applying a local DNS
		// search suffix while the URL/SNI hostname remains canonical.
		resolved, err = guard.resolver.LookupNetIP(ctx, "ip", hostname+".")
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", hostname, err)
		}
	}
	if len(resolved) == 0 {
		return nil, fmt.Errorf("resolve %s: no addresses", hostname)
	}
	if len(resolved) > guard.maxAddresses {
		return nil, fmt.Errorf("%w: %s returned %d answers (limit %d)", ErrTooManyAddresses, hostname, len(resolved), guard.maxAddresses)
	}

	addresses := make([]netip.Addr, 0, len(resolved))
	seen := make(map[netip.Addr]struct{}, len(resolved))
	for _, address := range resolved {
		if address.Zone() != "" {
			return nil, fmt.Errorf("%w: resolved zoned address %s", ErrAddressBlocked, address)
		}
		address = address.Unmap()
		if err := ValidateAddress(address, guard.policy); err != nil {
			return nil, fmt.Errorf("resolved address %s: %w", address, err)
		}
		if _, exists := seen[address]; exists {
			continue
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("resolve %s: no usable addresses", hostname)
	}
	return &Target{url: *normalized, hostname: hostname, port: port, addresses: addresses}, nil
}

func (guard *Guard) dialTarget(ctx context.Context, network string, target *Target) (net.Conn, error) {
	if network != "tcp" && network != "tcp4" && network != "tcp6" {
		return nil, fmt.Errorf("%w: unsupported network %q", ErrUnpinnedAddress, network)
	}
	var failures []error
	matched := false
	for _, address := range target.addresses {
		if network == "tcp4" && !address.Is4() || network == "tcp6" && !address.Is6() {
			continue
		}
		matched = true
		connection, err := guard.dialContext(ctx, network, net.JoinHostPort(address.String(), target.port))
		if err == nil {
			return connection, nil
		}
		failures = append(failures, err)
		if ctx.Err() != nil {
			break
		}
	}
	if !matched {
		return nil, fmt.Errorf("%w: no pinned address matches %s", ErrUnpinnedAddress, network)
	}
	return nil, fmt.Errorf("dial pinned target %s: %w", target.authority(), errors.Join(failures...))
}
