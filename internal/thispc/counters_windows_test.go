//go:build windows

package thispc

import (
	"context"
	"errors"
	"math"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsCountersUseGetIfEntry2AndMapExactFields(t *testing.T) {
	t.Parallel()
	calledIndexes := make([]uint32, 0)
	dependencies := windowsCounterDependencies{
		interfaces: func() ([]net.Interface, error) {
			return []net.Interface{{Index: 2, Name: "restricted"}, {Index: 1, Name: "Ethernet"}}, nil
		},
		getIfEntry: func(row *windows.MibIfRow2) error {
			calledIndexes = append(calledIndexes, row.InterfaceIndex)
			if row.InterfaceIndex == 2 {
				return windows.ERROR_ACCESS_DENIED
			}
			row.InOctets = 9007199254740993
			row.InUcastPkts = 10
			row.InNUcastPkts = 3
			row.InErrors = 2
			row.InDiscards = 4
			row.OutOctets = 9007199254740994
			row.OutUcastPkts = 20
			row.OutNUcastPkts = 5
			row.OutErrors = 6
			row.OutDiscards = 7
			return nil
		},
	}
	result, err := dependencies.read(context.Background())
	if err == nil || !strings.Contains(err.Error(), "1 Windows interface counter") || len(result) != 1 {
		t.Fatalf("read() result=%#v error=%v", result, err)
	}
	if len(calledIndexes) != 2 || calledIndexes[0] != 1 || calledIndexes[1] != 2 {
		t.Fatalf("GetIfEntry2 indexes = %v", calledIndexes)
	}
	value := result["Ethernet"]
	if value.receivedBytes != 9007199254740993 || value.receivedPackets != 13 || value.receivedErrors != 2 || value.receivedDropped != 4 || value.transmittedBytes != 9007199254740994 || value.transmittedPackets != 25 || value.transmittedErrors != 6 || value.transmittedDropped != 7 {
		t.Fatalf("mapped counters = %#v", value)
	}
}

func TestWindowsCountersRejectOverflowAndBoundInterfaces(t *testing.T) {
	t.Parallel()
	overflow := windowsCounterDependencies{
		interfaces: func() ([]net.Interface, error) { return []net.Interface{{Index: 1, Name: "overflow"}}, nil },
		getIfEntry: func(row *windows.MibIfRow2) error {
			row.InUcastPkts = math.MaxUint64
			row.InNUcastPkts = 1
			return nil
		},
	}
	if result, err := overflow.read(context.Background()); err == nil || result != nil || !strings.Contains(err.Error(), "overflow") {
		t.Fatalf("overflow result=%#v error=%v", result, err)
	}

	interfaces := make([]net.Interface, maxSnapshotInterfaces+1)
	for index := range interfaces {
		interfaces[index] = net.Interface{Index: index + 1, Name: "if" + string(rune(0x100+index))}
	}
	calls := 0
	bounded := windowsCounterDependencies{
		interfaces: func() ([]net.Interface, error) { return interfaces, nil },
		getIfEntry: func(*windows.MibIfRow2) error { calls++; return nil },
	}
	result, err := bounded.read(context.Background())
	if err == nil || len(result) != maxSnapshotInterfaces || calls != maxSnapshotInterfaces || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("bounded len=%d calls=%d error=%v", len(result), calls, err)
	}
}

func TestWindowsCounterReadHonorsCancellationBeforeNativeCalls(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	dependencies := windowsCounterDependencies{
		interfaces: func() ([]net.Interface, error) { called = true; return nil, nil },
		getIfEntry: func(*windows.MibIfRow2) error { called = true; return nil },
	}
	if _, err := dependencies.read(ctx); !errors.Is(err, context.Canceled) || called {
		t.Fatalf("cancelled read called=%v error=%v", called, err)
	}
}

func TestSampleTrafficPreservesUsablePartialCounterReads(t *testing.T) {
	t.Parallel()
	reads := 0
	service := &Service{
		now:  func() time.Time { return time.Unix(int64(reads), 0) },
		wait: func(context.Context, time.Duration) error { return nil },
		counters: func(context.Context) (map[string]rawCounters, error) {
			reads++
			return map[string]rawCounters{"Ethernet": {receivedBytes: uint64(reads * 10)}}, errors.New("one hot-plugged interface disappeared")
		},
	}
	result, err := service.SampleTraffic(context.Background(), time.Second)
	if err != nil || len(result.Interfaces) != 1 || result.Interfaces[0].ReceivedBytes == nil || *result.Interfaces[0].ReceivedBytes != "10" || len(result.Notes) != 2 {
		t.Fatalf("SampleTraffic() = %#v, %v", result, err)
	}
	if !strings.Contains(result.Notes[0], "starting") || !strings.Contains(result.Notes[1], "finishing") {
		t.Fatalf("partial notes = %v", result.Notes)
	}

	service.counters = func(context.Context) (map[string]rawCounters, error) { return nil, errors.New("none") }
	if _, err := service.SampleTraffic(context.Background(), time.Second); err == nil {
		t.Fatal("empty failed counter read was accepted")
	}
}

func TestWindowsCapabilitiesAdvertiseNativeExplicitOperations(t *testing.T) {
	t.Parallel()
	activitySupported, activityReason := platformActivityCapability()
	trafficSupported, trafficReason := platformTrafficCapability()
	if !activitySupported || activityReason != "" || !trafficSupported || trafficReason != "" {
		t.Fatalf("activity=(%v,%q) traffic=(%v,%q)", activitySupported, activityReason, trafficSupported, trafficReason)
	}
}
