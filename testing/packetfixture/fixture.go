// Package packetfixture generates synthetic packet files for workbench QA.
// The addresses are documentation ranges; this package sends no network traffic.
package packetfixture

import "encoding/binary"

func Bytes(count int) []byte {
	le, be := binary.LittleEndian, binary.BigEndian
	raw := make([]byte, 24)
	le.PutUint32(raw, 0xa1b2c3d4)
	le.PutUint16(raw[4:6], 2)
	le.PutUint16(raw[6:8], 4)
	le.PutUint32(raw[16:20], 65535)
	le.PutUint32(raw[20:24], 1)
	for i := 0; i < count; i++ {
		payload := []byte("GET /fixture?token=redacted HTTP/1.1\r\nHost: qa.example\r\n\r\n")
		proto := byte(6)
		port := uint16(80)
		header := 20
		if i%3 == 1 {
			payload = []byte{23, 3, 3, 0, 6, 1, 2, 3, 4, 5, 6}
			port = 443
		}
		if i%3 == 2 {
			proto = 17
			header = 8
			port = 53
			payload = []byte{0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 'q', 'a', 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 0, 0, 1, 0, 1}
		}
		packet := make([]byte, 14+20+header+len(payload))
		be.PutUint16(packet[12:14], 0x800)
		ip := packet[14:]
		ip[0], ip[8], ip[9] = 0x45, 64, proto
		be.PutUint16(ip[2:4], uint16(len(ip)))
		copy(ip[12:16], []byte{192, 0, 2, 10})
		copy(ip[16:20], []byte{198, 51, 100, 20})
		transport := ip[20:]
		be.PutUint16(transport[:2], uint16(50000+i))
		be.PutUint16(transport[2:4], port)
		if proto == 6 {
			transport[12], transport[13] = 0x50, 0x18
			be.PutUint32(transport[4:8], uint32(i*100))
		} else {
			be.PutUint16(transport[4:6], uint16(len(transport)))
		}
		copy(transport[header:], payload)
		h := make([]byte, 16)
		le.PutUint32(h, 1700000000+uint32(i))
		le.PutUint32(h[8:12], uint32(len(packet)))
		le.PutUint32(h[12:16], uint32(len(packet)))
		raw = append(raw, h...)
		raw = append(raw, packet...)
	}
	return raw
}
