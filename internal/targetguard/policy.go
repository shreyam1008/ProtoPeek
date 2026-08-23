package targetguard

import (
	"errors"
	"fmt"
	"net/netip"
)

// Policy defines which ordinary address scopes a caller has explicitly
// authorized. IANA special-purpose ranges remain blocked in every policy.
type Policy uint8

const (
	// PublicOnly permits ordinary globally routable unicast addresses only.
	PublicOnly Policy = iota
	// PrivateOnly permits RFC 1918 and RFC 4193 addresses only.
	PrivateOnly
	// PublicOrPrivate permits ordinary public addresses plus RFC 1918/RFC 4193.
	// Use it only after an explicit private-network acknowledgement.
	PublicOrPrivate
	// LocalDevelopment additionally permits loopback and link-local targets.
	// It is intended for an explicit local-development mode, never public-site
	// analysis.
	LocalDevelopment
)

// AddressClass is a stable, human-readable classification used in evidence
// and policy errors.
type AddressClass string

const (
	AddressPublic      AddressClass = "public"
	AddressPrivate     AddressClass = "private"
	AddressLoopback    AddressClass = "loopback"
	AddressLinkLocal   AddressClass = "link-local"
	AddressUnspecified AddressClass = "unspecified"
	AddressMulticast   AddressClass = "multicast"
	AddressShared      AddressClass = "shared-address-space"
	AddressBenchmark   AddressClass = "benchmarking"
	AddressDocument    AddressClass = "documentation"
	AddressProtocol    AddressClass = "protocol-assignment"
	AddressReserved    AddressClass = "reserved"
	AddressInvalid     AddressClass = "invalid"
)

var ErrAddressBlocked = errors.New("target address is blocked by policy")

// AddressError explains why a resolved numeric address cannot be contacted.
type AddressError struct {
	Address netip.Addr
	Class   AddressClass
	Policy  Policy
}

func (err *AddressError) Error() string {
	return fmt.Sprintf("%s address %s is blocked by %s policy", err.Class, err.Address, err.Policy)
}

func (err *AddressError) Unwrap() error { return ErrAddressBlocked }

func (policy Policy) String() string {
	switch policy {
	case PublicOnly:
		return "public-only"
	case PrivateOnly:
		return "private-only"
	case PublicOrPrivate:
		return "public-or-private"
	case LocalDevelopment:
		return "local-development"
	default:
		return "invalid"
	}
}

func (policy Policy) valid() bool {
	return policy >= PublicOnly && policy <= LocalDevelopment
}

type specialPrefix struct {
	prefix netip.Prefix
	class  AddressClass
}

var specialPrefixes = []specialPrefix{
	// IPv4 special-purpose address registry. More specific intent-bearing
	// ranges precede broad reserved blocks so evidence stays useful.
	{mustPrefix("0.0.0.0/8"), AddressReserved},
	{mustPrefix("100.64.0.0/10"), AddressShared},
	{mustPrefix("192.0.0.0/24"), AddressProtocol},
	{mustPrefix("192.0.2.0/24"), AddressDocument},
	{mustPrefix("192.31.196.0/24"), AddressProtocol},
	{mustPrefix("192.52.193.0/24"), AddressProtocol},
	{mustPrefix("192.88.99.0/24"), AddressProtocol},
	{mustPrefix("192.175.48.0/24"), AddressProtocol},
	{mustPrefix("198.18.0.0/15"), AddressBenchmark},
	{mustPrefix("198.51.100.0/24"), AddressDocument},
	{mustPrefix("203.0.113.0/24"), AddressDocument},
	{mustPrefix("240.0.0.0/4"), AddressReserved},

	// IPv6 special-purpose ranges. IPv4-mapped IPv6 is unmapped before this
	// table is consulted, so the underlying IPv4 policy always wins.
	{mustPrefix("64:ff9b::/96"), AddressProtocol},
	{mustPrefix("64:ff9b:1::/48"), AddressProtocol},
	{mustPrefix("100::/64"), AddressReserved},
	{mustPrefix("2001::/23"), AddressProtocol},
	{mustPrefix("2001:db8::/32"), AddressDocument},
	{mustPrefix("2002::/16"), AddressProtocol},
	{mustPrefix("3fff::/20"), AddressDocument},
	{mustPrefix("5f00::/16"), AddressProtocol},
	{mustPrefix("fec0::/10"), AddressReserved},
}

func mustPrefix(value string) netip.Prefix {
	return netip.MustParsePrefix(value)
}

// ClassifyAddress canonicalizes IPv4-mapped IPv6 before classifying the
// address. A zoned address is intentionally treated as link-local evidence;
// URL targets with zones are rejected during normalization.
func ClassifyAddress(address netip.Addr) AddressClass {
	if !address.IsValid() {
		return AddressInvalid
	}
	address = address.Unmap()
	if address.IsUnspecified() {
		return AddressUnspecified
	}
	if address.IsLoopback() {
		return AddressLoopback
	}
	if address.IsPrivate() {
		return AddressPrivate
	}
	if address.IsMulticast() {
		return AddressMulticast
	}
	if address.IsLinkLocalUnicast() {
		return AddressLinkLocal
	}
	for _, special := range specialPrefixes {
		if special.prefix.Contains(address) {
			return special.class
		}
	}
	if address.IsGlobalUnicast() {
		return AddressPublic
	}
	return AddressReserved
}

// ValidateAddress applies the selected strict policy to one numeric address.
func ValidateAddress(address netip.Addr, policy Policy) error {
	address = address.Unmap()
	class := ClassifyAddress(address)
	allowed := false
	switch class {
	case AddressPublic:
		allowed = policy == PublicOnly || policy == PublicOrPrivate || policy == LocalDevelopment
	case AddressPrivate:
		allowed = policy == PrivateOnly || policy == PublicOrPrivate || policy == LocalDevelopment
	case AddressLoopback, AddressLinkLocal:
		allowed = policy == LocalDevelopment
	}
	if !policy.valid() || !allowed {
		return &AddressError{Address: address, Class: class, Policy: policy}
	}
	return nil
}
