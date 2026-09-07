package tailnet

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Peer struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	DNSName           string   `json:"dnsName"`
	OS                string   `json:"os"`
	IPs               []string `json:"ips"`
	Routes            []string `json:"routes"`
	Online            *bool    `json:"online"`
	Active            bool     `json:"active"`
	Connection        string   `json:"connection"`
	Endpoint          string   `json:"endpoint"`
	Relay             string   `json:"relay"`
	ExitNode          bool     `json:"exitNode"`
	ExitNodeOption    bool     `json:"exitNodeOption"`
	TaildropAvailable bool     `json:"taildropAvailable"`
	FileSharingReason string   `json:"fileSharingReason"`
	LastSeen          string   `json:"lastSeen"`
	LastHandshake     string   `json:"lastHandshake"`
	KeyExpiry         string   `json:"keyExpiry"`
	RxBytes           string   `json:"rxBytes"`
	TxBytes           string   `json:"txBytes"`
}

type Profile struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Tailnet  string `json:"tailnet"`
	Account  string `json:"account"`
	Selected bool   `json:"selected"`
}
type Snapshot struct {
	Available  bool      `json:"available"`
	Path       string    `json:"path"`
	ObservedAt string    `json:"observedAt"`
	Revision   string    `json:"revision"`
	Version    string    `json:"version"`
	State      string    `json:"state"`
	Tailnet    string    `json:"tailnet"`
	MagicDNS   string    `json:"magicDNS"`
	Self       *Peer     `json:"self"`
	Peers      []Peer    `json:"peers"`
	Profiles   []Profile `json:"profiles"`
	Warnings   []string  `json:"warnings"`
}

// Ignore provider extensions and secrets, including keys, AuthURL, CapMap and user photos.
type rawPeer struct {
	ID, HostName, DNSName, OS, CurAddr, Relay, PeerRelay, NoFileSharingReason string
	TailscaleIPs, AllowedIPs                                                  []string
	Online                                                                    *bool
	Active, ExitNode, ExitNodeOption                                          bool
	TaildropTarget                                                            int
	LastSeen, LastHandshake, KeyExpiry                                        string
	RxBytes, TxBytes                                                          uint64
}
type rawStatus struct {
	Version, BackendState, MagicDNSSuffix string
	CurrentTailnet                        *struct{ Name string }
	Self                                  *rawPeer
	Peer                                  map[string]*rawPeer
	Health                                []string
}

func text(value string, limit int) string {
	value = strings.TrimSpace(strings.ToValidUTF8(value, ""))
	if len(value) > limit {
		value = value[:limit]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}

func normalizePeer(raw *rawPeer) Peer {
	peer := Peer{
		ID: text(raw.ID, 128), Name: text(raw.HostName, 253),
		DNSName: strings.TrimSuffix(text(raw.DNSName, 253), "."), OS: text(raw.OS, 32),
		IPs: []string{}, Routes: []string{}, Online: raw.Online, Active: raw.Active,
		ExitNode: raw.ExitNode, ExitNodeOption: raw.ExitNodeOption, Relay: text(raw.Relay, 64),
		FileSharingReason: text(raw.NoFileSharingReason, 512),
		LastSeen:          observedTime(raw.LastSeen), LastHandshake: observedTime(raw.LastHandshake),
		KeyExpiry: observedTime(raw.KeyExpiry),
		RxBytes:   strconv.FormatUint(raw.RxBytes, 10), TxBytes: strconv.FormatUint(raw.TxBytes, 10),
	}
	for _, value := range raw.TailscaleIPs {
		if addr, err := netip.ParseAddr(value); err == nil && addr.Zone() == "" && !addr.IsUnspecified() && !addr.IsMulticast() {
			peer.IPs = append(peer.IPs, addr.Unmap().String())
			if len(peer.IPs) == 16 {
				break
			}
		}
	}
	for _, value := range raw.AllowedIPs {
		if prefix, err := netip.ParsePrefix(value); err == nil {
			own := false
			for _, ip := range peer.IPs {
				if prefix.IsSingleIP() && prefix.Addr().String() == ip {
					own = true
				}
			}
			if !own {
				peer.Routes = append(peer.Routes, prefix.Masked().String())
			}
			if len(peer.Routes) == 128 {
				break
			}
		}
	}
	if peer.Name == "" {
		peer.Name = peer.DNSName
	}
	if peer.Name == "" && len(peer.IPs) > 0 {
		peer.Name = peer.IPs[0]
	}
	if peer.Name == "" {
		peer.Name = "Unknown device"
	}
	if peer.ID == "" && len(peer.IPs) > 0 {
		peer.ID = peer.IPs[0]
	}
	peer.Connection = "idle"
	if raw.Active {
		peer.Connection = "unknown"
		if raw.CurAddr != "" {
			peer.Connection, peer.Endpoint = "direct", text(raw.CurAddr, 256)
		} else if raw.PeerRelay != "" {
			peer.Connection, peer.Endpoint = "peer relay", text(raw.PeerRelay, 256)
		} else if raw.Relay != "" {
			peer.Connection = "DERP relay"
		}
	}
	// Upstream enum: Available=1. Values 2..9 are reasons it is unavailable.
	peer.TaildropAvailable = raw.TaildropTarget == 1 && raw.Online != nil && *raw.Online && raw.NoFileSharingReason == ""
	return peer
}

func parseStatus(data []byte) (Snapshot, error) {
	result := Snapshot{Peers: []Peer{}, Profiles: []Profile{}, Warnings: []string{}, State: "Unknown"}
	if len(data) > maxOutput || strings.TrimSpace(string(data)) == "null" {
		return result, errors.New("tailscale returned an invalid status document")
	}
	var raw rawStatus
	if err := json.Unmarshal(data, &raw); err != nil {
		return result, errors.New("tailscale returned malformed status JSON")
	}
	result.Version, result.MagicDNS = text(raw.Version, 128), text(raw.MagicDNSSuffix, 253)
	if raw.BackendState != "" {
		result.State = text(raw.BackendState, 64)
	}
	if raw.CurrentTailnet != nil {
		result.Tailnet = text(raw.CurrentTailnet.Name, 253)
	}
	if raw.Self != nil {
		self := normalizePeer(raw.Self)
		result.Self = &self
	}
	for _, warning := range raw.Health {
		result.Warnings = append(result.Warnings, text(warning, 1024))
		if len(result.Warnings) == 32 {
			break
		}
	}
	keys := make([]string, 0, len(raw.Peer))
	for key := range raw.Peer {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if raw.Peer[key] == nil {
			continue
		}
		if len(result.Peers) == 1024 {
			result.Warnings = append(result.Warnings, "Peer list limited to 1,024 devices.")
			break
		}
		peer := normalizePeer(raw.Peer[key])
		if peer.ID == "" {
			digest := sha256.Sum256([]byte(key))
			peer.ID = "unknown-" + hex.EncodeToString(digest[:8])
		}
		result.Peers = append(result.Peers, peer)
	}
	sort.SliceStable(result.Peers, func(i, j int) bool {
		onlineI := result.Peers[i].Online != nil && *result.Peers[i].Online
		onlineJ := result.Peers[j].Online != nil && *result.Peers[j].Online
		if onlineI != onlineJ {
			return onlineI
		}
		return strings.ToLower(result.Peers[i].Name) < strings.ToLower(result.Peers[j].Name)
	})
	return result, nil
}

func observedTime(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.IsZero() {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

func (service *Service) Inspect(parent context.Context) (Snapshot, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	path, err := service.Find()
	if err != nil {
		return Snapshot{State: "Unavailable", Peers: []Peer{}, Profiles: []Profile{}, Warnings: []string{err.Error()}, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil
	}
	data, err := service.Run(ctx, path, "status", "--json")
	if err != nil {
		return Snapshot{}, err
	}
	result, err := parseStatus(data)
	if err != nil {
		return result, err
	}
	result.Available, result.Path = true, path
	profiles, profileErr := service.Run(ctx, path, "switch", "--list", "--json")
	if profileErr != nil {
		result.Warnings = append(result.Warnings, "Account list unavailable: "+text(profileErr.Error(), 512))
	} else if err := json.Unmarshal(profiles, &result.Profiles); err != nil {
		result.Profiles = []Profile{}
		result.Warnings = append(result.Warnings, "The installed client returned an unsupported account list.")
	}
	if len(result.Profiles) > 64 {
		result.Profiles = result.Profiles[:64]
		result.Warnings = append(result.Warnings, "Account list limited to 64 entries.")
	}
	if result.Profiles == nil {
		result.Profiles = []Profile{}
	}
	for i := range result.Profiles {
		profile := &result.Profiles[i]
		profile.ID = text(profile.ID, 128)
		profile.Nickname = text(profile.Nickname, 253)
		profile.Tailnet = text(profile.Tailnet, 253)
		profile.Account = text(profile.Account, 253)
	}
	result.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	// Ignore volatile traffic counters and handshake times when checking control changes.
	control := struct {
		State, Self, Tailnet string
		Profiles             []Profile
		Exits                []string
	}{State: result.State, Tailnet: result.Tailnet, Profiles: result.Profiles}
	if result.Self != nil {
		control.Self = result.Self.ID
	}
	for _, peer := range result.Peers {
		if peer.ExitNode {
			control.Exits = append(control.Exits, peer.ID)
		}
	}
	encoded, _ := json.Marshal(control)
	digest := sha256.Sum256(encoded)
	result.Revision = hex.EncodeToString(digest[:])
	return result, nil
}
