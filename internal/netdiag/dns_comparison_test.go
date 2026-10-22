package netdiag

import (
	"context"
	"golang.org/x/net/dns/dnsmessage"
	"net"
	"testing"
)

func txtResolverFixture(t *testing.T, value string) string {
	t.Helper()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		for {
			data := make([]byte, 4096)
			n, peer, err := conn.ReadFrom(data)
			if err != nil {
				return
			}
			var message dnsmessage.Message
			if message.Unpack(data[:n]) != nil || len(message.Questions) != 1 {
				continue
			}
			message.Response = true
			message.RecursionAvailable = true
			message.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: message.Questions[0].Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeTXT, TTL: 123}, Body: &dnsmessage.TXTResource{TXT: []string{value}}}}
			wire, err := message.Pack()
			if err == nil {
				_, _ = conn.WriteTo(wire, peer)
			}
		}
	}()
	return conn.LocalAddr().String()
}

func TestDNSComparePreservesTXTCaseAndTrailingDot(t *testing.T) {
	for _, test := range []struct{ name, system, explicit, want string }{
		{"case", "Token=A", "token=a", "different observed answer sets"},
		{"dot", "Token=A.", "Token=A", "different observed answer sets"},
		{"equal", " Token=A. ", " Token=A. ", "same observed answer set"},
	} {
		t.Run(test.name, func(t *testing.T) {
			system := txtResolverFixture(t, test.system)
			explicit := txtResolverFixture(t, test.explicit)
			resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "udp", system)
			}}
			input := request("dns-compare", "txt.example.test")
			input.RecordType, input.Resolver = "TXT", explicit
			result, err := (Engine{Records: resolver}).Run(context.Background(), input)
			if err != nil || result.Comparison != test.want || len(result.DNS) != 2 {
				t.Fatalf("%+v err=%v", result, err)
			}
			if result.DNS[0].Records[0].Value != test.system || result.DNS[1].Records[0].Value != test.explicit {
				t.Fatalf("TXT bytes changed %+v", result.DNS)
			}
		})
	}
}

func TestDNSComparisonOnlyNormalizesNameFields(t *testing.T) {
	for _, test := range []struct{ kind, value, want string }{
		{"TXT", " Example.COM. ", " Example.COM. "},
		{"CNAME", "Example.COM.", "example.com"},
		{"MX", "10 Mail.Example.COM.", "10 mail.example.com"},
		{"SRV", "1 2 443 Service.Example.COM.", "1 2 443 service.example.com"},
		{"SOA", "NS.Example.COM. Hostmaster.Example.COM. 1 2 3 4 5", "ns.example.com hostmaster.example.com 1 2 3 4 5"},
		{"AAAA", "2001:db8::a", "2001:db8::a"},
	} {
		if got := comparisonDNSValue(DNSRecord{Type: test.kind, Value: test.value}); got != test.want {
			t.Fatalf("%s comparison %q want %q", test.kind, got, test.want)
		}
	}
}
