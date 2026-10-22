//go:build darwin

package thispc

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

func darwinCounterFixture(index uint16) []byte {
	header := unix.IfMsghdr2{Msglen: unix.SizeofIfMsghdr2, Version: unix.RTM_VERSION, Type: unix.RTM_IFINFO2, Index: index, Snd_drops: 7,
		Data: unix.IfData64{Ibytes: 1<<40 + 10, Obytes: 1<<41 + 20, Ipackets: 30, Opackets: 40, Ierrors: 2, Oerrors: 3, Iqdrops: 4}}
	return append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(&header)), unix.SizeofIfMsghdr2)...)
}

func TestDarwinCounterABIAndPartialEvidence(t *testing.T) {
	if unsafe.Sizeof(unix.IfMsghdr2{}) != unix.SizeofIfMsghdr2 {
		t.Fatal("native ABI size changed")
	}
	raw := darwinCounterFixture(3)
	value, err := parseDarwinInterfaceCounters(raw, 3)
	if err != nil || value.receivedBytes != 1<<40+10 || value.transmittedBytes != 1<<41+20 || value.transmittedDropped != 7 || value.receivedDropped != 4 {
		t.Fatalf("64-bit counters: %+v %v", value, err)
	}
	bad := append([]byte(nil), raw...)
	binary.NativeEndian.PutUint16(bad, 0xffff)
	for _, input := range [][]byte{nil, raw[:3], raw[:len(raw)-1], bad, append(append([]byte(nil), raw...), raw...), make([]byte, maxDarwinInterfaceBytes+1)} {
		if _, err := parseDarwinInterfaceCounters(input, 3); err == nil {
			t.Fatal("accepted malformed or duplicate native counters")
		}
	}
	d := darwinCounterDependencies{interfaces: func() ([]net.Interface, error) {
		return []net.Interface{{Index: 3, Name: "en0"}, {Index: 4, Name: "gone"}}, nil
	}, read: func(index int) ([]byte, error) {
		if index == 3 {
			return raw, nil
		}
		return nil, errors.New("interface disappeared")
	}}
	result, err := d.collect(context.Background())
	if err == nil || len(result) != 1 || result["en0"].receivedBytes != value.receivedBytes {
		t.Fatal("partial interface evidence lost")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.collect(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled read continued")
	}
}

func TestNativeDarwinCountersObserveOwnedLoopbackTraffic(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	reader := newCounterReader()
	before, err := reader(ctx)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	connection, err := net.Dial("udp4", listener.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	deadline, _ := ctx.Deadline()
	if err := listener.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 64)
	for range 16 {
		if _, err := connection.Write(buffer); err != nil {
			t.Fatal(err)
		}
		if _, _, err := listener.ReadFrom(buffer); err != nil {
			t.Fatal(err)
		}
	}
	after, err := reader(ctx)
	if err != nil {
		t.Fatal(err)
	}
	a, ok := before["lo0"]
	b, next := after["lo0"]
	if !ok || !next || b.receivedBytes <= a.receivedBytes || b.transmittedBytes <= a.transmittedBytes {
		t.Fatal("native loopback counters did not observe owned UDP exchange")
	}
	if supported, reason := platformTrafficCapability(); !supported {
		t.Fatal(reason)
	}
}
