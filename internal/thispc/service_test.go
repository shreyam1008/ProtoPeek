package thispc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

type testAddr string

func (value testAddr) Network() string { return "test" }
func (value testAddr) String() string  { return string(value) }

func TestCapabilitiesAndSnapshotMakeNoExternalCalls(t *testing.T) {
	t.Parallel()
	var publicCalls atomic.Int32
	var activityCalls atomic.Int32
	var localCalls atomic.Int32
	service := &Service{
		hostname: func() (string, error) {
			localCalls.Add(1)
			return "local-test", nil
		},
		interfaces: func() ([]net.Interface, error) {
			localCalls.Add(1)
			return []net.Interface{{Index: 1, MTU: 65536, Name: "lo", Flags: net.FlagUp | net.FlagLoopback}}, nil
		},
		interfaceAddrs: func(net.Interface) ([]net.Addr, error) {
			localCalls.Add(1)
			return []net.Addr{testAddr("127.0.0.1/8")}, nil
		},
		now: func() time.Time { return time.Unix(10, 0) },
		counters: func(context.Context) (map[string]rawCounters, error) {
			localCalls.Add(1)
			return map[string]rawCounters{"lo": {receivedBytes: 9007199254740993}}, nil
		},
		system: func(context.Context) (*LinuxSystemSnapshot, []string) {
			localCalls.Add(1)
			return nil, nil
		},
		activity: func(context.Context) (Activity, error) {
			activityCalls.Add(1)
			return Activity{}, nil
		},
		public: func(context.Context, []string) PublicIdentity {
			publicCalls.Add(1)
			return PublicIdentity{}
		},
	}

	capabilities := service.Capabilities(context.Background())
	if capabilities.SchemaVersion != SchemaVersion || localCalls.Load() != 0 || publicCalls.Load() != 0 || activityCalls.Load() != 0 {
		t.Fatalf("capabilities performed I/O: schema=%d local=%d public=%d activity=%d", capabilities.SchemaVersion, localCalls.Load(), publicCalls.Load(), activityCalls.Load())
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if publicCalls.Load() != 0 || activityCalls.Load() != 0 {
		t.Fatalf("snapshot invoked explicit actions: public=%d activity=%d", publicCalls.Load(), activityCalls.Load())
	}
	if snapshot.SchemaVersion != SchemaVersion || len(snapshot.Interfaces) != 1 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if snapshot.Interfaces[0].Traffic == nil || snapshot.Interfaces[0].Traffic.ReceivedBytes != "9007199254740993" {
		t.Fatalf("exact traffic counter = %#v", snapshot.Interfaces[0].Traffic)
	}
	address := snapshot.Interfaces[0].Addresses[0]
	if address.Address != "127.0.0.1" || address.Prefix != 8 || address.Family != "ipv4" || address.Scope != "loopback" {
		t.Fatalf("structured address = %#v", address)
	}
}

func TestTrafficDeltasRemainExactStringsAndReportCounterLifecycle(t *testing.T) {
	t.Parallel()
	large := uint64(9007199254740993)
	result := buildTrafficSample(
		time.Unix(1, 0), time.Unix(2, 0), time.Second,
		map[string]rawCounters{
			"ok":      {receivedBytes: large, transmittedBytes: 4},
			"reset":   {receivedBytes: 20},
			"missing": {receivedBytes: 1},
		},
		map[string]rawCounters{
			"ok":       {receivedBytes: large + 7, transmittedBytes: 9},
			"reset":    {receivedBytes: 10},
			"appeared": {receivedBytes: 1},
		},
	)
	statuses := make(map[string]InterfaceTrafficSample)
	for _, item := range result.Interfaces {
		statuses[item.Name] = item
	}
	if statuses["ok"].Status != "ok" || statuses["ok"].ReceivedBytes == nil || *statuses["ok"].ReceivedBytes != "7" || statuses["ok"].TransmittedBytes == nil || *statuses["ok"].TransmittedBytes != "5" {
		t.Fatalf("ok delta = %#v", statuses["ok"])
	}
	if statuses["reset"].Status != "counter-reset" || statuses["reset"].ReceivedBytes != nil {
		t.Fatalf("reset delta = %#v", statuses["reset"])
	}
	if statuses["missing"].Status != "disappeared" || statuses["appeared"].Status != "appeared" {
		t.Fatalf("lifecycle statuses = %#v", statuses)
	}
	encoded, err := json.Marshal(publicCounters(rawCounters{receivedBytes: large}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"receivedBytes":"9007199254740993"`) {
		t.Fatalf("counter JSON lost exact string form: %s", encoded)
	}
}

func TestSampleTrafficAllowsOnlyExactDurations(t *testing.T) {
	t.Parallel()
	var waits []time.Duration
	reads := 0
	service := &Service{
		now: func() time.Time { return time.Unix(int64(reads), 0) },
		wait: func(_ context.Context, duration time.Duration) error {
			waits = append(waits, duration)
			return nil
		},
		counters: func(context.Context) (map[string]rawCounters, error) {
			reads++
			return map[string]rawCounters{"eth0": {receivedBytes: uint64(reads)}}, nil
		},
	}
	for _, duration := range []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second} {
		if _, err := service.SampleTraffic(context.Background(), duration); err != nil {
			t.Fatalf("SampleTraffic(%s) error = %v", duration, err)
		}
	}
	if len(waits) != 3 || waits[0] != 500*time.Millisecond || waits[1] != time.Second || waits[2] != 2*time.Second {
		t.Fatalf("waits = %v", waits)
	}
	if _, err := service.SampleTraffic(context.Background(), 750*time.Millisecond); !errors.Is(err, ErrInvalidDuration) {
		t.Fatalf("invalid duration error = %v", err)
	}
}

func TestSampleTrafficReportsMeasuredObservationInterval(t *testing.T) {
	t.Parallel()
	base := time.Unix(100, 0)
	times := []time.Time{
		base,
		base.Add(200 * time.Millisecond),
		base.Add(1200 * time.Millisecond),
		base.Add(1600 * time.Millisecond),
	}
	nowIndex := 0
	reads := 0
	service := &Service{
		now: func() time.Time {
			value := times[nowIndex]
			nowIndex++
			return value
		},
		wait: func(_ context.Context, duration time.Duration) error {
			if duration != 500*time.Millisecond {
				t.Fatalf("wait duration = %s", duration)
			}
			return nil
		},
		counters: func(context.Context) (map[string]rawCounters, error) {
			reads++
			return map[string]rawCounters{"eth0": {receivedBytes: uint64(reads)}}, nil
		},
	}
	result, err := service.SampleTraffic(context.Background(), 500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if result.DurationMS != 1300 || !result.StartedAt.Equal(base.Add(100*time.Millisecond)) || !result.FinishedAt.Equal(base.Add(1400*time.Millisecond)) {
		t.Fatalf("measured sample = start %s, finish %s, duration %d", result.StartedAt, result.FinishedAt, result.DurationMS)
	}
}

func TestSampleTrafficOmitsLifecycleClaimsWhenCounterReadIsPartial(t *testing.T) {
	t.Parallel()
	reads := 0
	service := &Service{
		now: func() time.Time {
			return time.Unix(0, int64(reads)*int64(time.Second))
		},
		wait: func(context.Context, time.Duration) error { return nil },
		counters: func(context.Context) (map[string]rawCounters, error) {
			reads++
			if reads == 1 {
				return map[string]rawCounters{
					"common":      {receivedBytes: 10},
					"unconfirmed": {receivedBytes: 20},
				}, errors.New("one interface counter was unavailable")
			}
			return map[string]rawCounters{
				"common": {receivedBytes: 15},
				"new":    {receivedBytes: 1},
			}, nil
		},
	}
	result, err := service.SampleTraffic(context.Background(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Interfaces) != 1 || result.Interfaces[0].Name != "common" || result.Interfaces[0].Status != "ok" {
		t.Fatalf("partial sample interfaces = %#v", result.Interfaces)
	}
	if joined := strings.Join(result.Notes, "\n"); !strings.Contains(joined, "2 interface lifecycle entries were omitted") {
		t.Fatalf("partial sample notes = %v", result.Notes)
	}
}

func TestSampleTrafficRejectsPartialReadsWithoutComparableInterfaces(t *testing.T) {
	t.Parallel()
	reads := 0
	service := &Service{
		now:  func() time.Time { return time.Unix(int64(reads), 0) },
		wait: func(context.Context, time.Duration) error { return nil },
		counters: func(context.Context) (map[string]rawCounters, error) {
			reads++
			if reads == 1 {
				return map[string]rawCounters{"Ethernet": {receivedBytes: 10}}, errors.New("one starting interface counter was unavailable")
			}
			return map[string]rawCounters{"Wi-Fi": {receivedBytes: 20}}, errors.New("one finishing interface counter was unavailable")
		},
	}

	result, err := service.SampleTraffic(context.Background(), time.Second)
	if !errors.Is(err, ErrTrafficUnavailable) || !strings.Contains(err.Error(), "no interface in common") {
		t.Fatalf("SampleTraffic() = %#v, %v; want unavailable error", result, err)
	}
}

func TestBoundedTextPreservesUTF8Boundary(t *testing.T) {
	t.Parallel()
	value := boundedText("श्रेया", 5)
	if !utf8.ValidString(value) || value != "श" {
		t.Fatalf("boundedText() = %q, valid=%v", value, utf8.ValidString(value))
	}
}

func TestInterfaceAddressScopes(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"127.0.0.1/8":      "loopback",
		"0.0.0.0/0":        "unspecified",
		"169.254.1.1/16":   "link-local",
		"192.168.1.2/24":   "private",
		"224.0.0.1/4":      "multicast",
		"8.8.8.8/32":       "global-unicast",
		"fe80::1%eth0/64":  "link-local",
		"2001:4860::1/128": "global-unicast",
	}
	for input, want := range tests {
		value, err := describeInterfaceAddress(input)
		if err != nil || value.Scope != want {
			t.Errorf("describeInterfaceAddress(%q) = %#v, %v; want scope %q", input, value, err, want)
		}
	}
}

func TestSnapshotCapsAddressesAt64(t *testing.T) {
	t.Parallel()
	addresses := make([]net.Addr, maxAddressesPerInterface+1)
	for index := range addresses {
		addresses[index] = testAddr("10.0.0." + strconv.Itoa(index%255) + "/24")
	}
	service := &Service{
		hostname: func() (string, error) { return "test", nil },
		interfaces: func() ([]net.Interface, error) {
			return []net.Interface{{Index: 1, Name: "eth0"}}, nil
		},
		interfaceAddrs: func(net.Interface) ([]net.Addr, error) { return addresses, nil },
		now:            time.Now,
		counters:       func(context.Context) (map[string]rawCounters, error) { return map[string]rawCounters{}, nil },
		system:         func(context.Context) (*LinuxSystemSnapshot, []string) { return nil, nil },
	}
	result, err := service.Snapshot(context.Background())
	if err != nil || len(result.Interfaces) != 1 || len(result.Interfaces[0].Addresses) != maxAddressesPerInterface || result.Status != "partial" {
		t.Fatalf("snapshot address bound = %#v, %v", result, err)
	}
}

func TestSnapshotSortsBeforeInterfaceTruncation(t *testing.T) {
	t.Parallel()
	interfaces := make([]net.Interface, maxSnapshotInterfaces+1)
	for index := range interfaces {
		interfaces[index] = net.Interface{Index: len(interfaces) - index, Name: "if" + strconv.Itoa(len(interfaces)-index)}
	}
	service := &Service{
		hostname:       func() (string, error) { return "test", nil },
		interfaces:     func() ([]net.Interface, error) { return interfaces, nil },
		interfaceAddrs: func(net.Interface) ([]net.Addr, error) { return []net.Addr{}, nil },
		now:            time.Now,
		counters:       func(context.Context) (map[string]rawCounters, error) { return map[string]rawCounters{}, nil },
		system:         func(context.Context) (*LinuxSystemSnapshot, []string) { return nil, nil },
	}
	result, err := service.Snapshot(context.Background())
	if err != nil || len(result.Interfaces) != maxSnapshotInterfaces {
		t.Fatalf("snapshot len=%d err=%v", len(result.Interfaces), err)
	}
	for index, value := range result.Interfaces {
		if value.Index != index+1 {
			t.Fatalf("interface %d index=%d", index, value.Index)
		}
	}
}

func TestSnapshotEncodedResponseHasHardOneMiBCeiling(t *testing.T) {
	t.Parallel()
	interfaces := make([]InterfaceSnapshot, maxSnapshotInterfaces)
	for index := range interfaces {
		addresses := make([]InterfaceAddress, maxAddressesPerInterface)
		for addressIndex := range addresses {
			addresses[addressIndex] = InterfaceAddress{Address: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", Prefix: 128, Family: "ipv6", Scope: "global-unicast"}
		}
		interfaces[index] = InterfaceSnapshot{Index: index + 1, Name: "interface-" + strconv.Itoa(index), Flags: []string{}, Addresses: addresses}
	}
	result := BoundSnapshotResponse(Snapshot{
		SchemaVersion: SchemaVersion, Status: "ok", Scope: Scope, ScopeNotice: ScopeNotice,
		ObservedAt: time.Unix(1, 0), OS: "linux", Arch: "amd64", LogicalCPUs: 8, Interfaces: interfaces, Notes: []string{},
	})
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded)+1 > MaxEncodedSnapshotResponseBytes || result.Status != "partial" || len(result.Interfaces) == 0 {
		t.Fatalf("encoded=%d status=%q interfaces=%d", len(encoded)+1, result.Status, len(result.Interfaces))
	}
}

func TestActivityEncodedResponseHasHardFourMiBCeiling(t *testing.T) {
	t.Parallel()
	owners := make([]ProcessAttribution, 8)
	for index := range owners {
		owners[index] = ProcessAttribution{PID: index + 1, Comm: strings.Repeat("x", 256)}
	}
	sockets := make([]Socket, maxSockets)
	for index := range sockets {
		sockets[index] = Socket{
			Protocol: "tcp6", State: "ESTABLISHED",
			Local: Endpoint{Address: "2001:db8::1", Port: 65535}, Remote: Endpoint{Address: "2001:db8::2", Port: 65535},
			Exposure: "interface-bound", OwnerStatus: "observed", Processes: owners,
		}
	}
	service := &Service{activity: func(context.Context) (Activity, error) {
		return Activity{SchemaVersion: SchemaVersion, Status: "ok", Scope: Scope, ScopeNotice: ScopeNotice, Connections: sockets, Listeners: []Socket{}, Notes: []string{}}, nil
	}}
	result, err := service.Activity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded)+1 > MaxEncodedActivityResponseBytes || !result.Truncated || result.Status != "partial" {
		t.Fatalf("encoded=%d truncated=%v status=%q", len(encoded)+1, result.Truncated, result.Status)
	}
}

type fetcherFunc func(context.Context, string) (netip.Addr, error)

func (function fetcherFunc) Fetch(ctx context.Context, family string) (netip.Addr, error) {
	return function(ctx, family)
}

type originFunc func(context.Context, netip.Addr) (*BGPOriginNetwork, error, error)

func (function originFunc) Lookup(ctx context.Context, address netip.Addr) (*BGPOriginNetwork, error, error) {
	return function(ctx, address)
}

func TestPublicIdentityPreservesIPv4WhenIPv6FailsAndSanitizesErrors(t *testing.T) {
	t.Parallel()
	dependencies := publicDependencies{
		fetcher: fetcherFunc(func(_ context.Context, family string) (netip.Addr, error) {
			if family == "ipv6" {
				return netip.Addr{}, errors.New("https://user:secret@example.invalid/private/path")
			}
			return netip.MustParseAddr("8.8.8.8"), nil
		}),
		origin: originFunc(func(_ context.Context, address netip.Addr) (*BGPOriginNetwork, error, error) {
			return &BGPOriginNetwork{Label: "BGP origin network", Evidence: "provider-reported", Provider: cymruProvider, ASN: "AS15169", Prefix: "8.8.8.0/24"}, nil, nil
		}),
		now: func() time.Time { return time.Unix(1, 0) },
	}
	result := dependencies.read(context.Background(), []string{"ipv4", "ipv6"})
	if result.SchemaVersion != SchemaVersion || result.Families[0].Status != "ok" || result.Families[0].Address != "8.8.8.8" || result.Families[0].BGPOriginStatus != "ok" {
		t.Fatalf("IPv4 result = %#v", result.Families[0])
	}
	if result.Families[1].Status != "unavailable" || !strings.Contains(result.Families[1].Error, "public IPv6 path unavailable") {
		t.Fatalf("IPv6 result = %#v", result.Families[1])
	}
	if strings.Contains(result.Families[1].Error, "secret") || strings.Contains(result.Families[1].Error, "/private") || strings.Contains(result.Families[1].Error, "@") {
		t.Fatalf("public error leaked URL details: %q", result.Families[1].Error)
	}
}

func TestIPifyEndpointsAndResponseBoundsAreFixed(t *testing.T) {
	t.Parallel()
	if ipifyIPv4Endpoint != "https://api.ipify.org" || ipifyIPv6Endpoint != "https://api6.ipify.org" {
		t.Fatalf("ipify endpoints changed: %q %q", ipifyIPv4Endpoint, ipifyIPv6Endpoint)
	}
	oversized := &http.Response{StatusCode: http.StatusOK, ContentLength: -1, Body: io.NopCloser(strings.NewReader(strings.Repeat("1", maxIPifyBodyBytes+1)))}
	if _, err := readIPifyResponse(oversized, "ipv4"); err == nil || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("oversized response error = %v", err)
	}
	for _, test := range []struct {
		body   string
		family string
		ok     bool
	}{
		{body: "8.8.8.8\n", family: "ipv4", ok: true},
		{body: "2001:4860:4860::8888", family: "ipv6", ok: true},
		{body: "8.8.8.8 extra", family: "ipv4"},
		{body: "127.0.0.1", family: "ipv4"},
		{body: "8.8.8.8", family: "ipv6"},
	} {
		_, err := parseIPifyAddress([]byte(test.body), test.family)
		if (err == nil) != test.ok {
			t.Errorf("parseIPifyAddress(%q, %q) error = %v", test.body, test.family, err)
		}
	}
}

type txtResolverFunc func(context.Context, string) ([]string, error)

func (function txtResolverFunc) LookupTXT(ctx context.Context, query string) ([]string, error) {
	return function(ctx, query)
}

func TestCymruRejectsMultiOriginWithoutPickingOne(t *testing.T) {
	t.Parallel()
	queries := make([]string, 0)
	client := &cymruClient{resolver: txtResolverFunc(func(_ context.Context, query string) ([]string, error) {
		queries = append(queries, query)
		return []string{
			"15169 | 8.8.8.0/24 | US | arin | 1992-12-01",
			"64500 | 8.8.8.0/24 | US | arin | 1992-12-01",
		}, nil
	})}
	if _, _, err := client.Lookup(context.Background(), netip.MustParseAddr("8.8.8.8")); !errors.Is(err, errBGPAmbiguous) {
		t.Fatalf("multi-origin error = %v", err)
	}
	if len(queries) != 1 || queries[0] != "8.8.8.8.origin.asn.cymru.com." {
		t.Fatalf("queries = %v", queries)
	}
	if _, _, err := parseCymruOriginRecord("15169 64500 | 8.8.8.0/24 | US | arin | 1992-12-01", netip.MustParseAddr("8.8.8.8")); !errors.Is(err, errBGPAmbiguous) {
		t.Fatalf("multi-ASN field error = %v", err)
	}
}

func TestCymruFixedIPv6AndASNNameQueries(t *testing.T) {
	t.Parallel()
	queries := make([]string, 0)
	client := &cymruClient{resolver: txtResolverFunc(func(_ context.Context, query string) ([]string, error) {
		queries = append(queries, query)
		if strings.HasPrefix(query, "AS") {
			return []string{"15169 | US | arin | 2000-03-30 | GOOGLE - Google LLC"}, nil
		}
		return []string{"15169 | 2001:4860::/32 | US | arin | 2005-03-14"}, nil
	})}
	origin, nameErr, err := client.Lookup(context.Background(), netip.MustParseAddr("2001:4860:4860::8888"))
	if err != nil || nameErr != nil || origin.ASN != "AS15169" || origin.Name == "" {
		t.Fatalf("origin=%#v nameErr=%v err=%v", origin, nameErr, err)
	}
	wantOriginQuery := "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com."
	if len(queries) != 2 || queries[0] != wantOriginQuery || queries[1] != "AS15169.asn.cymru.com." {
		t.Fatalf("queries = %v", queries)
	}
}

func TestCymruQueryValidationIsFixedAndStrict(t *testing.T) {
	t.Parallel()
	for _, query := range []string{
		"evil.origin.asn.cymru.com.",
		"008.8.8.8.origin.asn.cymru.com.",
		"256.8.8.8.origin.asn.cymru.com.",
		"a.b.origin6.asn.cymru.com.",
		"AS1.example.com.",
	} {
		if validCymruQuery(query) {
			t.Errorf("validCymruQuery(%q) = true", query)
		}
	}
}
