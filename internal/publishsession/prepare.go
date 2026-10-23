package publishsession

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type prepared struct {
	request     Request
	path        string
	args        []string
	audience    string
	endpoint    string
	fingerprint string
	origin      OriginObservation
}

func normalize(input Request) (Request, error) {
	if input.Mode != "quick" && input.Mode != "serve" && input.Mode != "funnel" {
		return input, publicError("choose Quick Tunnel, private Serve or public Funnel")
	}
	if input.Minutes < 1 || input.Minutes > 60 {
		return input, publicError("choose a session duration of 1–60 minutes")
	}
	if len(input.Origin) > 2048 || strings.ContainsAny(input.Origin, "\r\n\t\\") {
		return input, publicError("enter one local HTTP or verified HTTPS origin")
	}
	u, err := url.Parse(input.Origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return input, publicError("origin must be a loopback HTTP(S) URL without credentials, query or fragment")
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		host = "127.0.0.1"
	}
	ip, err := netip.ParseAddr(host)
	port, portErr := strconv.ParseUint(u.Port(), 10, 16)
	if err != nil || !ip.IsLoopback() || ip.Zone() != "" || portErr != nil || port == 0 {
		return input, publicError("use a loopback address and explicit port, such as http://127.0.0.1:3000")
	}
	u.Host = net.JoinHostPort(ip.String(), strconv.Itoa(int(port)))
	input.Origin = u.String()
	if input.Mode == "quick" {
		if input.Port != 0 {
			return input, publicError("Quick Tunnel chooses its public endpoint")
		}
	} else if input.Port != 443 && input.Port != 8443 && input.Port != 10000 {
		return input, publicError("choose HTTPS port 443, 8443 or 10000")
	}
	return input, nil
}

func probeOrigin(ctx context.Context, origin string) OriginObservation {
	u, _ := url.Parse(origin)
	started := time.Now()
	connection, err := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "tcp", u.Host)
	if err == nil {
		_ = connection.Close()
	}
	return OriginObservation{Connected: err == nil, DurationMs: time.Since(started).Milliseconds()}
}

// Only an empty config is eligible. Unknown fields or any existing foreground,
// service, Web, TCP or Funnel config are refused instead of merged or deleted.
func emptyConfig(raw []byte) bool {
	if len(raw) > 256<<10 {
		return false
	}
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	for key, item := range value {
		switch key {
		case "TCP", "Web", "Services", "AllowFunnel", "Foreground":
		default:
			return false
		}
		var entries map[string]json.RawMessage
		if json.Unmarshal(item, &entries) != nil || len(entries) != 0 {
			return false
		}
	}
	return true
}

func allowedPort(caps map[string]json.RawMessage, port uint16) bool {
	for key := range caps {
		u, err := url.Parse(key)
		if err != nil || u.Scheme != "https" || u.Host != "tailscale.com" || u.Path != "/cap/funnel-ports" {
			continue
		}
		for part := range strings.SplitSeq(u.Query().Get("ports"), ",") {
			first, last, span := strings.Cut(part, "-")
			lo, err := strconv.ParseUint(first, 10, 16)
			if err != nil {
				continue
			}
			hi := lo
			if span {
				hi, err = strconv.ParseUint(last, 10, 16)
			}
			if err == nil && uint64(port) >= lo && uint64(port) <= hi {
				return true
			}
		}
	}
	return false
}

func (s *Supervisor) prepare(parent context.Context, input Request) (prepared, error) {
	result := prepared{}
	input, err := normalize(input)
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	tool := "tailscale"
	if input.Mode == "quick" {
		tool = "cloudflared"
	}
	path, err := s.find(tool)
	if err != nil {
		if _, safe := PublicErrorMessage(err); safe {
			return result, err
		}
		return result, publicError(tool + " is unavailable; install the official client and review again")
	}
	result = prepared{request: input, path: path, audience: "private tailnet"}
	identity := ""
	if input.Mode == "quick" {
		result.audience = "public internet"
		// A private empty config plus a filtered environment prevents an ambient
		// named-tunnel token/config from changing the reviewed temporary mode.
		result.args = []string{"tunnel", "--config", "<private empty config>", "--no-autoupdate", "--url", input.Origin, "--logformat", "json", "--metrics", "127.0.0.1:0"}
	} else {
		raw, err := s.run(ctx, path, "status", "--json", "--peers=false")
		if err != nil || len(raw) > 4<<20 {
			return result, publicError("cannot observe installed Tailscale state; inspect its daemon and account first")
		}
		var status struct {
			Version      string
			BackendState string
			CertDomains  []string
			Self         *struct {
				ID      string
				DNSName string
				CapMap  map[string]json.RawMessage
			}
		}
		if json.Unmarshal(raw, &status) != nil || status.BackendState != "Running" || status.Self == nil {
			return result, publicError("Tailscale must already be running and signed in; no account changes are made here")
		}
		name := strings.TrimSuffix(status.Self.DNSName, ".")
		if len(name) == 0 || len(name) > 253 || strings.ContainsAny(name, "/:@?#\\\r\n\t ") {
			return result, publicError("the installed client did not report a usable HTTPS name")
		}
		if _, ok := status.Self.CapMap["https"]; !ok {
			return result, publicError("enable HTTPS using the native Tailscale client first; this page does not enable account features")
		}
		cert := false
		for _, domain := range status.CertDomains {
			if strings.TrimSuffix(domain, ".") == name {
				cert = true
			}
		}
		if !cert {
			return result, publicError("the installed client has not reported an enabled certificate domain for this device")
		}
		if input.Mode == "funnel" {
			_, capable := status.Self.CapMap["funnel"]
			// Pinned1.102.4 also checks443 before parsing the selected HTTPS port.
			if !capable || !allowedPort(status.Self.CapMap, 443) || !allowedPort(status.Self.CapMap, input.Port) {
				return result, publicError("Funnel and its allowed HTTPS ports must already be enabled in native Tailscale policy")
			}
			result.audience = "public internet"
		}
		config, err := s.run(ctx, path, "serve", "status", "--json")
		if err != nil || !emptyConfig(config) {
			return result, publicError("existing or unknown Serve/Funnel configuration was found; it is preserved; resolve it in the native client first")
		}
		result.endpoint = "https://" + name
		if input.Port != 443 {
			result.endpoint += ":" + strconv.Itoa(int(input.Port))
		}
		result.args = []string{input.Mode, "--https=" + strconv.Itoa(int(input.Port)), input.Origin}
		data, _ := json.Marshal([]any{status.Version, status.Self.ID, name, status.CertDomains, status.Self.CapMap})
		identity = string(data)
	}
	result.origin = s.probe(ctx, input.Origin)
	data, _ := json.Marshal([]any{input, path, result.args, identity, result.origin.Connected})
	digest := sha256.Sum256(data)
	result.fingerprint = hex.EncodeToString(digest[:])
	if ctx.Err() != nil {
		return result, publicError("publishing preflight timed out or was cancelled")
	}
	return result, nil
}
