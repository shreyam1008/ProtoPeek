package targetguard

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (function resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return function(ctx, network, host)
}

func TestPublicPolicyRejectsEveryMixedAnswer(t *testing.T) {
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("10.0.0.9"),
		}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})

	_, err := guard.ResolveAndPin(context.Background(), "https://example.com/report")
	if !errors.Is(err, ErrAddressBlocked) {
		t.Fatalf("ResolveAndPin() error = %v, want ErrAddressBlocked", err)
	}
	if !strings.Contains(err.Error(), "private") {
		t.Fatalf("ResolveAndPin() error = %q, want private classification", err)
	}
}

func TestResolveAndPinNormalizesIDNAAndUsesAbsoluteDNSName(t *testing.T) {
	var lookupHost string
	resolver := resolverFunc(func(_ context.Context, network, host string) ([]netip.Addr, error) {
		if network != "ip" {
			t.Fatalf("LookupNetIP() network = %q, want ip", network)
		}
		lookupHost = host
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})

	target, err := guard.ResolveAndPin(context.Background(), "HTTPS://BÜCHER.example./guide#ignored")
	if err != nil {
		t.Fatalf("ResolveAndPin() error = %v", err)
	}
	if target.Hostname() != "xn--bcher-kva.example" {
		t.Fatalf("Hostname() = %q", target.Hostname())
	}
	if lookupHost != "xn--bcher-kva.example." {
		t.Fatalf("LookupNetIP() host = %q, want absolute DNS name", lookupHost)
	}
	if target.URL().Fragment != "" {
		t.Fatalf("URL fragment = %q, want stripped", target.URL().Fragment)
	}
}

func TestResolveAndPinUnmapsIPv4MappedIPv6(t *testing.T) {
	guard := mustGuard(t, Config{Policy: LocalDevelopment})
	target, err := guard.ResolveAndPin(context.Background(), "http://[::ffff:127.0.0.1]:8080/")
	if err != nil {
		t.Fatalf("ResolveAndPin() error = %v", err)
	}
	if target.Hostname() != "127.0.0.1" {
		t.Fatalf("Hostname() = %q, want 127.0.0.1", target.Hostname())
	}
	want := []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	if !reflect.DeepEqual(target.Addresses(), want) {
		t.Fatalf("Addresses() = %v, want %v", target.Addresses(), want)
	}
}

func TestResolveAndPinBoundsRawDNSAnswers(t *testing.T) {
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.30"),
			netip.MustParseAddr("93.184.216.31"),
			netip.MustParseAddr("93.184.216.32"),
		}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver, MaxAddresses: 2})

	_, err := guard.ResolveAndPin(context.Background(), "https://example.com")
	if !errors.Is(err, ErrTooManyAddresses) {
		t.Fatalf("ResolveAndPin() error = %v, want ErrTooManyAddresses", err)
	}
}

func TestSessionDialsPinnedAddressWithoutReResolving(t *testing.T) {
	lookupCalls := 0
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		lookupCalls++
		if lookupCalls == 1 {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("93.184.216.35")}, nil
	})
	var dialed string
	dialErr := errors.New("test dial stopped")
	guard := mustGuard(t, Config{
		Policy:   PublicOnly,
		Resolver: resolver,
		DialContext: func(_ context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" {
				t.Fatalf("dial network = %q, want tcp", network)
			}
			dialed = address
			return nil, dialErr
		},
	})
	session, err := guard.NewSession(context.Background(), "https://example.com/resource", SessionConfig{})
	if err != nil {
		t.Fatalf("NewSession() error = %v", err)
	}

	_, err = session.dialContext(context.Background(), "tcp", "example.com:443")
	if !errors.Is(err, dialErr) {
		t.Fatalf("dialContext() error = %v, want test dial error", err)
	}
	if lookupCalls != 1 {
		t.Fatalf("resolver calls = %d, want exactly 1", lookupCalls)
	}
	if dialed != "93.184.216.34:443" {
		t.Fatalf("dial address = %q, want first pinned IP", dialed)
	}
}

func TestSessionRejectsUnpinnedAuthority(t *testing.T) {
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	})
	guard := mustGuard(t, Config{Policy: PublicOnly, Resolver: resolver})
	session, err := guard.NewSession(context.Background(), "https://example.com", SessionConfig{})
	if err != nil {
		t.Fatalf("NewSession() error = %v", err)
	}

	_, err = session.dialContext(context.Background(), "tcp", "unapproved.example:443")
	if !errors.Is(err, ErrUnpinnedAddress) {
		t.Fatalf("dialContext() error = %v, want ErrUnpinnedAddress", err)
	}
}

func TestAddressClassificationAndStrictPolicies(t *testing.T) {
	tests := []struct {
		address string
		class   AddressClass
	}{
		{"0.0.0.1", AddressReserved},
		{"10.0.0.1", AddressPrivate},
		{"100.64.0.1", AddressShared},
		{"127.0.0.1", AddressLoopback},
		{"169.254.1.1", AddressLinkLocal},
		{"192.0.2.1", AddressDocument},
		{"198.18.0.1", AddressBenchmark},
		{"203.0.113.1", AddressDocument},
		{"224.0.0.1", AddressMulticast},
		{"240.0.0.1", AddressReserved},
		{"::", AddressUnspecified},
		{"::1", AddressLoopback},
		{"64:ff9b::1", AddressProtocol},
		{"100::1", AddressReserved},
		{"2001:db8::1", AddressDocument},
		{"3fff::1", AddressDocument},
		{"fc00::1", AddressPrivate},
		{"fe80::1", AddressLinkLocal},
		{"ff02::1", AddressMulticast},
		{"93.184.216.34", AddressPublic},
		{"2606:4700:4700::1111", AddressPublic},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			address := netip.MustParseAddr(test.address)
			if got := ClassifyAddress(address); got != test.class {
				t.Fatalf("ClassifyAddress() = %q, want %q", got, test.class)
			}
			if test.class != AddressPublic && !errors.Is(ValidateAddress(address, PublicOnly), ErrAddressBlocked) {
				t.Fatalf("PublicOnly unexpectedly allowed %s", address)
			}
		})
	}

	if err := ValidateAddress(netip.MustParseAddr("10.0.0.1"), PrivateOnly); err != nil {
		t.Fatalf("PrivateOnly private error = %v", err)
	}
	if err := ValidateAddress(netip.MustParseAddr("93.184.216.34"), PrivateOnly); !errors.Is(err, ErrAddressBlocked) {
		t.Fatalf("PrivateOnly public error = %v, want blocked", err)
	}
	if err := ValidateAddress(netip.MustParseAddr("127.0.0.1"), PublicOrPrivate); !errors.Is(err, ErrAddressBlocked) {
		t.Fatalf("PublicOrPrivate loopback error = %v, want blocked", err)
	}
	if err := ValidateAddress(netip.MustParseAddr("127.0.0.1"), LocalDevelopment); err != nil {
		t.Fatalf("LocalDevelopment loopback error = %v", err)
	}
}

func TestNormalizeURLRejectsCredentialsAndBadPorts(t *testing.T) {
	for _, input := range []string{
		"https://user:pass@example.com",
		"ftp://example.com/file",
		"https://example.com:70000",
		"https://[fe80::1%25eth0]/",
	} {
		t.Run(url.PathEscape(input), func(t *testing.T) {
			if _, err := NormalizeURL(input); !errors.Is(err, ErrInvalidTarget) {
				t.Fatalf("NormalizeURL(%q) error = %v, want ErrInvalidTarget", input, err)
			}
		})
	}
}

func mustGuard(t *testing.T, config Config) *Guard {
	t.Helper()
	guard, err := New(config)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return guard
}
