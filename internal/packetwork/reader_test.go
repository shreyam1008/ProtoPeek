package packetwork

import (
	"context"
	"encoding/binary"
	"strings"
	"testing"
)

func testDNS() []byte {
	dns := []byte{0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 3, 'c', 'o', 'm', 0, 0, 1, 0, 1}
	p := make([]byte, 14+20+8+len(dns))
	be.PutUint16(p[12:14], 0x800)
	ip := p[14:]
	ip[0], ip[8], ip[9] = 0x45, 64, 17
	be.PutUint16(ip[2:4], uint16(len(ip)))
	copy(ip[12:16], []byte{192, 0, 2, 10})
	copy(ip[16:20], []byte{192, 0, 2, 53})
	udp := ip[20:]
	be.PutUint16(udp[:2], 50500)
	be.PutUint16(udp[2:4], 53)
	be.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], dns)
	return p
}
func classic(order binary.ByteOrder, nano bool, packets ...[]byte) []byte {
	raw := make([]byte, 24)
	magic := uint32(0xa1b2c3d4)
	if nano {
		magic = 0xa1b23c4d
	}
	order.PutUint32(raw, magic)
	order.PutUint16(raw[4:6], 2)
	order.PutUint16(raw[6:8], 4)
	order.PutUint32(raw[16:20], 65535)
	order.PutUint32(raw[20:24], 1)
	for _, p := range packets {
		h := make([]byte, 16)
		order.PutUint32(h, 1700000000)
		order.PutUint32(h[4:8], 123456)
		order.PutUint32(h[8:12], uint32(len(p)))
		order.PutUint32(h[12:16], uint32(len(p)))
		raw = append(raw, h...)
		raw = append(raw, p...)
	}
	return raw
}
func ngBlock(order binary.ByteOrder, kind uint32, body []byte) []byte {
	n := 12 + (len(body)+3)&^3
	b := make([]byte, n)
	order.PutUint32(b, kind)
	order.PutUint32(b[4:8], uint32(n))
	copy(b[8:], body)
	order.PutUint32(b[n-4:], uint32(n))
	return b
}
func ng(order binary.ByteOrder, packet []byte) []byte {
	section := make([]byte, 16)
	order.PutUint32(section, 0x1a2b3c4d)
	order.PutUint16(section[4:6], 1)
	order.PutUint64(section[8:], 0xffffffffffffffff)
	raw := ngBlock(order, 0x0a0d0d0a, section)
	iface := make([]byte, 28)
	order.PutUint16(iface, 1)
	order.PutUint32(iface[4:8], 65535)
	order.PutUint16(iface[8:10], 9)
	order.PutUint16(iface[10:12], 1)
	iface[12] = 9
	order.PutUint16(iface[16:18], 14)
	order.PutUint16(iface[18:20], 8)
	order.PutUint64(iface[20:28], 2)
	raw = append(raw, ngBlock(order, 1, iface)...)
	body := make([]byte, 20+len(packet))
	ticks := uint64(1700000000000123456)
	order.PutUint32(body[4:8], uint32(ticks>>32))
	order.PutUint32(body[8:12], uint32(ticks))
	order.PutUint32(body[12:16], uint32(len(packet)))
	order.PutUint32(body[16:20], uint32(len(packet)))
	copy(body[20:], packet)
	return append(raw, ngBlock(order, 6, body)...)
}

func TestCaptureFormatsAndDNS(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		for _, nano := range []bool{false, true} {
			r, err := Analyze(context.Background(), classic(order, nano, testDNS()))
			if err != nil {
				t.Fatal(err)
			}
			p := r.Packets[0]
			if p.Protocol != "DNS" || p.Source != "192.0.2.10" || p.DestinationPort != 53 || !strings.Contains(p.Info, "example.com") || p.Truncated {
				t.Fatalf("bad packet %+v", p)
			}
			want := "2023-11-14T22:13:20.123456Z"
			if nano {
				want = "2023-11-14T22:13:20.000123456Z"
			}
			if p.Timestamp != want {
				t.Fatal(p.Timestamp)
			}
		}
	}
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		r, err := Analyze(context.Background(), ng(order, testDNS()))
		if err != nil {
			t.Fatal(err)
		}
		if r.Packets[0].Timestamp != "2023-11-14T22:13:22.000123456Z" {
			t.Fatal(r.Packets[0])
		}
	}
}

func TestMalformedCaptureAndBounds(t *testing.T) {
	valid := classic(binary.LittleEndian, false, testDNS())
	brokenLength := append([]byte{}, valid...)
	binary.LittleEndian.PutUint32(brokenLength[32:36], 0xffffffff)
	invalidNG := ng(binary.LittleEndian, testDNS())
	invalidNG[len(invalidNG)-1] ^= 1
	for _, raw := range [][]byte{nil, {1, 2, 3, 4}, valid[:23], valid[:len(valid)-1], brokenLength, invalidNG, make([]byte, MaxFileBytes+1)} {
		if _, err := Analyze(context.Background(), raw); err == nil {
			t.Fatal("accepted malformed capture")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Analyze(ctx, valid); err != context.Canceled {
		t.Fatal(err)
	}
	packets := make([][]byte, MaxRecords+1)
	for i := range packets {
		packets[i] = testDNS()
	}
	r, err := Analyze(context.Background(), classic(binary.LittleEndian, false, packets...))
	if err != nil {
		t.Fatal(err)
	}
	if !r.Limited || len(r.Packets) != MaxRows || r.PacketCount != MaxRecords || r.Protocols["DNS"] != MaxRecords {
		t.Fatalf("limits %+v", r.PacketCount)
	}
}

func TestPacketHeaderVariantsAndNoSecretRetention(t *testing.T) {
	raw := testDNS()
	vlan := append([]byte{}, raw[:12]...)
	vlan = append(vlan, 0x81, 0, 0, 7, 8, 0)
	vlan = append(vlan, raw[14:]...)
	if p := decodePacket(vlan, 1); p.Protocol != "DNS" {
		t.Fatal(p)
	}
	fragment := append([]byte{}, raw...)
	fragment[21] = 1
	if p := decodePacket(fragment, 1); p.Protocol != "IPv4" || p.DestinationPort != 0 {
		t.Fatal(p)
	}
	for _, link := range []uint32{0, 101, 108, 113, 276} {
		prefix := []byte{}
		switch link {
		case 0:
			prefix = []byte{2, 0, 0, 0}
		case 108:
			prefix = []byte{0, 0, 0, 2}
		case 113:
			prefix = make([]byte, 16)
			be.PutUint16(prefix[14:], 0x800)
		case 276:
			prefix = make([]byte, 20)
			be.PutUint16(prefix, 0x800)
		}
		p := decodePacket(append(prefix, raw[14:]...), link)
		if p.Protocol != "DNS" {
			t.Fatalf("link %d: %+v", link, p)
		}
	}
	ipv6 := make([]byte, 40+len(raw)-34)
	ipv6[0], ipv6[6], ipv6[7] = 0x60, 17, 64
	be.PutUint16(ipv6[4:6], uint16(len(ipv6)-40))
	ipv6[23], ipv6[39] = 1, 2
	copy(ipv6[40:], raw[34:])
	if p := decodePacket(ipv6, 101); p.Protocol != "DNS" || p.Source != "::1" {
		t.Fatal(p)
	}
	p := Packet{Protocol: "TCP"}
	decodeApplication(&p, []byte("GET /private?token=secret HTTP/1.1\r\nAuthorization: secret\r\n\r\n"))
	if p.Protocol != "HTTP" || strings.Contains(p.Info, "secret") || strings.Contains(p.Info, "private") {
		t.Fatal(p)
	}
	decodeApplication(&p, []byte{23, 3, 3, 0, 12})
	if p.Protocol != "TLS" {
		t.Fatal(p)
	}
	for n := 0; n < len(raw); n++ {
		_ = decodePacket(raw[:n], 1)
	}
}

func FuzzCaptureReader(f *testing.F) {
	f.Add(classic(binary.LittleEndian, false, testDNS()))
	f.Add(ng(binary.BigEndian, testDNS()))
	f.Add([]byte{1, 2, 3, 4})
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > 1<<20 {
			return
		}
		_, _ = Analyze(context.Background(), raw)
	})
}
