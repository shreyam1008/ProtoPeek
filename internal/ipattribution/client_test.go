package ipattribution

import (
	"context"
	"encoding/json"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNonPublicAddressesNeverLeaveHostAndCacheIsBounded(t *testing.T) {
	var calls atomic.Int32
	client := &Client{cache: make(map[netip.Addr]Entry), lookup: func(_ context.Context, _ netip.Addr) (Entry, error) {
		calls.Add(1)
		return Entry{Country: "Fixture country", ASN: 13335}, nil
	}}
	input := []string{"127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.1", "::1", "fe80::1", "2001:db8::1", "1.1.1.1", "::ffff:1.1.1.1"}
	first, err := client.Enrich(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Entries) != 8 || calls.Load() != 1 {
		t.Fatalf("unexpected calls %d entries %+v", calls.Load(), first.Entries)
	}
	for _, entry := range first.Entries[:7] {
		if entry.Status != "skipped" || !strings.Contains(entry.Note, "not sent") {
			t.Fatal(entry)
		}
	}
	second, _ := client.Enrich(context.Background(), []string{"1.1.1.1"})
	if !second.Entries[0].Cached || calls.Load() != 1 {
		t.Fatal("cache was not reused")
	}
	for i := 0; i < 200; i++ {
		client.store(netip.AddrFrom4([4]byte{1, 1, 2, byte(i)}), first.Entries[7])
	}
	if len(client.cache) != 128 {
		t.Fatal("unbounded cache")
	}
}

func TestInputValidationPrecedesAnyLookup(t *testing.T) {
	client := &Client{lookup: func(context.Context, netip.Addr) (Entry, error) { t.Error("unexpected lookup"); return Entry{}, nil }}
	for _, input := range [][]string{nil, {"1.1.1.1", "example.com"}, {"2001:4860::1%12"}, make([]string, 33), {"https://1.1.1.1"}} {
		if _, err := client.Enrich(context.Background(), input); err == nil {
			t.Fatal("accepted invalid input", input)
		}
	}
}

func TestCancellationStopsTwoWorkersWithoutStartingRemainingLookups(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	var count atomic.Int32
	client := &Client{cache: make(map[netip.Addr]Entry), lookup: func(ctx context.Context, _ netip.Addr) (Entry, error) {
		if count.Add(1) == 2 {
			close(started)
		}
		<-ctx.Done()
		return Entry{}, ctx.Err()
	}}
	done := make(chan Result)
	go func() { result, _ := client.Enrich(ctx, []string{"1.1.1.1", "8.8.8.8", "9.9.9.9"}); done <- result }()
	<-started
	cancel()
	result := <-done
	if count.Load() != 2 || len(result.Entries) != 3 {
		t.Fatal(count.Load(), result)
	}
	for _, entry := range result.Entries {
		if entry.Status != "failed" {
			t.Fatal(entry)
		}
	}
}

func TestProviderIdentityAndEvidenceBounds(t *testing.T) {
	address := netip.MustParseAddr("1.1.1.1")
	for _, data := range []string{`{"ip":"8.8.8.8","success":true}`, `{"ip":"1.1.1.1","success":false}`, `{"ip":"1.1.1.1","success":true,"connection":{"asn":-1}}`, `[]`} {
		if _, err := decodeProvider([]byte(data), address); err == nil {
			t.Fatal("accepted inconsistent provider response", data)
		}
	}
	data, _ := json.Marshal(map[string]any{"ip": "1.1.1.1", "success": true, "country": strings.Repeat("国", 100), "connection": map[string]any{"asn": 13335, "org": "Cloudflare\n\x00fixture"}, "security": map[string]any{"hosting": true}})
	entry, err := decodeProvider(data, address)
	if err != nil || len(entry.Country) > 128 || strings.ContainsAny(entry.Organization, "\n\x00") {
		t.Fatal(entry, err)
	}
	encoded, _ := json.Marshal(entry)
	if strings.Contains(string(encoded), "hosting") {
		t.Fatal("unrequested provider extension retained")
	}
}
