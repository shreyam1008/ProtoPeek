package thispc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrActivityUnsupported = errors.New("local socket activity is unsupported on this operating system")
	ErrActivityUnavailable = errors.New("local socket activity is unavailable")
	ErrTrafficUnsupported  = errors.New("traffic counters are unsupported on this operating system")
	ErrTrafficUnavailable  = errors.New("traffic counters are unavailable")
	ErrInvalidDuration     = errors.New("traffic sample duration must be exactly 500, 1000, or 2000 milliseconds")
	ErrInvalidFamily       = errors.New("public identity families must contain ipv4 or ipv6 without duplicates")
)

// MaxEncodedActivityResponseBytes is the hard JSON response ceiling for local
// socket activity, including the encoder's trailing newline.
const MaxEncodedActivityResponseBytes = 4 << 20

// MaxEncodedSnapshotResponseBytes is the hard JSON response ceiling for the
// safe local snapshot, including the encoder's trailing newline.
const MaxEncodedSnapshotResponseBytes = 1 << 20

const (
	maxSnapshotInterfaces    = 256
	maxAddressesPerInterface = 64
)

const (
	ipifyProvider = "ipify"
	cymruProvider = "Team Cymru"
	dnsDisclosure = "The configured DNS resolver can see the Team Cymru BGP origin and ASN-name lookup names."
)

type rawCounters struct {
	receivedBytes      uint64
	receivedPackets    uint64
	receivedErrors     uint64
	receivedDropped    uint64
	transmittedBytes   uint64
	transmittedPackets uint64
	transmittedErrors  uint64
	transmittedDropped uint64
}

type counterReader func(context.Context) (map[string]rawCounters, error)
type activityReader func(context.Context) (Activity, error)
type publicReader func(context.Context, []string) PublicIdentity
type systemReader func(context.Context) (*LinuxSystemSnapshot, []string)

// Service has no background work. NewService only assembles dependencies; all
// host, procfs, DNS, and HTTP I/O occurs in an explicitly invoked method.
type Service struct {
	hostname       func() (string, error)
	interfaces     func() ([]net.Interface, error)
	interfaceAddrs func(net.Interface) ([]net.Addr, error)
	now            func() time.Time
	wait           func(context.Context, time.Duration) error
	counters       counterReader
	system         systemReader
	activity       activityReader
	public         publicReader
}

// NewService constructs the local observation service without performing I/O.
func NewService() *Service {
	return &Service{
		hostname:       os.Hostname,
		interfaces:     net.Interfaces,
		interfaceAddrs: func(value net.Interface) ([]net.Addr, error) { return value.Addrs() },
		now:            time.Now,
		wait:           waitContext,
		counters:       newCounterReader(),
		system:         newSystemReader(),
		activity:       newActivityReader(),
		public:         newPublicReader(),
	}
}

func (service *Service) Capabilities(context.Context) Capabilities {
	activitySupported, activityReason := platformActivityCapability()
	trafficSupported, trafficReason := platformTrafficCapability()
	return Capabilities{
		SchemaVersion: SchemaVersion,
		Scope:         Scope,
		ScopeNotice:   ScopeNotice,
		Snapshot:      Capability{Supported: true},
		Activity: ActivityCapability{
			Capability:              Capability{Supported: activitySupported, Reason: activityReason},
			RequiresAcknowledgement: true,
		},
		TrafficSample: TrafficCapability{
			Capability:  Capability{Supported: trafficSupported, Reason: trafficReason},
			DurationsMS: []int{500, 1000, 2000},
		},
		PublicIdentity: PublicIdentityCapability{
			Capability:              Capability{Supported: true},
			RequiresAcknowledgement: true,
			Provider:                ipifyProvider,
			BGPOriginProvider:       cymruProvider,
			DNSResolverDisclosure:   dnsDisclosure,
		},
	}
}

func (service *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	result := Snapshot{
		SchemaVersion: SchemaVersion,
		Status:        "ok",
		Scope:         Scope,
		ScopeNotice:   ScopeNotice,
		ObservedAt:    service.now().UTC(),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		LogicalCPUs:   runtime.NumCPU(),
		Interfaces:    make([]InterfaceSnapshot, 0),
		Notes:         make([]string, 0),
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if hostname, err := service.hostname(); err == nil {
		result.Hostname = boundedText(hostname, 255)
	} else {
		result.Status = "partial"
		result.Notes = append(result.Notes, "hostname unavailable: "+boundedError(err))
	}
	var systemNotes []string
	result.LinuxSystem, systemNotes = service.system(ctx)
	if len(systemNotes) > 0 {
		result.Status = "partial"
		result.Notes = append(result.Notes, systemNotes...)
	}

	counters, counterErr := service.counters(ctx)
	if counterErr != nil && !errors.Is(counterErr, ErrTrafficUnsupported) {
		result.Status = "partial"
		result.Notes = append(result.Notes, "interface counters incomplete: "+boundedError(counterErr))
	}
	interfaces, err := service.interfaces()
	if err != nil {
		result.Status = "partial"
		result.Notes = append(result.Notes, "network interfaces unavailable: "+boundedError(err))
		return BoundSnapshotResponse(result), nil
	}
	sort.Slice(interfaces, func(left, right int) bool {
		if interfaces[left].Index != interfaces[right].Index {
			return interfaces[left].Index < interfaces[right].Index
		}
		return interfaces[left].Name < interfaces[right].Name
	})
	if len(interfaces) > maxSnapshotInterfaces {
		interfaces = interfaces[:maxSnapshotInterfaces]
		result.Status = "partial"
		result.Notes = append(result.Notes, "network interface list was truncated at 256 entries")
	}
	for _, value := range interfaces {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		item := InterfaceSnapshot{
			Index:     value.Index,
			Name:      boundedText(value.Name, 255),
			MTU:       value.MTU,
			Flags:     interfaceFlags(value.Flags),
			Addresses: make([]InterfaceAddress, 0),
		}
		if observed, ok := counters[value.Name]; ok {
			trafficCopy := publicCounters(observed)
			item.Traffic = &trafficCopy
		}
		addresses, addressErr := service.interfaceAddrs(value)
		if addressErr != nil {
			result.Status = "partial"
			result.Notes = append(result.Notes, fmt.Sprintf("addresses for interface %q unavailable: %s", item.Name, boundedError(addressErr)))
		} else {
			sort.Slice(addresses, func(left, right int) bool {
				return addresses[left].String() < addresses[right].String()
			})
			if len(addresses) > maxAddressesPerInterface {
				addresses = addresses[:maxAddressesPerInterface]
				result.Status = "partial"
				result.Notes = append(result.Notes, fmt.Sprintf("addresses for interface %q were truncated at 64 entries", item.Name))
			}
			invalidAddresses := 0
			var firstAddressError error
			for _, address := range addresses {
				described, describeErr := describeInterfaceAddress(address.String())
				if describeErr != nil {
					invalidAddresses++
					if firstAddressError == nil {
						firstAddressError = describeErr
					}
					continue
				}
				item.Addresses = append(item.Addresses, described)
			}
			if invalidAddresses > 0 {
				result.Status = "partial"
				result.Notes = append(result.Notes, fmt.Sprintf("%d address entries for interface %q were not understood: %s", invalidAddresses, item.Name, boundedError(firstAddressError)))
			}
			sort.Slice(item.Addresses, func(left, right int) bool {
				if item.Addresses[left].Family != item.Addresses[right].Family {
					return item.Addresses[left].Family < item.Addresses[right].Family
				}
				return item.Addresses[left].Address < item.Addresses[right].Address
			})
		}
		result.Interfaces = append(result.Interfaces, item)
	}
	return BoundSnapshotResponse(result), nil
}

func (service *Service) Activity(ctx context.Context) (Activity, error) {
	result, err := service.activity(ctx)
	if err != nil {
		return result, err
	}
	return BoundActivityResponse(result), nil
}

func (service *Service) SampleTraffic(ctx context.Context, duration time.Duration) (TrafficSample, error) {
	if duration != 500*time.Millisecond && duration != time.Second && duration != 2*time.Second {
		return TrafficSample{}, ErrInvalidDuration
	}
	beforeReadStarted := service.now()
	before, beforeErr := service.counters(ctx)
	beforeReadFinished := service.now()
	if beforeErr != nil && (len(before) == 0 || errors.Is(beforeErr, ErrTrafficUnsupported)) {
		return TrafficSample{}, beforeErr
	}
	if err := ctx.Err(); err != nil {
		return TrafficSample{}, err
	}
	if err := service.wait(ctx, duration); err != nil {
		return TrafficSample{}, err
	}
	afterReadStarted := service.now()
	after, afterErr := service.counters(ctx)
	afterReadFinished := service.now()
	if afterErr != nil && (len(after) == 0 || errors.Is(afterErr, ErrTrafficUnsupported)) {
		return TrafficSample{}, afterErr
	}
	if err := ctx.Err(); err != nil {
		return TrafficSample{}, err
	}
	started := observationMidpoint(beforeReadStarted, beforeReadFinished)
	finished := observationMidpoint(afterReadStarted, afterReadFinished)
	measuredDuration := finished.Sub(started)
	if measuredDuration <= 0 {
		return TrafficSample{}, fmt.Errorf("traffic sample measured a non-positive observation interval")
	}
	omittedLifecycleEntries := 0
	if beforeErr != nil || afterErr != nil {
		before, after, omittedLifecycleEntries = comparableCounterReads(before, after)
		if len(before) == 0 {
			return TrafficSample{}, fmt.Errorf("%w: incomplete counter reads had no interface in common", ErrTrafficUnavailable)
		}
	}
	result := buildTrafficSample(started.UTC(), finished.UTC(), measuredDuration, before, after)
	if beforeErr != nil {
		result.Notes = append(result.Notes, "starting interface counters incomplete: "+boundedError(beforeErr))
	}
	if afterErr != nil {
		result.Notes = append(result.Notes, "finishing interface counters incomplete: "+boundedError(afterErr))
	}
	if omittedLifecycleEntries > 0 {
		result.Notes = append(result.Notes, fmt.Sprintf("%d interface lifecycle entries were omitted because one or both counter reads were incomplete", omittedLifecycleEntries))
	}
	result.Notes = deduplicateBoundedNotes(result.Notes, 64)
	return result, nil
}

func (service *Service) PublicIdentity(ctx context.Context, families []string) (PublicIdentity, error) {
	normalized, err := normalizeFamilies(families)
	if err != nil {
		return PublicIdentity{}, err
	}
	return service.public(ctx, normalized), nil
}

func normalizeFamilies(input []string) ([]string, error) {
	if len(input) < 1 || len(input) > 2 {
		return nil, ErrInvalidFamily
	}
	seen := make(map[string]struct{}, len(input))
	result := make([]string, 0, len(input))
	for _, family := range input {
		if family != "ipv4" && family != "ipv6" {
			return nil, ErrInvalidFamily
		}
		if _, exists := seen[family]; exists {
			return nil, ErrInvalidFamily
		}
		seen[family] = struct{}{}
		result = append(result, family)
	}
	return result, nil
}

func buildTrafficSample(started, finished time.Time, measuredDuration time.Duration, before, after map[string]rawCounters) TrafficSample {
	names := make(map[string]struct{}, len(before)+len(after))
	for name := range before {
		names[name] = struct{}{}
	}
	for name := range after {
		names[name] = struct{}{}
	}
	ordered := make([]string, 0, len(names))
	for name := range names {
		ordered = append(ordered, name)
	}
	sort.Strings(ordered)
	result := TrafficSample{
		SchemaVersion: SchemaVersion,
		Scope:         Scope,
		ScopeNotice:   ScopeNotice,
		StartedAt:     started,
		FinishedAt:    finished,
		DurationMS:    int(measuredDuration.Round(time.Millisecond) / time.Millisecond),
		Interfaces:    make([]InterfaceTrafficSample, 0, len(ordered)),
		Notes:         make([]string, 0),
	}
	for _, name := range ordered {
		first, hadFirst := before[name]
		second, hadSecond := after[name]
		item := InterfaceTrafficSample{Name: boundedText(name, 255)}
		switch {
		case !hadFirst:
			item.Status = "appeared"
		case !hadSecond:
			item.Status = "disappeared"
		case countersReset(first, second):
			item.Status = "counter-reset"
		default:
			item.Status = "ok"
			item.ReceivedBytes = decimalPointer(second.receivedBytes - first.receivedBytes)
			item.ReceivedPackets = decimalPointer(second.receivedPackets - first.receivedPackets)
			item.ReceivedErrors = decimalPointer(second.receivedErrors - first.receivedErrors)
			item.ReceivedDropped = decimalPointer(second.receivedDropped - first.receivedDropped)
			item.TransmittedBytes = decimalPointer(second.transmittedBytes - first.transmittedBytes)
			item.TransmittedPackets = decimalPointer(second.transmittedPackets - first.transmittedPackets)
			item.TransmittedErrors = decimalPointer(second.transmittedErrors - first.transmittedErrors)
			item.TransmittedDropped = decimalPointer(second.transmittedDropped - first.transmittedDropped)
		}
		result.Interfaces = append(result.Interfaces, item)
	}
	return result
}

func observationMidpoint(started, finished time.Time) time.Time {
	return started.Add(finished.Sub(started) / 2)
}

func comparableCounterReads(before, after map[string]rawCounters) (map[string]rawCounters, map[string]rawCounters, int) {
	comparableBefore := make(map[string]rawCounters, min(len(before), len(after)))
	comparableAfter := make(map[string]rawCounters, min(len(before), len(after)))
	for name, first := range before {
		if second, exists := after[name]; exists {
			comparableBefore[name] = first
			comparableAfter[name] = second
		}
	}
	return comparableBefore, comparableAfter, len(before) + len(after) - 2*len(comparableBefore)
}

func countersReset(before, after rawCounters) bool {
	return after.receivedBytes < before.receivedBytes ||
		after.receivedPackets < before.receivedPackets ||
		after.receivedErrors < before.receivedErrors ||
		after.receivedDropped < before.receivedDropped ||
		after.transmittedBytes < before.transmittedBytes ||
		after.transmittedPackets < before.transmittedPackets ||
		after.transmittedErrors < before.transmittedErrors ||
		after.transmittedDropped < before.transmittedDropped
}

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func interfaceFlags(flags net.Flags) []string {
	known := []struct {
		flag net.Flags
		name string
	}{
		{net.FlagUp, "up"},
		{net.FlagBroadcast, "broadcast"},
		{net.FlagLoopback, "loopback"},
		{net.FlagPointToPoint, "point-to-point"},
		{net.FlagMulticast, "multicast"},
		{net.FlagRunning, "running"},
	}
	result := make([]string, 0, len(known))
	for _, value := range known {
		if flags&value.flag != 0 {
			result = append(result, value.name)
		}
	}
	return result
}

func publicCounters(value rawCounters) InterfaceCounters {
	return InterfaceCounters{
		ReceivedBytes:      strconv.FormatUint(value.receivedBytes, 10),
		ReceivedPackets:    strconv.FormatUint(value.receivedPackets, 10),
		ReceivedErrors:     strconv.FormatUint(value.receivedErrors, 10),
		ReceivedDropped:    strconv.FormatUint(value.receivedDropped, 10),
		TransmittedBytes:   strconv.FormatUint(value.transmittedBytes, 10),
		TransmittedPackets: strconv.FormatUint(value.transmittedPackets, 10),
		TransmittedErrors:  strconv.FormatUint(value.transmittedErrors, 10),
		TransmittedDropped: strconv.FormatUint(value.transmittedDropped, 10),
	}
}

func decimalPointer(value uint64) *string {
	result := strconv.FormatUint(value, 10)
	return &result
}

func describeInterfaceAddress(raw string) (InterfaceAddress, error) {
	raw = strings.TrimSpace(raw)
	addressText, prefixText, found := strings.Cut(raw, "/")
	if !found || prefixText == "" || strings.Contains(prefixText, "/") {
		return InterfaceAddress{}, fmt.Errorf("invalid interface prefix")
	}
	address, err := netip.ParseAddr(addressText)
	if err != nil {
		return InterfaceAddress{}, fmt.Errorf("invalid interface address")
	}
	prefix, err := strconv.Atoi(prefixText)
	if err != nil || prefix < 0 || prefix > address.BitLen() {
		return InterfaceAddress{}, fmt.Errorf("invalid interface prefix")
	}
	plain := address.WithZone("")
	family := "ipv6"
	if plain.Is4() {
		family = "ipv4"
	}
	scope := "other"
	switch {
	case plain.IsUnspecified():
		scope = "unspecified"
	case plain.IsLoopback():
		scope = "loopback"
	case plain.IsLinkLocalUnicast():
		scope = "link-local"
	case plain.IsPrivate():
		scope = "private"
	case plain.IsMulticast():
		scope = "multicast"
	case plain.IsGlobalUnicast():
		scope = "global-unicast"
	}
	return InterfaceAddress{Address: address.String(), Prefix: prefix, Family: family, Scope: scope}, nil
}

func boundedError(err error) string {
	if err == nil {
		return ""
	}
	return boundedText(err.Error(), 512)
}

func boundedText(value string, maximum int) string {
	value = strings.ToValidUTF8(value, "")
	value = strings.TrimSpace(value)
	value = strings.Map(func(character rune) rune {
		if character == '\n' || character == '\r' || character == '\t' || character >= 0x20 {
			return character
		}
		return -1
	}, value)
	if maximum < 0 {
		return ""
	}
	if len(value) > maximum {
		value = value[:maximum]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}

// BoundActivityResponse deterministically preserves listeners first and then
// connections until the encoded v1 response fits its hard 4 MiB ceiling.
func BoundActivityResponse(value Activity) Activity {
	result := &value
	if len(result.Notes) > 64 {
		result.Notes = result.Notes[:64]
		result.Status = "partial"
		result.Truncated = true
	}
	for index := range result.Notes {
		result.Notes[index] = boundedText(result.Notes[index], 512)
	}
	if activityFits(*result) {
		return *result
	}
	originalListeners := result.Listeners
	originalConnections := result.Connections
	limitNote := "Activity response was deterministically truncated at the 4 MiB encoded-response limit"
	result.Status = "partial"
	result.Truncated = true
	result.Notes = deduplicateBoundedNotes(append(result.Notes, limitNote), 64)
	total := len(originalListeners) + len(originalConnections)
	low, high := 0, total
	for low < high {
		candidateCount := low + (high-low+1)/2
		listeners, connections := activitySocketPrefix(originalListeners, originalConnections, candidateCount)
		candidate := *result
		candidate.Listeners = listeners
		candidate.Connections = connections
		if activityFits(candidate) {
			low = candidateCount
		} else {
			high = candidateCount - 1
		}
	}
	result.Listeners, result.Connections = activitySocketPrefix(originalListeners, originalConnections, low)
	return *result
}

// BoundSnapshotResponse deterministically preserves the sorted interface
// prefix and the first sorted addresses until the v1 response fits 1 MiB.
func BoundSnapshotResponse(value Snapshot) Snapshot {
	if len(value.Notes) > 64 {
		value.Notes = value.Notes[:64]
		value.Status = "partial"
	}
	for index := range value.Notes {
		value.Notes[index] = boundedText(value.Notes[index], 512)
	}
	if snapshotFits(value) {
		return value
	}
	value.Status = "partial"
	value.Notes = deduplicateBoundedNotes(append(value.Notes, "Snapshot response was deterministically truncated at the 1 MiB encoded-response limit"), 64)
	original := value.Interfaces
	addressTotal := 0
	withoutAddresses := append([]InterfaceSnapshot(nil), original...)
	for index := range withoutAddresses {
		addressTotal += len(withoutAddresses[index].Addresses)
		withoutAddresses[index].Addresses = []InterfaceAddress{}
	}
	base := value
	base.Interfaces = withoutAddresses
	if snapshotFits(base) {
		low, high := 0, addressTotal
		for low < high {
			candidateCount := low + (high-low+1)/2
			candidate := value
			candidate.Interfaces = snapshotAddressPrefix(original, candidateCount)
			if snapshotFits(candidate) {
				low = candidateCount
			} else {
				high = candidateCount - 1
			}
		}
		value.Interfaces = snapshotAddressPrefix(original, low)
		return value
	}
	low, high := 0, len(original)
	for low < high {
		candidateCount := low + (high-low+1)/2
		candidate := value
		candidate.Interfaces = append([]InterfaceSnapshot(nil), withoutAddresses[:candidateCount]...)
		if snapshotFits(candidate) {
			low = candidateCount
		} else {
			high = candidateCount - 1
		}
	}
	value.Interfaces = append([]InterfaceSnapshot(nil), withoutAddresses[:low]...)
	return value
}

func snapshotAddressPrefix(interfaces []InterfaceSnapshot, maximum int) []InterfaceSnapshot {
	result := append([]InterfaceSnapshot(nil), interfaces...)
	remaining := maximum
	for index := range result {
		count := min(len(result[index].Addresses), remaining)
		result[index].Addresses = result[index].Addresses[:count]
		remaining -= count
	}
	return result
}

func snapshotFits(result Snapshot) bool {
	encoded, err := json.Marshal(result)
	return err == nil && len(encoded)+1 <= MaxEncodedSnapshotResponseBytes
}

func activitySocketPrefix(listeners, connections []Socket, maximum int) ([]Socket, []Socket) {
	listenerCount := min(len(listeners), maximum)
	connectionCount := min(len(connections), maximum-listenerCount)
	return listeners[:listenerCount], connections[:connectionCount]
}

func activityFits(result Activity) bool {
	encoded, err := json.Marshal(result)
	return err == nil && len(encoded)+1 <= MaxEncodedActivityResponseBytes
}

func deduplicateBoundedNotes(notes []string, maximum int) []string {
	seen := make(map[string]struct{}, len(notes))
	result := make([]string, 0, min(len(notes), maximum))
	for _, note := range notes {
		note = boundedText(note, 512)
		if note == "" {
			continue
		}
		if _, exists := seen[note]; exists {
			continue
		}
		seen[note] = struct{}{}
		result = append(result, note)
		if len(result) == maximum {
			break
		}
	}
	return result
}
