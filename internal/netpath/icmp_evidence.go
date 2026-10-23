package netpath

import (
	"bytes"
	"encoding/binary"
	"net/netip"
)

type echoEvidence struct {
	kind              string
	messageType, code int
}

// Match the owned probe, including the pinned destination inside error quotes.
// A minimum ICMP quote may contain only its identifier and sequence; any nonce
// bytes that are present must also match. This is observation, not authentication.
func matchEchoEvidence(raw []byte, target netip.Addr, identifier, sequence uint16, nonce []byte) (echoEvidence, bool) {
	target = target.Unmap()
	if len(raw) < 8 {
		return echoEvidence{}, false
	}
	request, reply, expired, unreachable := byte(8), byte(0), byte(11), byte(3)
	if target.Is6() {
		request, reply, expired, unreachable = 128, 129, 3, 1
	}
	matchHeader := func(packet []byte) bool {
		if len(packet) < 8 || packet[0] != request || packet[1] != 0 || binary.BigEndian.Uint16(packet[4:6]) != identifier || binary.BigEndian.Uint16(packet[6:8]) != sequence {
			return false
		}
		n := min(len(packet)-8, len(nonce))
		return bytes.Equal(packet[8:8+n], nonce[:n])
	}
	if raw[0] == reply && raw[1] == 0 {
		if len(raw) != 8+len(nonce) || binary.BigEndian.Uint16(raw[4:6]) != identifier || binary.BigEndian.Uint16(raw[6:8]) != sequence || !bytes.Equal(raw[8:], nonce) {
			return echoEvidence{}, false
		}
		return echoEvidence{kind: "echo", messageType: int(reply)}, true
	}
	if !((raw[0] == expired && raw[1] == 0) || raw[0] == unreachable) {
		return echoEvidence{}, false
	}
	quote := raw[8:]
	var original []byte
	if target.Is4() {
		if len(quote) < 28 || quote[0]>>4 != 4 || quote[9] != 1 || binary.BigEndian.Uint16(quote[6:8])&0x3fff != 0 {
			return echoEvidence{}, false
		}
		size := int(quote[0]&15) * 4
		if size < 20 || size > 60 || len(quote) < size+8 || netip.AddrFrom4([4]byte(quote[16:20])) != target {
			return echoEvidence{}, false
		}
		original = quote[size:]
	} else {
		// This backend emits a small ICMP echo with no extension headers. Refuse
		// unrelated, fragmented or unrecognized quoted transports rather than guess.
		if len(quote) < 48 || quote[0]>>4 != 6 || quote[6] != 58 || netip.AddrFrom16([16]byte(quote[24:40])) != target.WithZone("") {
			return echoEvidence{}, false
		}
		original = quote[40:]
	}
	if !matchHeader(original) {
		return echoEvidence{}, false
	}
	kind := "expired"
	if raw[0] == unreachable {
		kind = "unreachable"
	}
	return echoEvidence{kind: kind, messageType: int(raw[0]), code: int(raw[1])}, true
}
