package netpath

import (
	"encoding/binary"
	"net/netip"
	"testing"
)

func echoFixture(target netip.Addr, reply bool) []byte {
	messageType := byte(8)
	if target.Is6() {
		messageType = 128
	}
	if reply {
		if target.Is6() {
			messageType = 129
		} else {
			messageType = 0
		}
	}
	raw := []byte{messageType, 0, 0, 0, 0x12, 0x34, 0, 7}
	return append(raw, []byte("owned-probe-data!")...)
}

func echoQuoteFixture(target netip.Addr, full bool) []byte {
	headerSize, messageType, protocol := 20, byte(11), byte(1)
	if target.Is6() {
		headerSize, messageType, protocol = 40, 3, 58
	}
	ip := make([]byte, headerSize)
	if target.Is4() {
		ip[0], ip[9] = 0x45, protocol
		address := target.As4()
		copy(ip[16:20], address[:])
		binary.BigEndian.PutUint16(ip[2:4], uint16(headerSize+24))
	} else {
		ip[0], ip[6] = 0x60, protocol
		address := target.As16()
		copy(ip[24:40], address[:])
		binary.BigEndian.PutUint16(ip[4:6], 24)
	}
	inner := echoFixture(target, false)
	if !full {
		inner = inner[:8]
	}
	return append(append([]byte{messageType, 0, 0, 0, 0, 0, 0, 0}, ip...), inner...)
}

func TestICMPEvidencePinsDestinationNonceIdentifierAndSequence(t *testing.T) {
	for _, address := range []string{"192.0.2.1", "2001:db8::1"} {
		target := netip.MustParseAddr(address)
		nonce := []byte("owned-probe-data!")
		for _, raw := range [][]byte{echoFixture(target, true), echoQuoteFixture(target, false), echoQuoteFixture(target, true)} {
			if _, ok := matchEchoEvidence(raw, target, 0x1234, 7, nonce); !ok {
				t.Fatalf("valid %s evidence rejected", address)
			}
			if _, ok := matchEchoEvidence(raw, target, 0x1235, 7, nonce); ok {
				t.Fatal("wrong identifier accepted")
			}
			if _, ok := matchEchoEvidence(raw, target, 0x1234, 8, nonce); ok {
				t.Fatal("wrong sequence accepted")
			}
		}
		quote := echoQuoteFixture(target, true)
		quote[len(quote)-1] ^= 1
		if _, ok := matchEchoEvidence(quote, target, 0x1234, 7, nonce); ok {
			t.Fatal("contradictory nonce accepted")
		}
		other := netip.MustParseAddr("192.0.2.2")
		if target.Is6() {
			other = netip.MustParseAddr("2001:db8::2")
		}
		if _, ok := matchEchoEvidence(echoQuoteFixture(other, true), target, 0x1234, 7, nonce); ok {
			t.Fatal("unrelated quoted destination accepted")
		}
		for length := 0; length < 8; length++ {
			if _, ok := matchEchoEvidence(quote[:length], target, 0x1234, 7, nonce); ok {
				t.Fatal("short message accepted")
			}
		}
		bad := echoQuoteFixture(target, true)
		if target.Is4() {
			bad[8+9] = 17
		} else {
			bad[8+6] = 17
		}
		if _, ok := matchEchoEvidence(bad, target, 0x1234, 7, nonce); ok {
			t.Fatal("UDP quote accepted as ICMP")
		}
	}
}

func TestICMPEvidenceRejectsFragmentAndUnrelatedTypes(t *testing.T) {
	target := netip.MustParseAddr("192.0.2.1")
	nonce := []byte("owned-probe-data!")
	raw := echoQuoteFixture(target, false)
	raw[8+6] = 0x20
	if _, ok := matchEchoEvidence(raw, target, 0x1234, 7, nonce); ok {
		t.Fatal("fragment accepted")
	}
	raw = echoFixture(target, false)
	if _, ok := matchEchoEvidence(raw, target, 0x1234, 7, nonce); ok {
		t.Fatal("outgoing request accepted as reply")
	}
	raw = echoQuoteFixture(target, true)
	raw[0], raw[1] = 3, 13
	if evidence, ok := matchEchoEvidence(raw, target, 0x1234, 7, nonce); !ok || evidence.kind != "unreachable" || evidence.code != 13 {
		t.Fatal("administrative unreachable evidence lost")
	}
}
