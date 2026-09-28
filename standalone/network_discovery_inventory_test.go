package standalone

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/netroute"
	"golang.org/x/net/dns/dnsmessage"
)

func TestNetworkNeighborParsersPreserveInterfaceEvidence(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		records []networkNeighborRecord
		index   int
		iface   string
	}{
		{"windows", parseWindowsNetworkNeighbors("Interface: 192.168.44.19 --- 0x4\n  Internet Address Physical Address Type\n  192.168.44.1 52-54-00-12-34-56 dynamic\n"), 4, ""},
		{"localized windows", parseWindowsNetworkNeighbors("Interfaz: 192.168.44.19 --- 0x4\n  192.168.44.1 52-54-00-12-34-56 dinamico\n"), 4, ""},
		{"linux", parseLinuxNetworkNeighbors("IP address HW type Flags HW address Mask Device\n192.168.44.1 0x1 0x2 52:54:00:12:34:56 * en0\n192.168.44.2 0x1 0x0 00:00:00:00:00:00 * en0\n"), 0, "en0"},
		{"darwin", parseDarwinNetworkNeighbors("? (192.168.44.1) at 52:54:0:12:34:56 on en0 ifscope [ethernet]\n"), 0, "en0"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if len(test.records) != 1 || test.records[0].address != "192.168.44.1" || test.records[0].interfaceIndex != test.index || test.records[0].interfaceName != test.iface {
				t.Fatalf("unexpected parsed records: %#v", test.records)
			}
		})
	}
}

func TestNetworkInventoryFiltersStalePseudoNeighborsAndKeepsUnknownIdentity(t *testing.T) {
	t.Parallel()
	interfaces := []NetworkInterfaceSuggestion{{Index: 4, Name: "en0", Address: "192.168.44.19", InterfaceCIDR: "192.168.44.0/24", SuggestedCIDR: "192.168.44.0/24"}}
	neighbors := []networkNeighborRecord{
		{address: "192.168.44.1", mac: "52:54:00:12:34:56", interfaceIndex: 4},
		{address: "192.168.44.1", mac: "52:54:00:12:34:56", interfaceIndex: 4},
		{address: "192.168.44.2", mac: "00:00:00:00:00:00", interfaceIndex: 4},
		{address: "192.168.44.3", mac: "ff:ff:ff:ff:ff:ff", interfaceIndex: 4},
		{address: "192.168.44.255", mac: "52:54:00:12:34:56", interfaceIndex: 4},
		{address: "192.168.44.0", mac: "52:54:00:12:34:56", interfaceIndex: 4},
		{address: "192.168.44.5", mac: "52:54:00:12:34:56", interfaceIndex: 5},
		{address: "192.168.45.5", mac: "52:54:00:12:34:56", interfaceIndex: 4},
	}
	inventory := buildNetworkNeighborInventory(interfaces, "my-computer", netroute.Result{Status: "ok", InterfaceIndex: 4, SourceIP: "192.168.44.19", NextHop: "192.168.44.1"}, neighbors, nil)
	if inventory.Status != "available" || len(inventory.Devices) != 2 || inventory.DefaultInterfaceIndex != 4 || inventory.DefaultGateway != "192.168.44.1" {
		t.Fatalf("inventory = %#v", inventory)
	}
	if inventory.Devices[0].Kind != "self" || inventory.Devices[0].Hostname != "my-computer" {
		t.Fatalf("self = %#v", inventory.Devices[0])
	}
	neighbor := inventory.Devices[1]
	if neighbor.Hostname != "" || neighbor.State != "cached" || neighbor.Source != "os-neighbor-cache" {
		t.Fatalf("neighbor identity was invented: %#v", neighbor)
	}
	partial := buildNetworkNeighborInventory(interfaces, "my-computer", netroute.Result{Status: "ok", InterfaceIndex: 99}, nil, errors.New("cache unavailable"))
	if partial.Status != "partial" || len(partial.Devices) != 1 || partial.DefaultInterfaceIndex != 0 || partial.DefaultGateway != "" {
		t.Fatalf("partial = %#v", partial)
	}
}

func TestNetworkMDNSJoinsOnlyCompleteInScopeAdvertisements(t *testing.T) {
	t.Parallel()
	name := func(value string) dnsmessage.Name { return dnsmessage.MustNewName(value) }
	header := func(value string, kind dnsmessage.Type) dnsmessage.ResourceHeader {
		return dnsmessage.ResourceHeader{Name: name(value), Type: kind, Class: dnsmessage.ClassINET, TTL: 120}
	}
	records := newNetworkMDNSRecords()
	records.add(dnsmessage.Message{Answers: []dnsmessage.Resource{
		{Header: header("_ipp._tcp.local.", dnsmessage.TypePTR), Body: &dnsmessage.PTRResource{PTR: name("office._ipp._tcp.local.")}},
		{Header: header("office._ipp._tcp.local.", dnsmessage.TypeSRV), Body: &dnsmessage.SRVResource{Target: name("printer.local."), Port: 631}},
		{Header: header("office._ipp._tcp.local.", dnsmessage.TypeTXT), Body: &dnsmessage.TXTResource{TXT: []string{"ty=Office printer", "bad\x00data", "bad\x01data", "bad\uffffdata"}}},
		{Header: header("printer.local.", dnsmessage.TypeA), Body: &dnsmessage.AResource{A: [4]byte{192, 168, 44, 20}}},
		{Header: header("printer.local.", dnsmessage.TypeA), Body: &dnsmessage.AResource{A: [4]byte{192, 168, 45, 20}}},
		{Header: header("printer.local.", dnsmessage.TypeA), Body: &dnsmessage.AResource{A: [4]byte{8, 8, 8, 8}}},
		{Header: header("_http._tcp.local.", dnsmessage.TypePTR), Body: &dnsmessage.PTRResource{PTR: name("missing._http._tcp.local.")}},
	}})
	result := records.advertisements(netip.MustParsePrefix("192.168.44.0/24"))
	if len(result) != 1 || result[0].Address != "192.168.44.20" || result[0].Port != 631 || result[0].Source != "mdns" || result[0].Hostname != "printer.local" || len(result[0].TXT) != 1 {
		t.Fatalf("advertisements = %#v", result)
	}
	if len(records.advertisements(netip.MustParsePrefix("10.0.0.0/24"))) != 0 {
		t.Fatal("out-of-scope advertisements retained")
	}
	for _, invalid := range []string{"192.168.44.0", "192.168.44.255", "10.1.1.1"} {
		if networkDiscoveryHostAddress(netip.MustParsePrefix("192.168.44.0/24"), netip.MustParseAddr(invalid)) {
			t.Errorf("accepted non-host address %s", invalid)
		}
	}
	if validNetworkMDNSName("unsafe\x01name.local.") || validNetworkMDNSName("unsafe\uffffname.local.") {
		t.Fatal("unsafe DNS text accepted")
	}
}

func TestNetworkMDNSRequiresResponseToSentLegacyQuery(t *testing.T) {
	t.Parallel()
	question := dnsmessage.Question{Name: dnsmessage.MustNewName("_http._tcp.local."), Type: dnsmessage.TypePTR, Class: dnsmessage.ClassINET}
	message := dnsmessage.Message{Header: dnsmessage.Header{ID: 42, Response: true}, Questions: []dnsmessage.Question{question}}
	queried := map[string]bool{"_http._tcp.local.:TypePTR": true}
	if !networkMDNSResponseMatches(message, 42, queried) {
		t.Fatal("matching response rejected")
	}
	if networkMDNSResponseMatches(message, 43, queried) {
		t.Fatal("wrong query ID accepted")
	}
	if networkMDNSResponseMatches(message, 42, map[string]bool{}) {
		t.Fatal("unrequested question accepted")
	}
	message.Questions = nil
	if networkMDNSResponseMatches(message, 42, queried) {
		t.Fatal("unsolicited response accepted")
	}
}

func TestNetworkMDNSRunsOnlyAfterExplicitScanAuthorization(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	handler := networkDiscoveryHandlerWithAdvertisements(func(context.Context, netip.Addr, uint16) ScanResult { return ScanResult{} }, func(_ context.Context, plan networkDiscoveryPlan) NetworkAdvertisements {
		calls.Add(1)
		if plan.InterfaceIndex != 4 {
			t.Errorf("selected interface = %d", plan.InterfaceIndex)
		}
		return NetworkAdvertisements{Status: "available", Records: []NetworkAdvertisement{}, Warnings: []string{}}
	})
	denied := performNetworkDiscovery(t, handler, `{"cidr":"192.168.44.1/32","profile":"quick","consent":false,"interfaceIndex":4}`)
	if denied.Code != http.StatusBadRequest || calls.Load() != 0 {
		t.Fatalf("unapproved mDNS: status=%d calls=%d", denied.Code, calls.Load())
	}
	approved := performNetworkDiscovery(t, handler, `{"cidr":"192.168.44.1/32","profile":"quick","consent":true,"interfaceIndex":4}`)
	if approved.Code != http.StatusOK || calls.Load() != 1 || !strings.Contains(approved.Body.String(), `"advertisements":{"status":"available"`) {
		t.Fatalf("approved response: %s", approved.Body.String())
	}
}
