package packetwork

import (
	"fmt"
	"net/netip"
)

// These decoders recognize bounded header evidence, not decrypted application content.
func decodeDatagram(p *Packet, raw []byte) {
	if (p.SourcePort == 67 || p.SourcePort == 68) && (p.DestinationPort == 67 || p.DestinationPort == 68) && len(raw) >= 240 && (raw[0] == 1 || raw[0] == 2) && be.Uint32(raw[236:240]) == 0x63825363 {
		message := byte(0)
		server := "not recorded"
		options := raw[240:]
		for count := 0; len(options) > 0 && count < 128; count++ {
			code := options[0]
			options = options[1:]
			if code == 255 {
				break
			}
			if code == 0 {
				continue
			}
			if len(options) < 1 || int(options[0]) > len(options)-1 {
				return
			}
			size := int(options[0])
			value := options[1 : 1+size]
			options = options[1+size:]
			if code == 53 && size == 1 {
				message = value[0]
			}
			if code == 54 && size == 4 {
				server = netip.AddrFrom4([4]byte(value)).String()
			}
		}
		p.Protocol = "DHCP"
		p.Info = fmt.Sprintf("BOOTP op %d · DHCP message %d · offered %s · server %s; client identifiers omitted", raw[0], message, netip.AddrFrom4([4]byte(raw[16:20])), server)
		return
	}
	if p.Protocol != "UDP" {
		return
	}
	if len(raw) < 7 || raw[0]&0x80 == 0 {
		return
	}
	version := be.Uint32(raw[1:5])
	// Recognize only v1 (RFC 9000), v2 (RFC 9369), or version negotiation.
	// Matching unprotected bytes is still a signature, not protocol authentication.
	if version != 0 && version != 1 && version != 0x6b3343cf {
		return
	}
	if version != 0 && raw[0]&0x40 == 0 {
		return
	}
	dcid := int(raw[5])
	if dcid > 20 || len(raw) < 7+dcid {
		return
	}
	scid := int(raw[6+dcid])
	if scid > 20 || len(raw) < 7+dcid+scid {
		return
	}
	if version == 0 && (len(raw)-(7+dcid+scid) == 0 || (len(raw)-(7+dcid+scid))%4 != 0) {
		return
	}
	p.Protocol = "QUIC-like"
	p.Info = fmt.Sprintf("Long-header signature · version 0x%08x · connection ID lengths %d/%d · not decrypted or authenticated", version, dcid, scid)
}
