package netdiag

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/net/dns/dnsmessage"
)

var recordTypes = map[string]dnsmessage.Type{"A": dnsmessage.TypeA, "AAAA": dnsmessage.TypeAAAA, "CNAME": dnsmessage.TypeCNAME, "MX": dnsmessage.TypeMX, "TXT": dnsmessage.TypeTXT, "NS": dnsmessage.TypeNS, "SOA": dnsmessage.TypeSOA, "SRV": dnsmessage.TypeSRV, "PTR": dnsmessage.TypePTR}

func (engine Engine) runDNS(ctx context.Context, input Request, result *Result) error {
	kind := strings.ToUpper(input.RecordType)
	if _, ok := recordTypes[kind]; !ok {
		return fmt.Errorf("%w: choose A, AAAA, CNAME, MX, TXT, NS, SOA, SRV or PTR", ErrInvalid)
	}
	question := strings.TrimSuffix(strings.TrimSpace(input.Target), ".")
	if kind == "PTR" {
		address, err := netip.ParseAddr(question)
		if err != nil || address.Zone() != "" {
			return fmt.Errorf("%w: PTR requires an IP address without a zone", ErrInvalid)
		}
		question = reverseName(address.Unmap())
	} else {
		if question == "" || len(question) > 253 || strings.ContainsAny(question, "/\\:@?# ") || strings.IndexFunc(question, unicode.IsControl) >= 0 {
			return fmt.Errorf("%w: enter a DNS name without a URL, port or spaces", ErrInvalid)
		}
		if _, err := dnsmessage.NewName(question + "."); err != nil {
			return fmt.Errorf("%w: invalid DNS question", ErrInvalid)
		}
	}
	result.Target = question
	// Validate the explicit raw DNS endpoint before either resolver can send traffic.
	var resolver endpoint
	var address netip.Addr
	if input.Resolver != "" {
		var err error
		resolver, err = parseEndpoint(input.Resolver, 53)
		if err != nil || strings.Contains(input.Resolver, "://") {
			return fmt.Errorf("%w: resolver must be an explicit IP with an optional port, without a URL", ErrInvalid)
		}
		address, err = netip.ParseAddr(resolver.host)
		if err != nil || !usableAddress(address, localBroadcasts()) {
			return fmt.Errorf("%w: resolver must be a usable unicast IP", ErrInvalid)
		}
	} else if input.Mode == "dns-compare" {
		return fmt.Errorf("%w: enter the explicit resolver to compare with the system resolver", ErrInvalid)
	}
	if input.Mode == "dns-compare" || input.Resolver == "" {
		result.DNS = append(result.DNS, engine.systemDNS(ctx, input, question, kind))
	}
	if input.Resolver != "" {
		result.DNS = append(result.DNS, engine.wireDNS(ctx, input, question, kind, resolver, address))
	}
	result.Summary = "DNS evidence at the displayed time. System lookups do not expose TTLs, response codes or the selected OS resolver."
	for _, observation := range result.DNS {
		if observation.Outcome != "answered" {
			result.Outcome = "partial"
		}
	}
	if len(result.DNS) == 2 {
		left, right := result.DNS[0], result.DNS[1]
		if kind == "CNAME" || left.Outcome != "answered" || right.Outcome != "answered" || left.Limited || right.Limited {
			result.Comparison = "inconclusive"
		} else {
			values := func(records []DNSRecord) []string {
				out := []string{}
				for _, record := range records {
					if record.Type == kind {
						out = append(out, comparisonDNSValue(record))
					}
				}
				slices.Sort(out)
				return slices.Compact(out)
			}
			if slices.Equal(values(left.Records), values(right.Records)) {
				result.Comparison = "same observed answer set"
			} else {
				result.Comparison = "different observed answer sets"
			}
		}
	}
	return nil
}

func (engine Engine) systemDNS(parent context.Context, input Request, question, kind string) DNSObservation {
	started := time.Now()
	observation := DNSObservation{Resolver: "system", Transport: "OS/Go resolver path", Question: question, RecordType: kind, Records: []DNSRecord{}, Outcome: "answered"}
	ctx, cancel := context.WithTimeout(parent, time.Duration(input.TimeoutMS)*time.Millisecond)
	defer cancel()
	resolver := engine.Records
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	add := func(value string) {
		if len(observation.Records) >= MaxRecords {
			observation.Limited = true
			return
		}
		observation.Records = append(observation.Records, DNSRecord{Name: question, Type: kind, Value: value})
	}
	var err error
	switch kind {
	case "A", "AAAA":
		network := "ip4"
		if kind == "AAAA" {
			network = "ip6"
		}
		var values []netip.Addr
		values, err = resolver.LookupNetIP(ctx, network, question)
		for _, value := range values {
			add(value.String())
		}
	case "CNAME":
		var value string
		value, err = resolver.LookupCNAME(ctx, question)
		if err == nil {
			observation.Detail = "The system API returns a canonical name, not the wire CNAME record set; alias comparison is inconclusive."
			if strings.EqualFold(strings.TrimSuffix(value, "."), strings.TrimSuffix(question, ".")) {
				observation.Detail = "The system API returned the queried name; it cannot establish a CNAME record. Alias comparison is inconclusive."
			} else if value != "" {
				observation.Records = append(observation.Records, DNSRecord{Name: question, Type: "OS canonical name", Value: value})
			}
		}
	case "MX":
		var values []*net.MX
		values, err = resolver.LookupMX(ctx, question)
		for _, value := range values {
			add(fmt.Sprintf("%d %s", value.Pref, value.Host))
		}
	case "TXT":
		var values []string
		values, err = resolver.LookupTXT(ctx, question)
		for _, value := range values {
			add(value)
		}
	case "NS":
		var values []*net.NS
		values, err = resolver.LookupNS(ctx, question)
		for _, value := range values {
			add(value.Host)
		}
	case "SRV":
		var values []*net.SRV
		_, values, err = resolver.LookupSRV(ctx, "", "", question)
		for _, value := range values {
			add(fmt.Sprintf("%d %d %d %s", value.Priority, value.Weight, value.Port, value.Target))
		}
	case "PTR":
		var values []string
		values, err = resolver.LookupAddr(ctx, strings.TrimSpace(input.Target))
		for _, value := range values {
			add(value)
		}
	case "SOA":
		observation.Outcome, observation.Detail = "unavailable", "The system resolver API does not expose SOA. Enter an explicit resolver."
	}
	if err != nil {
		observation.Outcome = "failed"
		observation.Detail = "The system resolver could not answer this question."
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			if dnsErr.IsNotFound {
				observation.Outcome, observation.Detail = "not-found", "The system resolver reported no matching name or record; the raw response code is unavailable."
			} else if dnsErr.IsTimeout {
				observation.Outcome = "timeout"
			}
		}
	}
	observation.DurationMS = elapsed(started)
	return observation
}

func reverseName(address netip.Addr) string {
	if address.Is4() {
		bytes := address.As4()
		return fmt.Sprintf("%d.%d.%d.%d.in-addr.arpa", bytes[3], bytes[2], bytes[1], bytes[0])
	}
	bytes := address.As16()
	var builder strings.Builder
	for index := len(bytes) - 1; index >= 0; index-- {
		fmt.Fprintf(&builder, "%x.%x.", bytes[index]&15, bytes[index]>>4)
	}
	return builder.String() + "ip6.arpa"
}

func (engine Engine) wireDNS(ctx context.Context, input Request, question, kind string, target endpoint, address netip.Addr) DNSObservation {
	started := time.Now()
	observation := DNSObservation{Resolver: target.authority(), Transport: "UDP", Question: question, RecordType: kind, Outcome: "failed", Records: []DNSRecord{}}
	name, _ := dnsmessage.NewName(question + ".")
	var randomID [2]byte
	_, _ = rand.Read(randomID[:])
	query := dnsmessage.Message{Header: dnsmessage.Header{ID: binary.BigEndian.Uint16(randomID[:]), RecursionDesired: true}, Questions: []dnsmessage.Question{{Name: name, Type: recordTypes[kind], Class: dnsmessage.ClassINET}}}
	wire, err := query.Pack()
	if err != nil {
		observation.Detail = "Could not encode this DNS question."
		return observation
	}
	response := func(network string) (*dnsmessage.Message, error) {
		conn, _, closeConn := engine.connect(ctx, input.TimeoutMS, network, target, address)
		defer closeConn()
		if conn == nil {
			return nil, fmt.Errorf("DNS transport unavailable")
		}
		var data []byte
		if network == "tcp" {
			packet := make([]byte, 2+len(wire))
			binary.BigEndian.PutUint16(packet, uint16(len(wire)))
			copy(packet[2:], wire)
			if _, err := conn.Write(packet); err != nil {
				return nil, err
			}
			var length [2]byte
			if _, err := io.ReadFull(conn, length[:]); err != nil {
				return nil, err
			}
			data = make([]byte, int(binary.BigEndian.Uint16(length[:])))
			if _, err := io.ReadFull(conn, data); err != nil {
				return nil, err
			}
		} else {
			if _, err := conn.Write(wire); err != nil {
				return nil, err
			}
			data = make([]byte, 65535)
			n, err := conn.Read(data)
			if err != nil {
				return nil, err
			}
			data = data[:n]
		}
		var message dnsmessage.Message
		if err := message.Unpack(data); err != nil {
			return nil, err
		}
		if !message.Response || message.ID != query.ID || message.OpCode != 0 || len(message.Questions) != 1 || message.Questions[0] != query.Questions[0] {
			return nil, fmt.Errorf("unmatched DNS response")
		}
		return &message, nil
	}
	message, err := response("udp")
	if err == nil && message.Truncated {
		observation.Transport = "UDP → TCP"
		message, err = response("tcp")
	}
	observation.DurationMS = elapsed(started)
	if err != nil {
		observation.Outcome, _ = networkError(err)
		observation.Detail = "Resolver did not return a complete, matching DNS response."
		return observation
	}
	observation.ResponseCode, observation.Authoritative = message.RCode.String(), message.Authoritative
	observation.Outcome = "answered"
	if message.RCode != dnsmessage.RCodeSuccess {
		observation.Outcome = "dns-error"
	}
	observation.Limited = message.Truncated
	// Include authority SOA (including negative-answer TTL evidence), never unrelated additionals.
	for _, record := range append(message.Answers, message.Authorities...) {
		if len(observation.Records) >= MaxRecords {
			observation.Limited = true
			break
		}
		value := dnsValue(record.Body)
		if value == "" {
			continue
		}
		ttl := record.Header.TTL
		observation.Records = append(observation.Records, DNSRecord{Name: record.Header.Name.String(), Type: strings.TrimPrefix(record.Header.Type.String(), "Type"), Value: value, TTLSeconds: &ttl})
	}
	return observation
}

func dnsValue(body dnsmessage.ResourceBody) string {
	switch value := body.(type) {
	case *dnsmessage.AResource:
		return netip.AddrFrom4(value.A).String()
	case *dnsmessage.AAAAResource:
		return netip.AddrFrom16(value.AAAA).String()
	case *dnsmessage.CNAMEResource:
		return value.CNAME.String()
	case *dnsmessage.NSResource:
		return value.NS.String()
	case *dnsmessage.PTRResource:
		return value.PTR.String()
	case *dnsmessage.TXTResource:
		return strings.Join(value.TXT, "")
	case *dnsmessage.MXResource:
		return strconv.Itoa(int(value.Pref)) + " " + value.MX.String()
	case *dnsmessage.SRVResource:
		return fmt.Sprintf("%d %d %d %s", value.Priority, value.Weight, value.Port, value.Target)
	case *dnsmessage.SOAResource:
		return fmt.Sprintf("%s %s %d %d %d %d %d", value.NS, value.MBox, value.Serial, value.Refresh, value.Retry, value.Expire, value.MinTTL)
	default:
		return ""
	}
}

// Only DNS names are case-insensitive. TXT payloads retain every byte, including
// case, whitespace and a trailing dot; numeric address values are already canonical.
func comparisonDNSValue(record DNSRecord) string {
	normalizeName := func(value string) string { return strings.TrimSuffix(strings.ToLower(value), ".") }
	switch record.Type {
	case "CNAME", "NS", "PTR":
		return normalizeName(record.Value)
	case "MX", "SRV", "SOA":
		fields := strings.Fields(record.Value)
		if len(fields) == 0 {
			return record.Value
		}
		if record.Type == "SOA" {
			if len(fields) < 2 {
				return record.Value
			}
			fields[0], fields[1] = normalizeName(fields[0]), normalizeName(fields[1])
		} else {
			fields[len(fields)-1] = normalizeName(fields[len(fields)-1])
		}
		return strings.Join(fields, " ")
	default:
		return record.Value
	}
}
