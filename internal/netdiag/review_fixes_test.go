package netdiag

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

func cnameResolverFixture(t *testing.T, chain bool) string {
	t.Helper()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		data := make([]byte, 4096)
		for {
			n, peer, err := conn.ReadFrom(data)
			if err != nil {
				return
			}
			var message dnsmessage.Message
			if message.Unpack(data[:n]) != nil || len(message.Questions) != 1 {
				continue
			}
			question := message.Questions[0]
			message.Response, message.RecursionAvailable = true, true
			canonical := dnsmessage.MustNewName(strings.ToLower(question.Name.String()))
			if chain {
				middle := dnsmessage.MustNewName("middle.netdiag.test.")
				canonical = dnsmessage.MustNewName("terminal.netdiag.test.")
				message.Answers = []dnsmessage.Resource{
					{Header: dnsmessage.ResourceHeader{Name: question.Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeCNAME, TTL: 30}, Body: &dnsmessage.CNAMEResource{CNAME: middle}},
					{Header: dnsmessage.ResourceHeader{Name: middle, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeCNAME, TTL: 20}, Body: &dnsmessage.CNAMEResource{CNAME: canonical}},
				}
			}
			if question.Type == dnsmessage.TypeA {
				message.Answers = append(message.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: canonical, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeA, TTL: 10}, Body: &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}}})
			}
			wire, err := message.Pack()
			if err == nil {
				_, _ = conn.WriteTo(wire, peer)
			}
		}
	}()
	return conn.LocalAddr().String()
}

func TestSystemCanonicalNameIsNotACNAMERecordSet(t *testing.T) {
	for _, chain := range []bool{false, true} {
		t.Run(map[bool]string{false: "A-only", true: "alias-chain"}[chain], func(t *testing.T) {
			endpoint := cnameResolverFixture(t, chain)
			resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "udp", endpoint)
			}}
			input := request("dns-compare", "MiXeD.netdiag.test.")
			input.TimeoutMS, input.RecordType, input.Resolver = 1000, "CNAME", endpoint
			result, err := (Engine{Records: resolver}).Run(context.Background(), input)
			if err != nil || len(result.DNS) != 2 || result.Comparison != "inconclusive" {
				t.Fatalf("%+v err=%v", result, err)
			}
			system, wire := result.DNS[0], result.DNS[1]
			if system.Outcome != "answered" || wire.Outcome != "answered" || !strings.Contains(system.Detail, "inconclusive") {
				t.Fatalf("missing canonical API boundary: %+v", result.DNS)
			}
			if !chain {
				if len(system.Records) != 0 || len(wire.Records) != 0 {
					t.Fatalf("invented CNAME from an A-only name: %+v", result.DNS)
				}
			} else {
				if len(system.Records) != 1 || system.Records[0].Type != "OS canonical name" || system.Records[0].Value == "" || system.Records[0].TTLSeconds != nil || len(wire.Records) != 2 {
					t.Fatalf("canonical result confused with wire chain: %+v", result.DNS)
				}
				for _, record := range wire.Records {
					if record.Type != "CNAME" || record.TTLSeconds == nil {
						t.Fatalf("wire chain lost: %+v", wire)
					}
				}
			}
		})
	}
}

type countedDiagnosticResolver struct{ calls *atomic.Int32 }

func (r countedDiagnosticResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	r.calls.Add(1)
	return nil, errors.New("unexpected resolver traffic")
}

func TestRawEndpointURLRejectionPrecedesAllNetworkWork(t *testing.T) {
	for _, mode := range []string{"dns", "dns-compare", "tcp-exchange", "udp-exchange"} {
		for _, raw := range []string{"https://127.0.0.1:443/dns-query", "http://example.test:80/", "udp://127.0.0.1:53", "//127.0.0.1:53/path"} {
			t.Run(mode+"/"+raw, func(t *testing.T) {
				var calls atomic.Int32
				dial := func(context.Context, string, string) (net.Conn, error) {
					calls.Add(1)
					return nil, errors.New("unexpected network work")
				}
				engine := Engine{Resolver: countedDiagnosticResolver{&calls}, Records: &net.Resolver{PreferGo: true, Dial: dial}, Dial: dial}
				input := request(mode, raw)
				if mode == "dns" || mode == "dns-compare" {
					input.Target, input.Resolver, input.RecordType = "example.netdiag.test", raw, "A"
				}
				if _, err := engine.Run(context.Background(), input); !errors.Is(err, ErrInvalid) || calls.Load() != 0 {
					t.Fatalf("URL reached traffic: err=%v calls=%d", err, calls.Load())
				}
			})
		}
	}
}

func TestTCPReplyWithoutPeerCompletionStaysPartial(t *testing.T) {
	closed := make(chan struct{}, 1)
	address := tcpFixture(t, func(conn net.Conn) {
		command := make([]byte, 4)
		if _, err := io.ReadFull(conn, command); err != nil {
			return
		}
		_, _ = io.WriteString(conn, "+PONG\r\n")
		_, _ = io.Copy(io.Discard, conn)
		closed <- struct{}{}
	})
	input := request("tcp-exchange", address)
	input.Payload, input.TimeoutMS = "PING", 100
	result, err := (Engine{}).Run(context.Background(), input)
	if err != nil || result.Exchange == nil || result.Outcome != "partial" || result.Exchange.Outcome != "partial" || result.Exchange.ReplyText != "+PONG\r\n" || result.Exchange.ReceivedBytes != 7 || !strings.Contains(result.Exchange.Detail, "Received 7 bytes") || !strings.Contains(result.Exchange.Detail, "peer completion was not observed") || strings.Contains(result.Exchange.Detail, "No completion") {
		t.Fatalf("lost reply or overstated completion: %+v %v", result, err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("read deadline left socket open")
	}
}

type replyAtDeadlineConn struct{ net.Conn }

func (replyAtDeadlineConn) Read(data []byte) (int, error) {
	return copy(data, []byte("reply")), os.ErrDeadlineExceeded
}

func TestTCPDeadlineDetailRetainsReceivedBytes(t *testing.T) {
	local, peer := net.Pipe()
	defer peer.Close()
	engine := Engine{Dial: func(context.Context, string, string) (net.Conn, error) { return replyAtDeadlineConn{local}, nil }}
	result, err := engine.Run(context.Background(), request("tcp-exchange", "127.0.0.1:7"))
	if err != nil || result.Outcome != "partial" || result.Exchange.ReceivedBytes != 5 || !strings.Contains(result.Exchange.Detail, "Received 5 bytes before the local read deadline") || !strings.Contains(result.Exchange.Detail, "peer completion was not observed") {
		t.Fatalf("deadline detail lost evidence: %+v %v", result, err)
	}
}

// Ignore socket deadlines to force the context-close side of the deadline race.
type contextClosedProbe struct{ net.Conn }

func (conn contextClosedProbe) SetDeadline(time.Time) error { return nil }

func TestExchangeContextCloseRemainsTimeoutEvidence(t *testing.T) {
	for _, protocol := range []string{"tcp", "udp"} {
		t.Run(protocol, func(t *testing.T) {
			left, right := net.Pipe()
			defer right.Close()
			engine := Engine{Dial: func(context.Context, string, string) (net.Conn, error) { return contextClosedProbe{left}, nil }}
			result := Result{}
			engine.exchange(context.Background(), Request{Mode: protocol + "-exchange", TimeoutMS: 100}, endpoint{host: "127.0.0.1", port: "1"}, netip.MustParseAddr("127.0.0.1"), &result)
			if result.Exchange == nil || result.Exchange.Outcome != "timeout" || !strings.Contains(result.Exchange.Detail, "deadline") {
				t.Fatalf("lost timeout cause: %+v", result.Exchange)
			}
		})
	}
}
