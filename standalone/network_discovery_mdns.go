package standalone

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"net"
	"net/netip"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/dns/dnsmessage"
	"golang.org/x/net/ipv4"
)

// An advertisement is a device's claim in a DNS-SD response. It does not prove
// that the advertised port is open or identify the device's hardware or OS.
type NetworkAdvertisement struct {
	Address     string   `json:"address"`
	Instance    string   `json:"instance"`
	ServiceType string   `json:"serviceType"`
	Hostname    string   `json:"hostname"`
	Port        uint16   `json:"port"`
	TXT         []string `json:"txt"`
	Source      string   `json:"source"`
}

type NetworkAdvertisements struct {
	Status   string                 `json:"status"`
	Records  []NetworkAdvertisement `json:"records"`
	Warnings []string               `json:"warnings"`
}

type networkMDNSRecords struct {
	ptr       map[string]string
	srv       map[string]dnsmessage.SRVResource
	addresses map[string][]netip.Addr
	txt       map[string][]string
	count     int
}

func newNetworkMDNSRecords() *networkMDNSRecords {
	return &networkMDNSRecords{ptr: map[string]string{}, srv: map[string]dnsmessage.SRVResource{}, addresses: map[string][]netip.Addr{}, txt: map[string][]string{}}
}

func discoverNetworkAdvertisements(ctx context.Context, plan networkDiscoveryPlan) NetworkAdvertisements {
	result := NetworkAdvertisements{Status: "unavailable", Records: []NetworkAdvertisement{}, Warnings: []string{
		"mDNS/DNS-SD advertisements are device-provided claims, collected for up to two seconds on the selected local interface. Silent devices and unicast-only discovery are not included.",
		"An advertised port is not proof that it accepts connections. Only in-scope advertised IPv4 addresses are retained; TXT data may contain device-supplied identifiers.",
	}}
	interfaces, err := listNetworkInterfaceSuggestions()
	if err != nil {
		result.Warnings = append(result.Warnings, "Local interfaces could not be read for mDNS.")
		return result
	}
	var selected *NetworkInterfaceSuggestion
	for _, iface := range interfaces {
		prefix, err := netip.ParsePrefix(iface.InterfaceCIDR)
		if err != nil || plan.InterfaceIndex != 0 && iface.Index != plan.InterfaceIndex || !prefix.Contains(plan.CIDR.Addr()) || plan.CIDR.Bits() < prefix.Bits() {
			continue
		}
		candidate := iface
		selected = &candidate
		break
	}
	if selected == nil {
		result.Warnings = append(result.Warnings, "This range is not attached to an available local interface, so mDNS was not queried.")
		return result
	}
	iface, err := net.InterfaceByIndex(selected.Index)
	if err != nil {
		result.Warnings = append(result.Warnings, "The selected interface is no longer available for mDNS.")
		return result
	}
	connection, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(selected.Address)})
	if err != nil {
		result.Warnings = append(result.Warnings, "mDNS could not open a local UDP socket. Check local network permissions.")
		return result
	}
	defer connection.Close()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	_ = connection.SetDeadline(deadline)
	packetConnection := ipv4.NewPacketConn(connection)
	if packetConnection.SetMulticastInterface(iface) != nil || packetConnection.SetMulticastTTL(255) != nil {
		result.Warnings = append(result.Warnings, "The selected interface does not support the bounded mDNS query.")
		return result
	}
	queried := map[string]bool{}
	var queryBytes [2]byte
	if _, err := rand.Read(queryBytes[:]); err != nil {
		result.Warnings = append(result.Warnings, "mDNS query identifiers could not be generated.")
		return result
	}
	queryID := binary.BigEndian.Uint16(queryBytes[:])
	query := func(name string, kind dnsmessage.Type) bool {
		key := name + ":" + kind.String()
		if queried[key] || len(queried) >= 32 || ctx.Err() != nil {
			return false
		}
		dnsName, err := dnsmessage.NewName(name)
		if err != nil {
			return false
		}
		// The ephemeral source port requests a legacy unicast response, which
		// must echo this ID and question (RFC 6762 section 6.7).
		message := dnsmessage.Message{Header: dnsmessage.Header{ID: queryID}, Questions: []dnsmessage.Question{{Name: dnsName, Type: kind, Class: dnsmessage.ClassINET}}}
		wire, err := message.Pack()
		if err != nil {
			return false
		}
		queried[key] = true
		_, err = connection.WriteToUDP(wire, &net.UDPAddr{IP: net.IPv4(224, 0, 0, 251), Port: 5353})
		return err == nil
	}
	if !query("_services._dns-sd._udp.local.", dnsmessage.TypePTR) {
		result.Warnings = append(result.Warnings, "The local mDNS query could not be sent.")
		return result
	}
	for _, service := range []string{"_http._tcp.local.", "_https._tcp.local.", "_ipp._tcp.local.", "_ipps._tcp.local.", "_airplay._tcp.local.", "_googlecast._tcp.local.", "_workstation._tcp.local.", "_ssh._tcp.local."} {
		query(service, dnsmessage.TypePTR)
	}
	result.Status = "available"
	records := newNetworkMDNSRecords()
	attachedPrefix := netip.MustParsePrefix(selected.InterfaceCIDR)
	buffer := make([]byte, 9000)
	for packets := 0; packets < 128; packets++ {
		n, sender, err := connection.ReadFromUDP(buffer)
		if err != nil {
			break
		}
		senderAddress, ok := netip.AddrFromSlice(sender.IP)
		if sender.Port != 5353 || n == len(buffer) || !ok || !attachedPrefix.Contains(senderAddress.Unmap()) {
			continue
		}
		var message dnsmessage.Message
		if message.Unpack(buffer[:n]) != nil || !networkMDNSResponseMatches(message, queryID, queried) {
			continue
		}
		records.add(message)
		instances := make([]string, 0, len(records.ptr))
		for instance := range records.ptr {
			instances = append(instances, instance)
		}
		sort.Strings(instances)
		for _, instance := range instances {
			service := records.ptr[instance]
			if service == "_services._dns-sd._udp.local." {
				query(instance, dnsmessage.TypePTR)
				continue
			}
			if _, ok := records.srv[instance]; !ok {
				query(instance, dnsmessage.TypeSRV)
			}
			if _, ok := records.txt[instance]; !ok {
				query(instance, dnsmessage.TypeTXT)
			}
		}
		hosts := make([]string, 0, len(records.srv))
		for instance := range records.srv {
			hosts = append(hosts, instance)
		}
		sort.Strings(hosts)
		for _, instance := range hosts {
			srv := records.srv[instance]
			name := strings.ToLower(srv.Target.String())
			if len(records.addresses[name]) == 0 {
				query(name, dnsmessage.TypeA)
			}
		}
		if records.count >= 256 || packets == 127 {
			result.Status = "partial"
			break
		}
	}
	result.Records = records.advertisements(plan.CIDR)
	if len(result.Records) > 64 {
		result.Records = result.Records[:64]
		result.Status = "partial"
	}
	if result.Status == "partial" {
		result.Warnings = append(result.Warnings, "Advertisement collection reached its bounded record or packet limit; additional responses were omitted.")
	}
	if len(result.Records) == 0 {
		result.Warnings = append(result.Warnings, "No complete in-scope IPv4 service advertisements were received during the bounded query. Devices may not advertise or multicast may be blocked.")
	}
	return result
}

func networkMDNSResponseMatches(message dnsmessage.Message, queryID uint16, queried map[string]bool) bool {
	if !message.Header.Response || message.Header.ID != queryID {
		return false
	}
	for _, question := range message.Questions {
		if question.Class&0x7fff == dnsmessage.ClassINET && queried[strings.ToLower(question.Name.String())+":"+question.Type.String()] {
			return true
		}
	}
	return false
}

func (records *networkMDNSRecords) add(message dnsmessage.Message) {
	resources := append(append(message.Answers, message.Authorities...), message.Additionals...)
	for _, resource := range resources {
		if records.count >= 256 {
			return
		}
		if resource.Header.TTL == 0 || resource.Header.Class&0x7fff != dnsmessage.ClassINET {
			continue
		}
		name := strings.ToLower(resource.Header.Name.String())
		if !validNetworkMDNSName(name) {
			continue
		}
		records.count++
		switch value := resource.Body.(type) {
		case *dnsmessage.PTRResource:
			target := strings.ToLower(value.PTR.String())
			if validNetworkMDNSName(target) {
				records.ptr[target] = name
			}
		case *dnsmessage.SRVResource:
			if value.Port > 0 && validNetworkMDNSName(value.Target.String()) {
				records.srv[name] = *value
			}
		case *dnsmessage.AResource:
			address := netip.AddrFrom4(value.A)
			if address.IsPrivate() && len(records.addresses[name]) < 8 {
				records.addresses[name] = append(records.addresses[name], address)
			}
		case *dnsmessage.TXTResource:
			text := []string{}
			for _, item := range value.TXT {
				if len(text) == 8 {
					break
				}
				if len(item) <= 256 && safeNetworkMDNSText(item) {
					text = append(text, item)
				}
			}
			records.txt[name] = text
		}
	}
}

func validNetworkMDNSName(name string) bool {
	return len(name) <= 253 && safeNetworkMDNSText(name) && strings.HasSuffix(strings.ToLower(name), ".local.")
}

func safeNetworkMDNSText(value string) bool {
	return utf8.ValidString(value) && strings.IndexFunc(value, func(r rune) bool { return unicode.IsControl(r) || r == '\ufffe' || r == '\uffff' }) < 0
}

func (records *networkMDNSRecords) advertisements(prefix netip.Prefix) []NetworkAdvertisement {
	result := []NetworkAdvertisement{}
	seen := map[string]bool{}
	for instance, service := range records.ptr {
		if !strings.Contains(service, "._tcp.local.") && !strings.Contains(service, "._udp.local.") || service == "_services._dns-sd._udp.local." {
			continue
		}
		srv, ok := records.srv[instance]
		if !ok {
			continue
		}
		hostname := strings.ToLower(srv.Target.String())
		for _, address := range records.addresses[hostname] {
			if !networkDiscoveryHostAddress(prefix, address) {
				continue
			}
			key := address.String() + ":" + instance
			if seen[key] {
				continue
			}
			seen[key] = true
			txt := append([]string{}, records.txt[instance]...)
			result = append(result, NetworkAdvertisement{Address: address.String(), Instance: strings.TrimSuffix(instance, "."), ServiceType: strings.TrimSuffix(service, "."), Hostname: strings.TrimSuffix(hostname, "."), Port: srv.Port, TXT: txt, Source: "mdns"})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Address != result[j].Address {
			return result[i].Address < result[j].Address
		}
		return result[i].Instance < result[j].Instance
	})
	return result
}

func networkDiscoveryHostAddress(prefix netip.Prefix, address netip.Addr) bool {
	if !address.Is4() || !prefix.Contains(address) {
		return false
	}
	if prefix.Bits() >= 31 {
		return true
	}
	bytes := address.As4()
	value := uint32(bytes[0])<<24 | uint32(bytes[1])<<16 | uint32(bytes[2])<<8 | uint32(bytes[3])
	hostMask := uint32(1)<<(32-prefix.Bits()) - 1
	return value&hostMask != 0 && value&hostMask != hostMask
}
