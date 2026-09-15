package localshare

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"time"

	"golang.org/x/net/ipv4"
)

const multicast = "224.0.0.168:53318"

type announcement struct {
	Protocol    string `json:"protocol"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
	Port        int    `json:"port"`
	Ask         bool   `json:"ask"`
}

// Discovery never scans a subnet or contacts arbitrary advertised URLs. A packet's
// source address is the only address recorded; TLS identity is checked when sending.
func (s *Service) startDiscovery(ctx context.Context) {
	group, _ := net.ResolveUDPAddr("udp4", multicast)
	conn, err := net.ListenMulticastUDP("udp4", nil, group)
	if err != nil {
		s.warning = "Nearby discovery unavailable. Connect using the receiver's address and fingerprint."
		return
	}
	s.udp = conn
	// Join every usable LAN interface, including when a VPN owns the default route.
	packet := ipv4.NewPacketConn(conn)
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagMulticast != 0 && iface.Flags&net.FlagLoopback == 0 {
			_ = packet.JoinGroup(&iface, group)
		}
	}
	go func() {
		buf := make([]byte, 2048)
		lastReply := time.Time{}
		for {
			n, source, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			var a announcement
			if json.Unmarshal(buf[:n], &a) != nil || a.Protocol != protocol || a.Port < 1 || a.Port > 65535 || len(a.Fingerprint) != 64 || len(a.Name) > 80 {
				continue
			}
			s.mu.Lock()
			if a.Fingerprint != s.fingerprint && len(s.peers) < 128 && !s.peers[a.Fingerprint].Manual {
				s.peers[a.Fingerprint] = Peer{ID: a.Fingerprint, Name: a.Name, Address: net.JoinHostPort(source.IP.String(), fmt.Sprint(a.Port)), Seen: time.Now()}
			}
			s.mu.Unlock()
			if a.Ask && time.Since(lastReply) > time.Second {
				lastReply = time.Now()
				_ = s.announce(false)
			}
		}
	}()
	go func() {
		_ = s.announce(true)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.announce(true)
			}
		}
	}()
}
func (s *Service) announce(ask bool) error {
	s.mu.Lock()
	if s.server == nil {
		s.mu.Unlock()
		return nil
	}
	a := announcement{Protocol: protocol, Name: s.name, Fingerprint: s.fingerprint, Port: s.port, Ask: ask}
	s.mu.Unlock()
	group, _ := net.ResolveUDPAddr("udp4", multicast)
	conn, err := net.DialUDP("udp4", nil, group)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
	data, _ := json.Marshal(a)
	packet := ipv4.NewPacketConn(conn)
	_ = packet.SetMulticastTTL(1)
	interfaces, _ := net.Interfaces()
	sent := false
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagMulticast == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if packet.SetMulticastInterface(&iface) != nil {
			continue
		}
		if _, err = conn.Write(data); err == nil {
			sent = true
		}
	}
	if sent {
		return nil
	}
	_, err = conn.Write(data)
	return err
}
func (s *Service) Discover() error { return s.announce(true) }
