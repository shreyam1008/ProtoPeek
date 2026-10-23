package packetwork

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func tcpPacket(sequence uint32, flags byte, payload []byte, port uint16) []byte {
	p := make([]byte, 14+20+20+len(payload))
	be.PutUint16(p[12:14], 0x800)
	ip := p[14:]
	ip[0], ip[8], ip[9] = 0x45, 64, 6
	be.PutUint16(ip[2:4], uint16(len(ip)))
	copy(ip[12:16], []byte{192, 0, 2, 1})
	copy(ip[16:20], []byte{192, 0, 2, 2})
	tcp := ip[20:]
	be.PutUint16(tcp[:2], port)
	be.PutUint16(tcp[2:4], 443)
	be.PutUint32(tcp[4:8], sequence)
	tcp[12], tcp[13] = 0x50, flags
	copy(tcp[20:], payload)
	return p
}

func TestReconstructionFixtureAndDefaultOff(t *testing.T) {
	raw, err := os.ReadFile("testdata/tcp-evidence.pcap")
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := Analyze(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Reconstruction != nil {
		t.Fatal("payload retained by default")
	}
	for _, packet := range metadata.Packets {
		if packet.payload != nil {
			t.Fatal("capture backing bytes retained in metadata")
		}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "aGVsbG8=") || strings.Contains(string(encoded), "reconstruction") {
		t.Fatal("payload serialized without consent")
	}
	r, err := AnalyzeWithOptions(context.Background(), raw, AnalyzeOptions{ReconstructTCP: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Reconstruction.Flows) != 2 {
		t.Fatalf("tuple reuse merged: %+v", r.Reconstruction)
	}
	flow := r.Reconstruction.Flows[0]
	d := flow.Directions[0]
	if !d.StartObserved || d.EndObserved || d.SequenceAmbiguous {
		t.Fatalf("bad boundaries %+v", d)
	}
	if len(d.Gaps) != 1 || d.Gaps[0] != (TCPSpan{Start: 11, End: 20}) {
		t.Fatalf("gaps %+v", d.Gaps)
	}
	if len(d.Conflicts) != 1 || d.Conflicts[0] != (TCPSpan{Start: 1, End: 4}) {
		t.Fatalf("conflicts %+v", d.Conflicts)
	}
	if len(d.Segments) != 6 || d.Segments[len(d.Segments)-1].Offset != 20 {
		t.Fatalf("wrap/out-of-order lost: %+v", d.Segments)
	}
	if flow.Directions[1].StartObserved || len(flow.Directions[1].Segments) != 1 {
		t.Fatal("reverse direction evidence changed")
	}
	if r.Packets[1].Transport != "TCP" || r.Packets[1].TCP.Sequence != 0xfffffff9 {
		t.Fatal("TCP header metadata missing")
	}
}

func TestReconstructionBoundsAndAmbiguousSequence(t *testing.T) {
	large := make([]byte, 40000)
	for i := range large {
		large[i] = 'x'
	}
	packets := [][]byte{}
	for i := 0; i < 5; i++ {
		packets = append(packets, tcpPacket(1, 2, nil, uint16(40000+i)), tcpPacket(2, 16, large, uint16(40000+i)), tcpPacket(40002, 16, large, uint16(40000+i)))
	}
	r, err := AnalyzeWithOptions(context.Background(), classic(binary.LittleEndian, false, packets...), AnalyzeOptions{ReconstructTCP: true})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Reconstruction.Limited || r.Reconstruction.RetainedBytes != MaxTCPPayloadBytes {
		t.Fatalf("byte bound %+v", r.Reconstruction)
	}
	for _, flow := range r.Reconstruction.Flows {
		if flow.bytes > MaxTCPFlowBytes {
			t.Fatal("per-flow byte bound exceeded")
		}
	}
	packets = nil
	for i := 0; i < MaxTCPSegments+10; i++ {
		packets = append(packets, tcpPacket(1, 16, []byte("x"), 40000))
	}
	r, err = AnalyzeWithOptions(context.Background(), classic(binary.LittleEndian, false, packets...), AnalyzeOptions{ReconstructTCP: true})
	if err != nil || !r.Reconstruction.Limited || len(r.Reconstruction.Flows[0].Directions[0].Segments) != MaxTCPSegments {
		t.Fatalf("segment limit: %v", err)
	}
	r, err = AnalyzeWithOptions(context.Background(), classic(binary.LittleEndian, false, tcpPacket(0, 16, []byte("a"), 40000), tcpPacket(0x80000000, 16, []byte("b"), 40000)), AnalyzeOptions{ReconstructTCP: true})
	if err != nil || !r.Reconstruction.Flows[0].Directions[0].SequenceAmbiguous || r.Reconstruction.RetainedBytes != 1 {
		t.Fatalf("guessed sequence epoch: %v", err)
	}
}

func TestReconstructionSectionsFragmentsAndTransport(t *testing.T) {
	p := tcpPacket(1, 16, []byte("GET / HTTP/1.1\r\n"), 40000)
	raw := append(ng(binary.LittleEndian, p), ng(binary.BigEndian, p)...)
	r, err := AnalyzeWithOptions(context.Background(), raw, AnalyzeOptions{ReconstructTCP: true})
	if err != nil {
		t.Fatal(err)
	}
	if r.Packets[0].Protocol != "HTTP" || r.Packets[0].Transport != "TCP" || r.Packets[1].Section != 1 || len(r.Reconstruction.Flows) != 2 {
		t.Fatal("capture section or underlying transport identity lost")
	}
	be.PutUint16(p[20:22], 0x2000) // First IP fragment: metadata is useful, stream payload is not reassembled.
	r, err = AnalyzeWithOptions(context.Background(), classic(binary.LittleEndian, false, p), AnalyzeOptions{ReconstructTCP: true})
	if err != nil || r.Reconstruction.SkippedFragments != 1 || r.Reconstruction.RetainedBytes != 0 {
		t.Fatalf("fragment reconstructed: %v", err)
	}
	packets := [][]byte{}
	for i := 0; i < MaxTCPFlows+1; i++ {
		packets = append(packets, tcpPacket(1, 2, nil, uint16(40000+i)))
	}
	r, err = AnalyzeWithOptions(context.Background(), classic(binary.LittleEndian, false, packets...), AnalyzeOptions{ReconstructTCP: true})
	if err != nil || !r.Reconstruction.Limited || len(r.Reconstruction.Flows) != MaxTCPFlows {
		t.Fatalf("flow bound: %v", err)
	}
}

func TestBoundedDHCPAndQUICHeaders(t *testing.T) {
	dhcp := make([]byte, 240)
	dhcp[0] = 2
	copy(dhcp[16:20], []byte{192, 0, 2, 100})
	be.PutUint32(dhcp[236:240], 0x63825363)
	dhcp = append(dhcp, 53, 1, 2, 54, 4, 192, 0, 2, 1, 255)
	p := Packet{Protocol: "UDP", SourcePort: 67, DestinationPort: 68}
	decodeDatagram(&p, dhcp)
	if p.Protocol != "DHCP" || !strings.Contains(p.Info, "192.0.2.100") || !strings.Contains(p.Info, "message 2") {
		t.Fatal(p)
	}
	p = Packet{Protocol: "UDP", SourcePort: 67, DestinationPort: 68}
	decodeDatagram(&p, append(dhcp[:240:240], 53, 3, 1))
	if p.Protocol != "UDP" {
		t.Fatal("malformed DHCP options accepted")
	}
	for _, raw := range [][]byte{{0xc0, 0, 0, 0, 1, 0, 0}, {0xc0, 0x6b, 0x33, 0x43, 0xcf, 0, 0}, {0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}} {
		p = Packet{Protocol: "UDP"}
		decodeDatagram(&p, raw)
		if p.Protocol != "QUIC-like" || !strings.Contains(p.Info, "not decrypted or authenticated") {
			t.Fatal(p)
		}
	}
	for _, raw := range [][]byte{
		{0xc0, 0xde, 0xad, 0xbe, 0xef, 0, 0}, // Unknown nonzero version.
		{0x80, 0, 0, 0, 1, 0, 0},             // v1 fixed bit absent.
		{0xc0, 0, 0, 0, 1, 21, 0},            // Excessive destination connection ID.
		{0xc0, 0, 0, 0, 1, 0, 2, 1},          // Truncated source connection ID.
		{0x80, 0, 0, 0, 0, 0, 0},             // Empty negotiation versions.
		{0x80, 0, 0, 0, 0, 0, 0, 1},          // Incomplete negotiation version.
	} {
		p = Packet{Protocol: "UDP", SourcePort: 443}
		decodeDatagram(&p, raw)
		if p.Protocol != "UDP" {
			t.Fatalf("invalid QUIC-like signature accepted: %x", raw)
		}
	}
	p = Packet{Protocol: "DNS"}
	decodeDatagram(&p, []byte{0xc0, 0, 0, 0, 1, 0, 0})
	if p.Protocol != "DNS" {
		t.Fatal("DNS signature overwritten")
	}
}
