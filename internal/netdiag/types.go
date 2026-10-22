// Package netdiag provides explicitly started, bounded single-target diagnostics.
// It does not schedule background work or change host/provider configuration.
package netdiag

import (
	"context"
	"crypto/x509"
	"net"
	"net/netip"
	"time"
)

const (
	MaxAddresses    = 8
	MaxRecords      = 64
	MaxPayloadBytes = 4096
	MaxReplyBytes   = 64 << 10
	MaxDuration     = 15 * time.Second
)

type Request struct {
	Mode          string   `json:"mode"`
	Target        string   `json:"target"`
	TimeoutMS     int      `json:"timeoutMs"`
	RecordType    string   `json:"recordType"`
	Resolver      string   `json:"resolver"`
	ServerName    string   `json:"serverName"`
	ALPN          []string `json:"alpn"`
	CAPEM         string   `json:"caPem"`
	TestTLS       bool     `json:"testTls"`
	Samples       int      `json:"samples"`
	IntervalMS    int      `json:"intervalMs"`
	Payload       string   `json:"payload"`
	Encoding      string   `json:"encoding"`
	Proxy         string   `json:"proxy"`
	ProxyUsername string   `json:"proxyUsername"`
	ProxyPassword string   `json:"proxyPassword"`
}

// Result deliberately excludes the original request, credentials and CA input.
// Raw response bytes exist only in Exchange and require an explicit exchange.
type Result struct {
	Mode       string           `json:"mode"`
	Target     string           `json:"target"`
	ObservedAt string           `json:"observedAt"`
	DurationMS float64          `json:"durationMs"`
	Complete   bool             `json:"complete"`
	Summary    string           `json:"summary"`
	Outcome    string           `json:"outcome"`
	Addresses  []string         `json:"addresses"`
	Checks     []Check          `json:"checks"`
	DNS        []DNSObservation `json:"dns"`
	TLS        *TLSEvidence     `json:"tls,omitempty"`
	Samples    []Check          `json:"samples"`
	Statistics *Statistics      `json:"statistics,omitempty"`
	Exchange   *Exchange        `json:"exchange,omitempty"`
	Proxy      *ProxyEvidence   `json:"proxy,omitempty"`
	HTTP2      *HTTP2Evidence   `json:"http2,omitempty"`
	HTTP3      *HTTP3Evidence   `json:"http3,omitempty"`
	Subnet     *SubnetEvidence  `json:"subnet,omitempty"`
	Comparison string           `json:"comparison,omitempty"`
	Warnings   []string         `json:"warnings"`
}

type Check struct {
	Stage      string  `json:"stage"`
	Address    string  `json:"address"`
	Local      string  `json:"local,omitempty"`
	Outcome    string  `json:"outcome"`
	DurationMS float64 `json:"durationMs"`
	Detail     string  `json:"detail,omitempty"`
}

type DNSRecord struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Value      string  `json:"value"`
	TTLSeconds *uint32 `json:"ttlSeconds,omitempty"`
}

type DNSObservation struct {
	Resolver      string      `json:"resolver"`
	Transport     string      `json:"transport"`
	Question      string      `json:"question"`
	RecordType    string      `json:"recordType"`
	Outcome       string      `json:"outcome"`
	ResponseCode  string      `json:"responseCode,omitempty"`
	Authoritative bool        `json:"authoritative"`
	Records       []DNSRecord `json:"records"`
	Limited       bool        `json:"limited"`
	DurationMS    float64     `json:"durationMs"`
	Detail        string      `json:"detail,omitempty"`
}

type Certificate struct {
	Limited     bool     `json:"limited"`
	Subject     string   `json:"subject"`
	Issuer      string   `json:"issuer"`
	DNSNames    []string `json:"dnsNames"`
	IPAddresses []string `json:"ipAddresses"`
	NotBefore   string   `json:"notBefore"`
	NotAfter    string   `json:"notAfter"`
	SHA256      string   `json:"sha256"`
	Serial      string   `json:"serial"`
}

type TLSEvidence struct {
	Limited       bool          `json:"limited"`
	Address       string        `json:"address"`
	ServerName    string        `json:"serverName"`
	Version       string        `json:"version"`
	Cipher        string        `json:"cipher"`
	ALPN          string        `json:"alpn"`
	Verified      bool          `json:"verified"`
	Verifier      string        `json:"verifier"`
	VerifyError   string        `json:"verifyError,omitempty"`
	ReceivedChain []Certificate `json:"receivedChain"`
	VerifiedChain []Certificate `json:"verifiedChain"`
	DurationMS    float64       `json:"durationMs"`
}

type Statistics struct {
	Requested int      `json:"requested"`
	Completed int      `json:"completed"`
	Connected int      `json:"connected"`
	Refused   int      `json:"refused"`
	Timeouts  int      `json:"timeouts"`
	MinMS     *float64 `json:"minMs,omitempty"`
	MedianMS  *float64 `json:"medianMs,omitempty"`
	P95MS     *float64 `json:"p95Ms,omitempty"`
}

type Exchange struct {
	Protocol      string `json:"protocol"`
	SentBytes     int    `json:"sentBytes"`
	ReceivedBytes int    `json:"receivedBytes"`
	ReplyHex      string `json:"replyHex"`
	ReplyText     string `json:"replyText"`
	Limited       bool   `json:"limited"`
	Outcome       string `json:"outcome"`
	Detail        string `json:"detail,omitempty"`
}

type ProxyEvidence struct {
	Protocol    string `json:"protocol"`
	Address     string `json:"address"`
	Destination string `json:"destination"`
	Resolution  string `json:"resolution"`
	Outcome     string `json:"outcome"`
	Status      int    `json:"status"`
	Detail      string `json:"detail"`
}

type HTTP2Evidence struct {
	Protocol string   `json:"protocol"`
	Settings []string `json:"settings"`
	PingAck  bool     `json:"pingAck"`
	Detail   string   `json:"detail"`
}

type HTTP3Evidence struct {
	Address     string  `json:"address"`
	Local       string  `json:"local"`
	QUICVersion string  `json:"quicVersion"`
	TLSVersion  string  `json:"tlsVersion"`
	ALPN        string  `json:"alpn"`
	Status      int     `json:"status"`
	HandshakeMS float64 `json:"handshakeMs"`
	Detail      string  `json:"detail"`
}

type SubnetEvidence struct {
	Prefix            string `json:"prefix"`
	Family            string `json:"family"`
	Network           string `json:"network"`
	First             string `json:"first"`
	Last              string `json:"last"`
	TotalAddresses    string `json:"totalAddresses"`
	UsableHosts       string `json:"usableHosts"`
	FirstUsable       string `json:"firstUsable"`
	LastUsable        string `json:"lastUsable"`
	DiscoveryEligible bool   `json:"discoveryEligible"`
	Detail            string `json:"detail"`
}

type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type Engine struct {
	Resolver Resolver
	Records  *net.Resolver
	Dial     func(context.Context, string, string) (net.Conn, error)
	Roots    *x509.CertPool
	Now      func() time.Time
}
