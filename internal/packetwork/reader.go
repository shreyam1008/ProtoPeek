// Package packetwork reads bounded packet metadata without retaining application
// payloads, resolving names, or loading a native capture library into ProtoPeek.
package packetwork

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math/bits"
	"time"
)

const MaxFileBytes = 16 << 20
const MaxRecords = 20000
const MaxRows = 2000

type Packet struct {
	Number          int    `json:"number"`
	Timestamp       string `json:"timestamp,omitempty"`
	Interface       int    `json:"interface"`
	Length          uint32 `json:"length"`
	Captured        int    `json:"captured"`
	Source          string `json:"source"`
	Destination     string `json:"destination"`
	SourcePort      uint16 `json:"sourcePort,omitempty"`
	DestinationPort uint16 `json:"destinationPort,omitempty"`
	Protocol        string `json:"protocol"`
	Info            string `json:"info"`
	Truncated       bool   `json:"truncated"`
}

type Report struct {
	Format        string         `json:"format"`
	Packets       []Packet       `json:"packets"`
	PacketCount   int            `json:"packetCount"`
	WireBytes     uint64         `json:"wireBytes"`
	CapturedBytes uint64         `json:"capturedBytes"`
	Protocols     map[string]int `json:"protocols"`
	Limited       bool           `json:"limited"`
	Warnings      []string       `json:"warnings"`
}

type captureInterface struct {
	link    uint32
	snap    uint32
	divisor uint64
	offset  int64
}

func Analyze(ctx context.Context, raw []byte) (Report, error) {
	r := Report{Packets: []Packet{}, Protocols: map[string]int{}, Warnings: []string{}}
	if len(raw) < 4 || len(raw) > MaxFileBytes {
		return r, errors.New("choose a PCAP or PCAPNG file up to 16 MiB")
	}
	var err error
	if binary.BigEndian.Uint32(raw[:4]) == 0x0a0d0d0a {
		r.Format = "PCAPNG"
		err = r.readNG(ctx, raw)
	} else {
		r.Format = "PCAP"
		err = r.readClassic(ctx, raw)
	}
	return r, err
}

func (r *Report) append(raw []byte, length uint32, link uint32, iface int, timestamp string) {
	p := decodePacket(raw, link)
	p.Number, p.Timestamp, p.Interface, p.Length, p.Captured = r.PacketCount+1, timestamp, iface, length, len(raw)
	p.Truncated = p.Truncated || uint32(len(raw)) < length
	r.PacketCount++
	r.WireBytes += uint64(length)
	r.CapturedBytes += uint64(len(raw))
	r.Protocols[p.Protocol]++
	if len(r.Packets) < MaxRows {
		r.Packets = append(r.Packets, p)
	}
}

func (r *Report) warning(text string) {
	for _, old := range r.Warnings {
		if old == text {
			return
		}
	}
	if len(r.Warnings) < 12 {
		r.Warnings = append(r.Warnings, text)
	}
}

func stamp(ticks uint64, iface captureInterface) string {
	seconds := ticks / iface.divisor
	if seconds > 253402300799 || iface.offset < -253402300799 || iface.offset > 253402300799 {
		return ""
	}
	sec := int64(seconds) + iface.offset
	if sec < 0 || sec > 253402300799 {
		return ""
	}
	hi, lo := bits.Mul64(ticks%iface.divisor, 1e9)
	nano, _ := bits.Div64(hi, lo, iface.divisor)
	return time.Unix(sec, int64(nano)).UTC().Format(time.RFC3339Nano)
}

func (r *Report) readClassic(ctx context.Context, raw []byte) error {
	if len(raw) < 24 {
		return errors.New("truncated PCAP header")
	}
	var order binary.ByteOrder
	divisor := uint64(1000000)
	switch binary.BigEndian.Uint32(raw[:4]) {
	case 0xa1b2c3d4:
		order = binary.BigEndian
	case 0xd4c3b2a1:
		order = binary.LittleEndian
	case 0xa1b23c4d:
		order = binary.BigEndian
		divisor = 1000000000
	case 0x4d3cb2a1:
		order = binary.LittleEndian
		divisor = 1000000000
	default:
		return errors.New("unrecognized PCAP magic; compressed captures must be decompressed first")
	}
	if order.Uint16(raw[4:6]) != 2 || order.Uint16(raw[6:8]) != 4 {
		return errors.New("only PCAP version 2.4 is supported")
	}
	iface := captureInterface{link: order.Uint32(raw[20:24]) & 0xffff, snap: order.Uint32(raw[16:20]), divisor: divisor}
	if iface.snap == 0 {
		return errors.New("invalid PCAP snapshot length")
	}
	for pos := 24; pos < len(raw); {
		if err := ctx.Err(); err != nil {
			return err
		}
		if r.PacketCount == MaxRecords {
			r.Limited = true
			r.warning("Stopped after 20,000 packet records; counts describe this prefix only.")
			break
		}
		if len(raw)-pos < 16 {
			return errors.New("truncated PCAP packet header")
		}
		h := raw[pos : pos+16]
		pos += 16
		n, wire := order.Uint32(h[8:12]), order.Uint32(h[12:16])
		if n > uint32(len(raw)-pos) || n > wire || n > iface.snap {
			return errors.New("invalid or truncated PCAP packet length")
		}
		fraction := order.Uint32(h[4:8])
		if uint64(fraction) >= divisor {
			return errors.New("invalid PCAP timestamp fraction")
		}
		r.append(raw[pos:pos+int(n)], wire, iface.link, 0, stamp(uint64(order.Uint32(h[:4]))*divisor+uint64(fraction), iface))
		pos += int(n)
	}
	return nil
}

func readOptions(raw []byte, order binary.ByteOrder, visit func(uint16, []byte) error) error {
	for len(raw) > 0 {
		if len(raw) < 4 {
			return errors.New("truncated PCAPNG option")
		}
		code, size := order.Uint16(raw[:2]), int(order.Uint16(raw[2:4]))
		raw = raw[4:]
		if code == 0 {
			if size != 0 {
				return errors.New("invalid PCAPNG option terminator")
			}
			return nil
		}
		padded := (size + 3) &^ 3
		if padded > len(raw) {
			return errors.New("truncated PCAPNG option value")
		}
		if err := visit(code, raw[:size]); err != nil {
			return err
		}
		raw = raw[padded:]
	}
	return nil
}

func (r *Report) readNG(ctx context.Context, raw []byte) error {
	var order binary.ByteOrder
	var interfaces []captureInterface
	sections := 0
	for pos := 0; pos < len(raw); {
		if err := ctx.Err(); err != nil {
			return err
		}
		if r.PacketCount == MaxRecords {
			r.Limited = true
			r.warning("Stopped after 20,000 packet records; counts describe this prefix only.")
			break
		}
		if len(raw)-pos < 12 {
			return errors.New("truncated PCAPNG block")
		}
		block := raw[pos:]
		section := binary.BigEndian.Uint32(block[:4]) == 0x0a0d0d0a
		if section {
			switch binary.BigEndian.Uint32(block[8:12]) {
			case 0x1a2b3c4d:
				order = binary.BigEndian
			case 0x4d3c2b1a:
				order = binary.LittleEndian
			default:
				return errors.New("invalid PCAPNG byte order")
			}
		}
		if order == nil {
			return errors.New("PCAPNG requires a section header")
		}
		n := order.Uint32(block[4:8])
		if n < 12 || n%4 != 0 || n > uint32(len(block)) || order.Uint32(block[n-4:n]) != n {
			return errors.New("invalid PCAPNG block length")
		}
		body := block[8 : n-4]
		kind := order.Uint32(block[:4])
		pos += int(n)
		switch kind {
		case 0x0a0d0d0a:
			if len(body) < 16 || order.Uint16(body[4:6]) != 1 || order.Uint16(body[6:8]) != 0 {
				return errors.New("only PCAPNG version 1.0 is supported")
			}
			interfaces = nil
			sections++
			if sections > 64 {
				return errors.New("capture exceeds 64 sections")
			}
			if sections > 1 {
				r.warning("Interface numbers are local to each PCAPNG section.")
			}
		case 1:
			if len(body) < 8 || len(interfaces) == 64 {
				return errors.New("invalid or excessive PCAPNG interfaces")
			}
			iface := captureInterface{link: uint32(order.Uint16(body[:2])), snap: order.Uint32(body[4:8]), divisor: 1000000}
			err := readOptions(body[8:], order, func(code uint16, value []byte) error {
				switch code {
				case 9:
					if len(value) != 1 {
						return errors.New("invalid PCAPNG timestamp resolution")
					}
					exponent := value[0] & 0x7f
					if value[0]&0x80 != 0 {
						if exponent > 63 {
							return errors.New("timestamp resolution exceeds reader limit")
						}
						iface.divisor = uint64(1) << exponent
					} else {
						if exponent > 18 {
							return errors.New("timestamp resolution exceeds reader limit")
						}
						iface.divisor = 1
						for i := byte(0); i < exponent; i++ {
							iface.divisor *= 10
						}
					}
				case 14:
					if len(value) != 8 {
						return errors.New("invalid PCAPNG timestamp offset")
					}
					iface.offset = int64(order.Uint64(value))
				}
				return nil
			})
			if err != nil {
				return err
			}
			interfaces = append(interfaces, iface)
		case 6, 2:
			if len(body) < 20 {
				return errors.New("truncated PCAPNG packet header")
			}
			id := order.Uint32(body[:4])
			if kind == 2 {
				id = uint32(order.Uint16(body[:2]))
			}
			if id >= uint32(len(interfaces)) {
				return errors.New("PCAPNG packet references a missing interface")
			}
			iface := interfaces[id]
			captured, wire := order.Uint32(body[12:16]), order.Uint32(body[16:20])
			if captured > uint32(len(body)-20) || captured > wire || (iface.snap != 0 && captured > iface.snap) {
				return errors.New("invalid PCAPNG packet length")
			}
			ticks := uint64(order.Uint32(body[4:8]))<<32 | uint64(order.Uint32(body[8:12]))
			r.append(body[20:20+int(captured)], wire, iface.link, int(id), stamp(ticks, iface))
		case 3:
			if len(body) < 4 || len(interfaces) == 0 {
				return errors.New("invalid simple PCAPNG packet")
			}
			iface := interfaces[0]
			wire := order.Uint32(body[:4])
			captured := wire
			if iface.snap != 0 && captured > iface.snap {
				captured = iface.snap
			}
			if uint64((uint64(captured)+3)&^3) != uint64(len(body)-4) {
				return errors.New("invalid simple PCAPNG packet length")
			}
			r.append(body[4:4+int(captured)], wire, iface.link, 0, "")
		case 4, 5, 0x0000000a: // Name resolution, statistics and decryption secrets are not retained.
		default:
			r.warning(fmt.Sprintf("Skipped unsupported PCAPNG block type 0x%x.", kind))
		}
	}
	return nil
}
