// Package thispc provides explicit, bounded observations of the local runtime
// environment visible to the ProtoPeek process. It never shells out, elevates,
// or starts background work.
package thispc

import "time"

const (
	SchemaVersion = 1
	Scope         = "process-network-namespace"

	ScopeNotice         = "Network interfaces and sockets are observed from the network and process namespaces visible to the ProtoPeek process. In a container or sandbox, this is not necessarily the physical host."
	LocalListenerNotice = "A local listener only means a socket is bound in the process-visible network namespace. It does not prove firewall, NAT, routing, or Internet reachability."
)

const (
	maxSockets         = 4096
	maxProcesses       = 512
	maxFileDescriptors = 16384
	activityWallTimeMS = 2000
)

// Capability describes whether one explicit observation is available on the
// current operating system. Capability inspection itself performs no I/O.
type Capability struct {
	Supported bool   `json:"supported"`
	Reason    string `json:"reason,omitempty"`
}

type ActivityCapability struct {
	Capability
	RequiresAcknowledgement bool `json:"requiresAcknowledgement"`
}

type TrafficCapability struct {
	Capability
	DurationsMS []int `json:"durationsMs"`
}

type PublicIdentityCapability struct {
	Capability
	RequiresAcknowledgement bool   `json:"requiresAcknowledgement"`
	Provider                string `json:"provider"`
	BGPOriginProvider       string `json:"bgpOriginProvider"`
	DNSResolverDisclosure   string `json:"dnsResolverDisclosure"`
}

type Capabilities struct {
	SchemaVersion  int                      `json:"schemaVersion"`
	Scope          string                   `json:"scope"`
	ScopeNotice    string                   `json:"scopeNotice"`
	Snapshot       Capability               `json:"snapshot"`
	Activity       ActivityCapability       `json:"activity"`
	TrafficSample  TrafficCapability        `json:"trafficSample"`
	PublicIdentity PublicIdentityCapability `json:"publicIdentity"`
}

type InterfaceCounters struct {
	ReceivedBytes      string `json:"receivedBytes"`
	ReceivedPackets    string `json:"receivedPackets"`
	ReceivedErrors     string `json:"receivedErrors"`
	ReceivedDropped    string `json:"receivedDropped"`
	TransmittedBytes   string `json:"transmittedBytes"`
	TransmittedPackets string `json:"transmittedPackets"`
	TransmittedErrors  string `json:"transmittedErrors"`
	TransmittedDropped string `json:"transmittedDropped"`
}

type InterfaceAddress struct {
	Address string `json:"address"`
	Prefix  int    `json:"prefix"`
	Family  string `json:"family"`
	Scope   string `json:"scope"`
}

type InterfaceSnapshot struct {
	Index     int                `json:"index"`
	Name      string             `json:"name"`
	MTU       int                `json:"mtu"`
	Flags     []string           `json:"flags"`
	Addresses []InterfaceAddress `json:"addresses"`
	Traffic   *InterfaceCounters `json:"traffic,omitempty"`
}

type LinuxSystemSnapshot struct {
	KernelRelease        string `json:"kernelRelease,omitempty"`
	UptimeSeconds        string `json:"uptimeSeconds,omitempty"`
	TotalMemoryBytes     string `json:"totalMemoryBytes,omitempty"`
	AvailableMemoryBytes string `json:"availableMemoryBytes,omitempty"`
}

type Snapshot struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Status        string               `json:"status"`
	Scope         string               `json:"scope"`
	ScopeNotice   string               `json:"scopeNotice"`
	ObservedAt    time.Time            `json:"observedAt"`
	Hostname      string               `json:"hostname,omitempty"`
	OS            string               `json:"os"`
	Arch          string               `json:"arch"`
	LogicalCPUs   int                  `json:"logicalCpus"`
	LinuxSystem   *LinuxSystemSnapshot `json:"linuxSystem,omitempty"`
	Interfaces    []InterfaceSnapshot  `json:"interfaces"`
	Notes         []string             `json:"notes"`
}

type Endpoint struct {
	Address  string `json:"address"`
	Port     uint16 `json:"port"`
	Wildcard bool   `json:"wildcard"`
}

type ProcessAttribution struct {
	PID  int    `json:"pid"`
	Comm string `json:"comm"`
}

type Socket struct {
	Protocol        string               `json:"protocol"`
	State           string               `json:"state"`
	Local           Endpoint             `json:"local"`
	Remote          Endpoint             `json:"remote"`
	Exposure        string               `json:"exposure"`
	OwnerStatus     string               `json:"ownerStatus"`
	Processes       []ProcessAttribution `json:"processes"`
	OwnersTruncated bool                 `json:"ownersTruncated,omitempty"`
	inode           uint64
}

type ActivityLimits struct {
	MaxSockets         int `json:"maxSockets"`
	MaxProcesses       int `json:"maxProcesses"`
	MaxFileDescriptors int `json:"maxFileDescriptors"`
	WallTimeMS         int `json:"wallTimeMs"`
}

type Activity struct {
	SchemaVersion int            `json:"schemaVersion"`
	Status        string         `json:"status"`
	Scope         string         `json:"scope"`
	ScopeNotice   string         `json:"scopeNotice"`
	ObservedAt    time.Time      `json:"observedAt"`
	Listeners     []Socket       `json:"listeners"`
	Connections   []Socket       `json:"connections"`
	Truncated     bool           `json:"truncated"`
	Limits        ActivityLimits `json:"limits"`
	Notes         []string       `json:"notes"`
}

type InterfaceTrafficSample struct {
	Name               string  `json:"name"`
	Status             string  `json:"status"`
	ReceivedBytes      *string `json:"receivedBytes,omitempty"`
	ReceivedPackets    *string `json:"receivedPackets,omitempty"`
	ReceivedErrors     *string `json:"receivedErrors,omitempty"`
	ReceivedDropped    *string `json:"receivedDropped,omitempty"`
	TransmittedBytes   *string `json:"transmittedBytes,omitempty"`
	TransmittedPackets *string `json:"transmittedPackets,omitempty"`
	TransmittedErrors  *string `json:"transmittedErrors,omitempty"`
	TransmittedDropped *string `json:"transmittedDropped,omitempty"`
}

type TrafficSample struct {
	SchemaVersion int       `json:"schemaVersion"`
	Scope         string    `json:"scope"`
	ScopeNotice   string    `json:"scopeNotice"`
	StartedAt     time.Time `json:"startedAt"`
	FinishedAt    time.Time `json:"finishedAt"`
	// DurationMS is the measured interval between the representative counter
	// observation times, not merely the requested wait between counter reads.
	DurationMS int                      `json:"durationMs"`
	Interfaces []InterfaceTrafficSample `json:"interfaces"`
	Notes      []string                 `json:"notes"`
}

type BGPOriginNetwork struct {
	Label    string `json:"label"`
	Evidence string `json:"evidence"`
	Provider string `json:"provider"`
	ASN      string `json:"asn"`
	Prefix   string `json:"prefix"`
	Name     string `json:"name,omitempty"`
}

type PublicFamilyResult struct {
	Family           string            `json:"family"`
	Status           string            `json:"status"`
	Address          string            `json:"address,omitempty"`
	Error            string            `json:"error,omitempty"`
	BGPOriginStatus  string            `json:"bgpOriginStatus"`
	BGPOriginError   string            `json:"bgpOriginError,omitempty"`
	BGPOriginNetwork *BGPOriginNetwork `json:"bgpOriginNetwork,omitempty"`
}

type PublicIdentity struct {
	SchemaVersion             int                  `json:"schemaVersion"`
	ObservedAt                time.Time            `json:"observedAt"`
	Provider                  string               `json:"provider"`
	ExternalRequestDisclosure string               `json:"externalRequestDisclosure"`
	DNSResolverDisclosure     string               `json:"dnsResolverDisclosure"`
	Families                  []PublicFamilyResult `json:"families"`
}
