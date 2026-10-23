package netdiag

import (
	"fmt"
	"math/big"
	"net/netip"
)

func planSubnet(raw string) (*SubnetEvidence, error) {
	prefix, err := netip.ParsePrefix(raw)
	if err != nil || prefix.Addr().Is4In6() || prefix.Addr().Zone() != "" {
		return nil, fmt.Errorf("%w: enter an IPv4 or IPv6 CIDR prefix", ErrInvalid)
	}
	prefix = prefix.Masked()
	address := prefix.Addr()
	bits := address.BitLen()
	total := new(big.Int).Lsh(big.NewInt(1), uint(bits-prefix.Bits()))
	first := new(big.Int).SetBytes(address.AsSlice())
	last := new(big.Int).Sub(new(big.Int).Add(first, total), big.NewInt(1))
	toAddr := func(value *big.Int) string {
		data := value.FillBytes(make([]byte, bits/8))
		parsed, _ := netip.AddrFromSlice(data)
		return parsed.String()
	}
	usable := new(big.Int).Set(total)
	firstUsable, lastUsable := new(big.Int).Set(first), new(big.Int).Set(last)
	detail := "IPv6 counts every address; this is an address range, not an allocation or reachability guarantee."
	family := "IPv6"
	if address.Is4() {
		family = "IPv4"
		detail = "IPv4 prefixes through /30 exclude network and broadcast. /31 uses point-to-point semantics; /32 is one address."
		if prefix.Bits() <= 30 {
			usable.Sub(usable, big.NewInt(2))
			firstUsable.Add(firstUsable, big.NewInt(1))
			lastUsable.Sub(lastUsable, big.NewInt(1))
		}
	}
	private := address.Is4() && (netip.MustParsePrefix("10.0.0.0/8").Contains(address) || netip.MustParsePrefix("172.16.0.0/12").Contains(address) || netip.MustParsePrefix("192.168.0.0/16").Contains(address))
	return &SubnetEvidence{Prefix: prefix.String(), Family: family, Network: address.String(), First: toAddr(first), Last: toAddr(last),
		TotalAddresses: total.String(), UsableHosts: usable.String(), FirstUsable: toAddr(firstUsable), LastUsable: toAddr(lastUsable),
		DiscoveryEligible: private && prefix.Bits() >= 24, Detail: detail}, nil
}
