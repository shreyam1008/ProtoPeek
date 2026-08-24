package thispc

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

const (
	ipifyIPv4Endpoint   = "https://api.ipify.org"
	ipifyIPv6Endpoint   = "https://api6.ipify.org"
	publicLookupTimeout = 5 * time.Second
	maxIPifyBodyBytes   = 8 << 10
	maxCymruTXTBytes    = 8 << 10
	maxCymruTXTRecords  = 8
	cymruIPv4Suffix     = ".origin.asn.cymru.com."
	cymruIPv6Suffix     = ".origin6.asn.cymru.com."
	cymruASNNameSuffix  = ".asn.cymru.com."
)

var errBGPAmbiguous = errors.New("ambiguous Team Cymru BGP origin evidence")

type ipifyFetcher interface {
	Fetch(context.Context, string) (netip.Addr, error)
}

type bgpOriginLookup interface {
	Lookup(context.Context, netip.Addr) (*BGPOriginNetwork, error, error)
}

type publicDependencies struct {
	fetcher ipifyFetcher
	origin  bgpOriginLookup
	now     func() time.Time
}

func newPublicReader() publicReader {
	resolver := net.DefaultResolver
	return publicDependencies{
		fetcher: newIPifyFetcher(resolver, nil),
		origin:  &cymruClient{resolver: resolver},
		now:     time.Now,
	}.read
}

func (dependencies publicDependencies) read(parent context.Context, families []string) PublicIdentity {
	result := PublicIdentity{
		SchemaVersion:             SchemaVersion,
		ObservedAt:                dependencies.now().UTC(),
		Provider:                  ipifyProvider,
		ExternalRequestDisclosure: "Each selected family sends one credential-free HTTPS request to its fixed ipify endpoint. The observed public address is provider-reported and may reflect NAT, a VPN, or another egress path.",
		DNSResolverDisclosure:     dnsDisclosure,
		Families:                  make([]PublicFamilyResult, len(families)),
	}
	ctx, cancel := context.WithTimeout(parent, publicLookupTimeout)
	defer cancel()
	type indexedResult struct {
		index  int
		result PublicFamilyResult
	}
	completed := make(chan indexedResult, len(families))
	delivered := make([]bool, len(families))
	for index, family := range families {
		index, family := index, family
		go func() {
			completed <- indexedResult{index: index, result: dependencies.readFamily(ctx, family)}
		}()
	}
	for remaining := len(families); remaining > 0; {
		select {
		case item := <-completed:
			if delivered[item.index] {
				continue
			}
			delivered[item.index] = true
			result.Families[item.index] = item.result
			remaining--
		case <-ctx.Done():
			for index, family := range families {
				if delivered[index] {
					continue
				}
				label := "public IPv4 path unavailable"
				if family == "ipv6" {
					label = "public IPv6 path unavailable"
				}
				result.Families[index] = PublicFamilyResult{
					Family: family, Status: "unavailable", BGPOriginStatus: "not-attempted",
					Error: label + ": " + publicSafeError(ctx.Err()),
				}
			}
			remaining = 0
		}
	}
	result.ObservedAt = dependencies.now().UTC()
	return result
}

func (dependencies publicDependencies) readFamily(ctx context.Context, family string) PublicFamilyResult {
	result := PublicFamilyResult{Family: family, Status: "unavailable", BGPOriginStatus: "not-attempted"}
	address, err := dependencies.fetcher.Fetch(ctx, family)
	if err != nil {
		label := "public IPv4 path unavailable"
		if family == "ipv6" {
			label = "public IPv6 path unavailable"
		}
		result.Error = label + ": " + publicSafeError(err)
		return result
	}
	result.Status = "ok"
	result.Address = address.String()
	result.BGPOriginStatus = "unavailable"
	origin, nameErr, err := dependencies.origin.Lookup(ctx, address)
	if err != nil {
		if errors.Is(err, errBGPAmbiguous) {
			result.BGPOriginStatus = "ambiguous"
		}
		result.BGPOriginError = publicSafeError(err)
		return result
	}
	result.BGPOriginStatus = "ok"
	result.BGPOriginNetwork = origin
	if nameErr != nil {
		result.BGPOriginError = "ASN name unavailable: " + publicSafeError(nameErr)
	}
	return result
}

type lookupNetIPResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type familyResolver struct {
	resolver lookupNetIPResolver
	network  string
}

func (resolver familyResolver) LookupNetIP(ctx context.Context, _ string, host string) ([]netip.Addr, error) {
	addresses, err := resolver.resolver.LookupNetIP(ctx, resolver.network, host)
	if err != nil {
		return nil, err
	}
	result := make([]netip.Addr, 0, len(addresses))
	for _, address := range addresses {
		address = address.Unmap()
		if resolver.network == "ip4" && address.Is4() || resolver.network == "ip6" && address.Is6() {
			result = append(result, address)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("fixed provider has no %s address", resolver.network)
	}
	return result, nil
}

type ipifyClient struct {
	ipv4 *targetguard.Guard
	ipv6 *targetguard.Guard
}

func newIPifyFetcher(resolver lookupNetIPResolver, dial targetguard.DialContextFunc) *ipifyClient {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	newGuard := func(network string) *targetguard.Guard {
		guard, err := targetguard.New(targetguard.Config{
			Policy:      targetguard.PublicOnly,
			Resolver:    familyResolver{resolver: resolver, network: network},
			DialContext: dial,
		})
		if err != nil {
			panic("construct fixed ipify target guard: " + err.Error())
		}
		return guard
	}
	return &ipifyClient{ipv4: newGuard("ip4"), ipv6: newGuard("ip6")}
}

func (client *ipifyClient) Fetch(ctx context.Context, family string) (netip.Addr, error) {
	endpoint := ipifyIPv4Endpoint
	guard := client.ipv4
	if family == "ipv6" {
		endpoint = ipifyIPv6Endpoint
		guard = client.ipv6
	} else if family != "ipv4" {
		return netip.Addr{}, ErrInvalidFamily
	}
	session, err := guard.NewSession(ctx, endpoint, targetguard.SessionConfig{
		Redirect: targetguard.RedirectPolicy{MaxRedirects: 0},
		Transport: targetguard.TransportOptions{
			TLSHandshakeTimeout:    publicLookupTimeout,
			ResponseHeaderTimeout:  publicLookupTimeout,
			MaxResponseHeaderBytes: 32 << 10,
		},
	})
	if err != nil {
		return netip.Addr{}, fmt.Errorf("resolve fixed ipify endpoint: %w", err)
	}
	defer session.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return netip.Addr{}, fmt.Errorf("create fixed ipify request: %w", err)
	}
	request.Header.Set("Accept", "text/plain")
	request.Header.Set("User-Agent", "ProtoPeek public identity observation")
	response, err := session.Client().Do(request)
	if err != nil {
		return netip.Addr{}, fmt.Errorf("request fixed ipify endpoint: %w", err)
	}
	defer response.Body.Close()
	return readIPifyResponse(response, family)
}

func readIPifyResponse(response *http.Response, family string) (netip.Addr, error) {
	if response == nil || response.Body == nil {
		return netip.Addr{}, fmt.Errorf("fixed ipify response was unavailable")
	}
	if response.StatusCode != http.StatusOK {
		return netip.Addr{}, fmt.Errorf("fixed ipify endpoint returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxIPifyBodyBytes {
		return netip.Addr{}, fmt.Errorf("fixed ipify response exceeded %d bytes", maxIPifyBodyBytes)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxIPifyBodyBytes+1))
	if err != nil {
		return netip.Addr{}, fmt.Errorf("read fixed ipify response: %w", err)
	}
	if len(body) > maxIPifyBodyBytes {
		return netip.Addr{}, fmt.Errorf("fixed ipify response exceeded %d bytes", maxIPifyBodyBytes)
	}
	address, err := parseIPifyAddress(body, family)
	if err != nil {
		return netip.Addr{}, err
	}
	return address, nil
}

func parseIPifyAddress(body []byte, family string) (netip.Addr, error) {
	value := strings.Trim(string(body), " \t\r\n")
	if value == "" || len(value) > 128 || strings.IndexFunc(value, func(character rune) bool {
		return character <= 0x20 || character >= 0x7f
	}) >= 0 {
		return netip.Addr{}, fmt.Errorf("fixed ipify response was not one plain IP address")
	}
	address, err := netip.ParseAddr(value)
	if err != nil || address.Zone() != "" {
		return netip.Addr{}, fmt.Errorf("fixed ipify response was not one plain IP address")
	}
	address = address.Unmap()
	if family == "ipv4" && !address.Is4() || family == "ipv6" && !address.Is6() {
		return netip.Addr{}, fmt.Errorf("fixed ipify response did not match requested %s family", family)
	}
	if err := targetguard.ValidateAddress(address, targetguard.PublicOnly); err != nil {
		return netip.Addr{}, fmt.Errorf("fixed ipify response was not a public address: %w", err)
	}
	return address, nil
}

type lookupTXTResolver interface {
	LookupTXT(context.Context, string) ([]string, error)
}

type cymruClient struct {
	resolver lookupTXTResolver
}

func (client *cymruClient) Lookup(ctx context.Context, address netip.Addr) (*BGPOriginNetwork, error, error) {
	query, err := cymruOriginQuery(address)
	if err != nil {
		return nil, nil, err
	}
	records, err := client.lookupBoundedTXT(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("team Cymru BGP origin lookup failed: %w", err)
	}
	if len(records) != 1 {
		return nil, nil, fmt.Errorf("%w: received %d origin records", errBGPAmbiguous, len(records))
	}
	asn, prefix, err := parseCymruOriginRecord(records[0], address)
	if err != nil {
		return nil, nil, err
	}
	result := &BGPOriginNetwork{
		Label:    "BGP origin network",
		Evidence: "provider-reported",
		Provider: cymruProvider,
		ASN:      "AS" + strconv.FormatUint(uint64(asn), 10),
		Prefix:   prefix.String(),
	}
	nameRecords, nameErr := client.lookupBoundedTXT(ctx, "AS"+strconv.FormatUint(uint64(asn), 10)+cymruASNNameSuffix)
	if nameErr != nil {
		return result, fmt.Errorf("team Cymru ASN-name lookup failed: %w", nameErr), nil
	}
	if len(nameRecords) != 1 {
		return result, fmt.Errorf("team Cymru ASN-name lookup returned %d records", len(nameRecords)), nil
	}
	name, err := parseCymruASNNameRecord(nameRecords[0], asn)
	if err != nil {
		return result, err, nil
	}
	result.Name = name
	return result, nil, nil
}

func (client *cymruClient) lookupBoundedTXT(ctx context.Context, query string) ([]string, error) {
	if client == nil || client.resolver == nil {
		return nil, fmt.Errorf("configured DNS resolver is unavailable")
	}
	if !validCymruQuery(query) {
		return nil, fmt.Errorf("refused non-Cymru DNS query")
	}
	records, err := client.resolver.LookupTXT(ctx, query)
	if err != nil {
		return nil, err
	}
	if len(records) < 1 {
		return nil, fmt.Errorf("DNS response contained no TXT records")
	}
	if len(records) > maxCymruTXTRecords {
		return nil, fmt.Errorf("DNS response exceeded %d TXT records", maxCymruTXTRecords)
	}
	total := 0
	result := make([]string, 0, len(records))
	for _, record := range records {
		total += len(record)
		if len(record) > 2048 || total > maxCymruTXTBytes {
			return nil, fmt.Errorf("DNS TXT response exceeded %d bytes", maxCymruTXTBytes)
		}
		result = append(result, strings.TrimSpace(record))
	}
	return result, nil
}

func validCymruQuery(query string) bool {
	if strings.HasSuffix(query, cymruIPv4Suffix) {
		prefix := strings.TrimSuffix(query, cymruIPv4Suffix)
		labels := strings.Split(prefix, ".")
		if len(labels) != 4 {
			return false
		}
		for _, label := range labels {
			value, err := strconv.ParseUint(label, 10, 8)
			if err != nil || strconv.FormatUint(value, 10) != label {
				return false
			}
		}
		return true
	}
	if strings.HasSuffix(query, cymruIPv6Suffix) {
		prefix := strings.TrimSuffix(query, cymruIPv6Suffix)
		labels := strings.Split(prefix, ".")
		if len(labels) != 32 {
			return false
		}
		for _, label := range labels {
			if len(label) != 1 || !strings.Contains("0123456789abcdef", label) {
				return false
			}
		}
		return true
	}
	if !strings.HasSuffix(query, cymruASNNameSuffix) || !strings.HasPrefix(query, "AS") {
		return false
	}
	prefix := strings.TrimSuffix(strings.TrimPrefix(query, "AS"), cymruASNNameSuffix)
	_, err := strconv.ParseUint(prefix, 10, 32)
	return err == nil && prefix != ""
}

func cymruOriginQuery(address netip.Addr) (string, error) {
	if !address.IsValid() || address.Zone() != "" {
		return "", fmt.Errorf("invalid public address")
	}
	address = address.Unmap()
	if address.Is4() {
		value := address.As4()
		return fmt.Sprintf("%d.%d.%d.%d%s", value[3], value[2], value[1], value[0], cymruIPv4Suffix), nil
	}
	value := address.As16()
	hexValue := hex.EncodeToString(value[:])
	labels := make([]string, 0, len(hexValue))
	for index := len(hexValue) - 1; index >= 0; index-- {
		labels = append(labels, string(hexValue[index]))
	}
	return strings.Join(labels, ".") + cymruIPv6Suffix, nil
}

func parseCymruOriginRecord(record string, address netip.Addr) (uint32, netip.Prefix, error) {
	fields := splitCymruRecord(record)
	if len(fields) != 5 {
		return 0, netip.Prefix{}, fmt.Errorf("team Cymru BGP origin response was malformed")
	}
	asnFields := strings.Fields(fields[0])
	if len(asnFields) != 1 {
		return 0, netip.Prefix{}, fmt.Errorf("%w: response listed multiple origin ASNs", errBGPAmbiguous)
	}
	asn, err := strconv.ParseUint(asnFields[0], 10, 32)
	if err != nil || asn == 0 {
		return 0, netip.Prefix{}, fmt.Errorf("team Cymru BGP origin ASN was malformed")
	}
	prefix, err := netip.ParsePrefix(fields[1])
	if err != nil {
		return 0, netip.Prefix{}, fmt.Errorf("team Cymru BGP origin prefix was malformed")
	}
	prefix = prefix.Masked()
	address = address.Unmap()
	if !prefix.Contains(address) || prefix.Addr().Is4() != address.Is4() {
		return 0, netip.Prefix{}, fmt.Errorf("team Cymru BGP origin prefix did not contain the observed address")
	}
	return uint32(asn), prefix, nil
}

func parseCymruASNNameRecord(record string, expected uint32) (string, error) {
	fields := splitCymruRecord(record)
	if len(fields) != 5 {
		return "", fmt.Errorf("team Cymru ASN-name response was malformed")
	}
	asn, err := strconv.ParseUint(fields[0], 10, 32)
	if err != nil || uint32(asn) != expected {
		return "", fmt.Errorf("team Cymru ASN-name response did not match the origin ASN")
	}
	name := boundedText(fields[4], 256)
	if name == "" {
		return "", fmt.Errorf("team Cymru ASN-name response contained no name")
	}
	return name, nil
}

func splitCymruRecord(record string) []string {
	parts := strings.Split(record, "|")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	return parts
}

func publicSafeError(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "fixed provider request timed out"
	case errors.Is(err, context.Canceled):
		return "fixed provider request was cancelled"
	case errors.Is(err, errBGPAmbiguous):
		return boundedText(err.Error(), 256)
	}
	value := boundedText(err.Error(), 256)
	if strings.Contains(value, "://") || strings.Contains(value, "@") || strings.ContainsAny(value, "\\\n\r") {
		return "fixed provider request failed"
	}
	return value
}
