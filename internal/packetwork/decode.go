package packetwork

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
	"unicode"
)

var be = binary.BigEndian

func decodePacket(raw []byte, link uint32) Packet {
	p := Packet{Protocol: "Unknown", Info: "Unsupported link type " + strconv.FormatUint(uint64(link), 10)}
	short := func() Packet { p.Truncated = true; p.Info = "Incomplete or malformed packet header"; return p }
	kind := uint16(0)
	switch link {
	case 1:
		if len(raw) < 14 {
			return short()
		}
		kind = be.Uint16(raw[12:14])
		raw = raw[14:]
		for i := 0; (kind == 0x8100 || kind == 0x88a8) && i < 2; i++ {
			if len(raw) < 4 {
				return short()
			}
			kind = be.Uint16(raw[2:4])
			raw = raw[4:]
		}
	case 101, 228, 229:
		if len(raw) == 0 {
			return short()
		}
		if raw[0]>>4 == 4 {
			kind = 0x800
		} else if raw[0]>>4 == 6 {
			kind = 0x86dd
		}
	case 0, 108:
		if len(raw) < 4 {
			return short()
		}
		family := be.Uint32(raw[:4])
		if link == 0 {
			family = binary.LittleEndian.Uint32(raw[:4])
			if family > 255 {
				family = be.Uint32(raw[:4])
			}
		}
		raw = raw[4:]
		if family == 2 {
			kind = 0x800
		} else if family == 10 || family == 24 || family == 28 || family == 30 {
			kind = 0x86dd
		}
	case 113:
		if len(raw) < 16 {
			return short()
		}
		kind = be.Uint16(raw[14:16])
		raw = raw[16:]
	case 276:
		if len(raw) < 20 {
			return short()
		}
		kind = be.Uint16(raw[:2])
		raw = raw[20:]
	default:
		return p
	}
	p.Info = "EtherType 0x" + strconv.FormatUint(uint64(kind), 16)
	var protocol byte
	switch kind {
	case 0x806:
		p.Protocol = "ARP"
		if len(raw) < 8 {
			return short()
		}
		p.Info = fmt.Sprintf("Operation %d", be.Uint16(raw[6:8]))
		if len(raw) >= 28 && raw[4] == 6 && raw[5] == 4 && be.Uint16(raw[2:4]) == 0x800 {
			p.Source = netip.AddrFrom4([4]byte(raw[14:18])).String()
			p.Destination = netip.AddrFrom4([4]byte(raw[24:28])).String()
		}
		return p
	case 0x800:
		p.Protocol = "IPv4"
		if len(raw) < 20 || raw[0]>>4 != 4 {
			return short()
		}
		header := int(raw[0]&15) * 4
		total := int(be.Uint16(raw[2:4]))
		if header < 20 || total < header || len(raw) < header {
			return short()
		}
		p.Source = netip.AddrFrom4([4]byte(raw[12:16])).String()
		p.Destination = netip.AddrFrom4([4]byte(raw[16:20])).String()
		protocol = raw[9]
		if total < len(raw) {
			raw = raw[:total]
		} else if total > len(raw) {
			p.Truncated = true
		}
		if be.Uint16(raw[6:8])&0x1fff != 0 {
			p.Info = "Non-initial IPv4 fragment; transport not decoded"
			return p
		}
		raw = raw[header:]
	case 0x86dd:
		p.Protocol = "IPv6"
		if len(raw) < 40 || raw[0]>>4 != 6 {
			return short()
		}
		p.Source = netip.AddrFrom16([16]byte(raw[8:24])).String()
		p.Destination = netip.AddrFrom16([16]byte(raw[24:40])).String()
		protocol = raw[6]
		total := 40 + int(be.Uint16(raw[4:6]))
		if total == 40 && len(raw) > 40 {
			p.Info = "IPv6 jumbogram not decoded"
			return p
		}
		if total < len(raw) {
			raw = raw[:total]
		} else if total > len(raw) {
			p.Truncated = true
		}
		raw = raw[40:]
		for i := 0; protocol == 0 || protocol == 43 || protocol == 44 || protocol == 60 || protocol == 51; i++ {
			if i == 8 {
				p.Info = "IPv6 extension chain exceeds reader limit"
				return p
			}
			if len(raw) < 2 {
				return short()
			}
			size := (int(raw[1]) + 1) * 8
			if protocol == 44 {
				size = 8
				if len(raw) < 8 {
					return short()
				}
				if be.Uint16(raw[2:4])&0xfff8 != 0 {
					p.Info = "Non-initial IPv6 fragment; transport not decoded"
					return p
				}
			} else if protocol == 51 {
				size = (int(raw[1]) + 2) * 4
			}
			if size > len(raw) {
				return short()
			}
			protocol = raw[0]
			raw = raw[size:]
		}
	default:
		return p
	}
	p.Info = fmt.Sprintf("IP protocol %d", protocol)
	switch protocol {
	case 6:
		p.Protocol = "TCP"
		if len(raw) < 20 {
			return short()
		}
		header := int(raw[12]>>4) * 4
		if header < 20 || header > len(raw) {
			return short()
		}
		p.SourcePort = be.Uint16(raw[:2])
		p.DestinationPort = be.Uint16(raw[2:4])
		flags := []string{}
		for _, flag := range []struct {
			mask byte
			name string
		}{{2, "SYN"}, {16, "ACK"}, {1, "FIN"}, {4, "RST"}, {8, "PSH"}, {32, "URG"}, {64, "ECE"}, {128, "CWR"}} {
			if raw[13]&flag.mask != 0 {
				flags = append(flags, flag.name)
			}
		}
		p.Info = fmt.Sprintf("%s · seq %d · ack %d · payload %d B", strings.Join(flags, ", "), be.Uint32(raw[4:8]), be.Uint32(raw[8:12]), len(raw)-header)
		payload := raw[header:]
		if (p.SourcePort == 53 || p.DestinationPort == 53) && len(payload) >= 2 {
			n := int(be.Uint16(payload[:2]))
			if n <= len(payload)-2 {
				decodeDNS(&p, payload[2:2+n])
			}
		}
		decodeApplication(&p, payload)
	case 17:
		p.Protocol = "UDP"
		if len(raw) < 8 {
			return short()
		}
		size := int(be.Uint16(raw[4:6]))
		if size < 8 {
			return short()
		}
		if size > len(raw) {
			p.Truncated = true
		} else {
			raw = raw[:size]
		}
		p.SourcePort = be.Uint16(raw[:2])
		p.DestinationPort = be.Uint16(raw[2:4])
		p.Info = fmt.Sprintf("Datagram · payload %d B", len(raw)-8)
		if p.SourcePort == 53 || p.DestinationPort == 53 || p.SourcePort == 5353 || p.DestinationPort == 5353 {
			decodeDNS(&p, raw[8:])
		}
	case 1, 58:
		p.Protocol = "ICMP"
		if protocol == 58 {
			p.Protocol = "ICMPv6"
		}
		if len(raw) < 4 {
			return short()
		}
		p.Info = fmt.Sprintf("Type %d · code %d", raw[0], raw[1])
	case 50:
		p.Protocol = "ESP"
		p.Info = "Encrypted IPsec payload"
	}
	return p
}

func cleanLabel(raw []byte, limit int) string {
	if len(raw) > limit {
		raw = raw[:limit]
	}
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, string(raw))
}

func decodeDNS(p *Packet, raw []byte) {
	if len(raw) < 12 || be.Uint16(raw[4:6]) == 0 {
		return
	}
	pos := 12
	end := 0
	labels := []string{}
	steps := 0
	total := 0
	for {
		steps++
		if steps > 128 || pos >= len(raw) {
			return
		}
		size := int(raw[pos])
		pos++
		if size == 0 {
			if end == 0 {
				end = pos
			}
			break
		}
		if size&0xc0 == 0xc0 {
			if pos >= len(raw) {
				return
			}
			if end == 0 {
				end = pos + 1
			}
			pos = (size&63)<<8 | int(raw[pos])
			continue
		}
		if size > 63 || pos+size > len(raw) || total+size > 253 {
			return
		}
		labels = append(labels, cleanLabel(raw[pos:pos+size], 63))
		total += size + 1
		pos += size
	}
	if end+4 > len(raw) {
		return
	}
	p.Protocol = "DNS"
	action := "Query"
	if raw[2]&0x80 != 0 {
		action = "Response"
	}
	p.Info = fmt.Sprintf("%s · %s · type %d · rcode %d", action, strings.Join(labels, "."), be.Uint16(raw[end:end+2]), raw[3]&15)
}

func decodeApplication(p *Packet, raw []byte) {
	if len(raw) > 0 {
		end := bytes.Index(raw, []byte("\r\n"))
		if end >= 0 && end <= 512 {
			line := string(raw[:end])
			parts := strings.Split(line, " ")
			if len(parts) == 3 && (parts[2] == "HTTP/1.0" || parts[2] == "HTTP/1.1") {
				for _, method := range []string{"GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "CONNECT", "TRACE"} {
					if parts[0] == method {
						p.Protocol = "HTTP"
						p.Info = method + " · " + parts[2] + " · request target omitted"
						return
					}
				}
			}
			if len(parts) >= 2 && (parts[0] == "HTTP/1.0" || parts[0] == "HTTP/1.1") {
				status, err := strconv.Atoi(parts[1])
				if err == nil && status >= 100 && status <= 599 {
					p.Protocol = "HTTP"
					p.Info = fmt.Sprintf("%s · status %d", parts[0], status)
					return
				}
			}
		}
	}
	if bytes.HasPrefix(raw, []byte("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")) {
		p.Protocol = "HTTP/2"
		p.Info = "Client connection preface"
		return
	}
	if len(raw) >= 5 && raw[0] >= 20 && raw[0] <= 23 && raw[1] == 3 && raw[2] <= 4 && be.Uint16(raw[3:5]) <= 18432 {
		p.Protocol = "TLS"
		kind := map[byte]string{20: "Change cipher spec", 21: "Alert", 22: "Handshake", 23: "Application data"}[raw[0]]
		p.Info = fmt.Sprintf("%s record · %d B · encrypted application details unavailable", kind, be.Uint16(raw[3:5]))
	}
}
