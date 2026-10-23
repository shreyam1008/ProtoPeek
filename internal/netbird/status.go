package netbird

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Endpoint struct {
	URL       string `json:"url"`
	Connected *bool  `json:"connected"`
	HasError  bool   `json:"hasError"`
}
type ICE struct {
	Local  string `json:"local"`
	Remote string `json:"remote"`
}
type Peer struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	IPs            []string `json:"ips"`
	State          string   `json:"state"`
	ConnectionType string   `json:"connectionType"`
	ICE            ICE      `json:"ice"`
	Endpoints      ICE      `json:"endpoints"`
	Relay          string   `json:"relay"`
	LatencyMS      *float64 `json:"latencyMs"`
	Received       string   `json:"received"`
	Sent           string   `json:"sent"`
	Networks       []string `json:"networks"`
}
type Relay struct {
	URI       string `json:"uri"`
	Available *bool  `json:"available"`
	Transport string `json:"transport"`
	HasError  bool   `json:"hasError"`
}
type DNSGroup struct {
	Servers  []string `json:"servers"`
	Domains  []string `json:"domains"`
	Enabled  *bool    `json:"enabled"`
	HasError bool     `json:"hasError"`
}
type Snapshot struct {
	Available         bool       `json:"available"`
	Path              string     `json:"path"`
	ObservedAt        string     `json:"observedAt"`
	Revision          string     `json:"revision"`
	CLIVersion        string     `json:"cliVersion"`
	DaemonVersion     string     `json:"daemonVersion"`
	State             string     `json:"state"`
	Profile           string     `json:"profile"`
	IPs               []string   `json:"ips"`
	FQDN              string     `json:"fqdn"`
	Management        Endpoint   `json:"management"`
	Signal            Endpoint   `json:"signal"`
	Peers             []Peer     `json:"peers"`
	PeerTotal         int        `json:"peerTotal"`
	Relays            []Relay    `json:"relays"`
	DNS               []DNSGroup `json:"dns"`
	Warnings          []string   `json:"warnings"`
	ConnectAllowed    bool       `json:"connectAllowed"`
	DisconnectAllowed bool       `json:"disconnectAllowed"`
	ControlReason     string     `json:"controlReason"`
	Environment       []string   `json:"environment"`
	controlIdentity   string
}

// JSON shape verified against netbirdio/netbird v0.81.3 client/status/status.go.
// Unknown fields (keys, events, SSH commands and future provider facts) are not forwarded.
type rawEndpoint struct {
	URL       string `json:"url"`
	Connected *bool  `json:"connected"`
	Error     string `json:"error"`
}
type rawPeer struct {
	FQDN           string   `json:"fqdn"`
	IP             string   `json:"netbirdIp"`
	IPv6           string   `json:"netbirdIpv6"`
	Key            string   `json:"publicKey"`
	Status         string   `json:"status"`
	ConnectionType string   `json:"connectionType"`
	ICE            ICE      `json:"iceCandidateType"`
	Endpoints      ICE      `json:"iceCandidateEndpoint"`
	Relay          string   `json:"relayAddress"`
	Latency        *int64   `json:"latency"`
	Received       *int64   `json:"transferReceived"`
	Sent           *int64   `json:"transferSent"`
	Networks       []string `json:"networks"`
}
type rawStatus struct {
	CLIVersion    string      `json:"cliVersion"`
	DaemonVersion string      `json:"daemonVersion"`
	State         string      `json:"daemonStatus"`
	Profile       string      `json:"profileName"`
	IP            string      `json:"netbirdIp"`
	IPv6          string      `json:"netbirdIpv6"`
	FQDN          string      `json:"fqdn"`
	Key           string      `json:"publicKey"`
	Management    rawEndpoint `json:"management"`
	Signal        rawEndpoint `json:"signal"`
	Peers         struct {
		Total   int       `json:"total"`
		Details []rawPeer `json:"details"`
	} `json:"peers"`
	Relays struct {
		Details []struct {
			URI       string `json:"uri"`
			Available *bool  `json:"available"`
			Transport string `json:"transport"`
			Error     string `json:"error"`
		} `json:"details"`
	} `json:"relays"`
	DNS []struct {
		Servers []string `json:"servers"`
		Domains []string `json:"domains"`
		Enabled *bool    `json:"enabled"`
		Error   string   `json:"error"`
	} `json:"dnsServers"`
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
func authority(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}
func addresses(values ...string) []string {
	result := []string{}
	for _, value := range values {
		address, err := netip.ParseAddr(strings.Split(value, "/")[0])
		if err == nil && address.Zone() == "" && !address.IsUnspecified() && !address.IsMulticast() {
			result = append(result, address.Unmap().String())
		}
	}
	return result
}
func boundedStrings(values []string, maximum int) []string {
	result := []string{}
	for _, value := range values {
		result = append(result, text(value, 253))
		if len(result) == maximum {
			break
		}
	}
	return result
}
func stableVersion(value string) bool {
	value = strings.TrimPrefix(value, "v")
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return false
	}
	major, e1 := strconv.Atoi(parts[0])
	minor, e2 := strconv.Atoi(parts[1])
	patch, e3 := strconv.Atoi(parts[2])
	if e1 != nil || e2 != nil || e3 != nil || major < 0 || minor < 0 || patch < 0 {
		return false
	}
	if strconv.Itoa(major) != parts[0] || strconv.Itoa(minor) != parts[1] || strconv.Itoa(patch) != parts[2] {
		return false
	}
	return major > 0 || minor > 81 || (minor == 81 && patch >= 3)
}

func byteCount(value *int64) string {
	if value == nil || *value < 0 {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

func parseStatus(data []byte) (Snapshot, error) {
	result := Snapshot{State: "Unknown", Peers: []Peer{}, Relays: []Relay{}, DNS: []DNSGroup{}, IPs: []string{}, Warnings: []string{}, Environment: []string{}}
	if len(data) > maxOutput || strings.TrimSpace(string(data)) == "null" {
		return result, errors.New("NetBird returned an invalid status document")
	}
	var raw rawStatus
	if json.Unmarshal(data, &raw) != nil {
		return result, errors.New("NetBird returned malformed status JSON")
	}
	if raw.CLIVersion == "" && raw.DaemonVersion == "" && raw.State == "" {
		return result, errors.New("The installed NetBird status format is unsupported")
	}
	result.CLIVersion, result.DaemonVersion = text(raw.CLIVersion, 128), text(raw.DaemonVersion, 128)
	result.Profile, result.FQDN = text(raw.Profile, 128), text(raw.FQDN, 253)
	if raw.State != "" {
		result.State = text(raw.State, 64)
	}
	result.IPs = addresses(raw.IP, raw.IPv6)
	result.Management = Endpoint{URL: authority(raw.Management.URL), Connected: raw.Management.Connected, HasError: raw.Management.Error != ""}
	result.Signal = Endpoint{URL: authority(raw.Signal.URL), Connected: raw.Signal.Connected, HasError: raw.Signal.Error != ""}
	identity := sha256.Sum256([]byte(raw.Management.URL + "\x00" + raw.Signal.URL + "\x00" + raw.Key))
	result.controlIdentity = hex.EncodeToString(identity[:])
	result.PeerTotal = max(raw.Peers.Total, len(raw.Peers.Details))
	for _, peer := range raw.Peers.Details {
		if len(result.Peers) == 512 {
			result.Warnings = append(result.Warnings, "Peer list limited to 512 observations.")
			break
		}
		digest := sha256.Sum256([]byte(peer.Key + "\x00" + peer.FQDN + "\x00" + peer.IP))
		item := Peer{ID: hex.EncodeToString(digest[:16]), Name: text(peer.FQDN, 253), IPs: addresses(peer.IP, peer.IPv6), State: text(peer.Status, 64), ConnectionType: text(peer.ConnectionType, 64), ICE: ICE{Local: text(peer.ICE.Local, 64), Remote: text(peer.ICE.Remote, 64)}, Endpoints: ICE{Local: text(peer.Endpoints.Local, 256), Remote: text(peer.Endpoints.Remote, 256)}, Relay: authority(peer.Relay), Received: byteCount(peer.Received), Sent: byteCount(peer.Sent), Networks: boundedStrings(peer.Networks, 64)}
		if peer.Latency != nil && *peer.Latency >= 0 {
			ms := float64(*peer.Latency) / float64(time.Millisecond)
			item.LatencyMS = &ms
		}
		result.Peers = append(result.Peers, item)
	}
	for _, relay := range raw.Relays.Details {
		if len(result.Relays) == 64 {
			result.Warnings = append(result.Warnings, "Relay list limited to 64 observations.")
			break
		}
		result.Relays = append(result.Relays, Relay{URI: authority(relay.URI), Available: relay.Available, Transport: text(relay.Transport, 64), HasError: relay.Error != ""})
	}
	for _, group := range raw.DNS {
		if len(result.DNS) == 64 {
			result.Warnings = append(result.Warnings, "DNS list limited to 64 groups.")
			break
		}
		result.DNS = append(result.DNS, DNSGroup{Servers: boundedStrings(group.Servers, 16), Domains: boundedStrings(group.Domains, 32), Enabled: group.Enabled, HasError: group.Error != ""})
	}
	result.DisconnectAllowed = result.State == "Connected" || result.State == "Connecting"
	result.ConnectAllowed = result.State == "Idle" && result.Profile != "" && stableVersion(result.CLIVersion) && stableVersion(result.DaemonVersion)
	if !result.ConnectAllowed && !result.DisconnectAllowed {
		result.ControlReason = "Sign in using the installed NetBird app. Reconnect requires an observed saved profile and CLI/daemon 0.81.3+; other status formats remain read-only."
	}
	return result, nil
}

func (service *Service) Inspect(parent context.Context) (Snapshot, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	path, err := service.Find()
	if err != nil {
		return Snapshot{State: "Unavailable", Warnings: []string{"NetBird CLI was not found. Install the official client and inspect again."}, Peers: []Peer{}, Relays: []Relay{}, DNS: []DNSGroup{}, IPs: []string{}, Environment: []string{}, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil
	}
	data, err := service.Run(ctx, path, "status", "--json")
	if err != nil {
		return Snapshot{}, errors.New("NetBird status could not be read. Check the installed daemon and permissions")
	}
	result, err := parseStatus(data)
	if err != nil {
		return result, err
	}
	result.Available, result.Path = true, path
	if service.Environment != nil {
		_, result.Environment = cleanEnvironment(service.Environment())
		if result.Environment == nil {
			result.Environment = []string{}
		}
	}
	if len(result.Environment) > 0 {
		result.ConnectAllowed, result.DisconnectAllowed = false, false
		result.ControlReason = "NB_* or WT_* environment overrides are present. This snapshot uses the default local daemon with overrides excluded. Restart ProtoPeek without these variables before controlling NetBird."
	}
	control := struct {
		Path, CLI, Daemon, State, Profile, Management, Identity string
		IPs, Environment                                        []string
	}{path, result.CLIVersion, result.DaemonVersion, result.State, result.Profile, result.Management.URL, result.controlIdentity, result.IPs, result.Environment}
	encoded, _ := json.Marshal(control)
	digest := sha256.Sum256(encoded)
	result.Revision, result.ObservedAt = hex.EncodeToString(digest[:]), time.Now().UTC().Format(time.RFC3339Nano)
	return result, nil
}
