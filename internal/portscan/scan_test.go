package portscan

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"reflect"
	"strconv"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (f resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return f(ctx, network, host)
}

func TestPortRanges(t *testing.T) {
	ports, err := ParsePorts("443,80,8000-8002,443")
	if err != nil || !reflect.DeepEqual(ports, []int{80, 443, 8000, 8001, 8002}) {
		t.Fatalf("%v %v", ports, err)
	}
	for _, value := range []string{"", "0", "65536", "443-80", "1-1025", "1-1024,65535", "80,,443", "x", "1-2-3"} {
		if _, err := ParsePorts(value); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted %q", value)
		}
	}
}

func TestRealLoopbackOpenAndClosed(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	input := Request{Host: "127.0.0.1", Ports: strconv.Itoa(port), TimeoutMS: 100, Family: "ipv4"}
	response, err := (Scanner{}).Scan(context.Background(), input)
	if err != nil || !response.Complete || response.Results[0].State != "open" {
		t.Fatalf("open: %+v %v", response, err)
	}
	listener.Close()
	response, err = (Scanner{}).Scan(context.Background(), input)
	if err != nil || response.Results[0].State != "closed" {
		t.Fatalf("closed: %+v %v", response, err)
	}
}

func TestPinnedResolutionClassificationAndCancellation(t *testing.T) {
	var resolutions atomic.Int32
	scanner := Scanner{Resolver: resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		resolutions.Add(1)
		return []netip.Addr{netip.MustParseAddr("::1"), netip.MustParseAddr("127.0.0.1")}, nil
	}), Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address == "127.0.0.1:80" {
			return nil, syscall.ECONNREFUSED
		}
		if address != "127.0.0.1:443" {
			t.Errorf("unexpected unpinned address %q", address)
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	input := Request{Host: "local.test", Ports: "80,443", Family: "auto", TimeoutMS: 100}
	response, err := scanner.Scan(context.Background(), input)
	if err != nil || resolutions.Load() != 1 || response.Address != "127.0.0.1" || response.Results[0].State != "closed" || response.Results[1].State != "no-response" {
		t.Fatalf("%+v %v", response, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := resolutions.Load()
	if _, err = scanner.Scan(ctx, input); !errors.Is(err, context.Canceled) || resolutions.Load() != before {
		t.Fatalf("cancel did traffic: %v", err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, err = scanner.Scan(ctx, input)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancel not propagated: %v", err)
	}
}

func TestWorkerBoundAndValidationBeforeNetwork(t *testing.T) {
	var active, peak atomic.Int32
	scanner := Scanner{Resolver: resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}), Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		count := active.Add(1)
		defer active.Add(-1)
		for {
			old := peak.Load()
			if count <= old || peak.CompareAndSwap(old, count) {
				break
			}
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, _ = scanner.Scan(ctx, Request{Host: "localhost", Ports: "1-1024", Family: "auto", TimeoutMS: 100})
	if peak.Load() > 32 || active.Load() != 0 {
		t.Fatalf("worker leak: active=%d peak=%d", active.Load(), peak.Load())
	}
	for _, host := range []string{"http://localhost", "localhost:80", "192.168.0.0/24", "239.0.0.1"} {
		_, err := (Scanner{}).Scan(context.Background(), Request{Host: host, Ports: "80", Family: "auto", TimeoutMS: 100})
		if err == nil {
			t.Fatalf("accepted %s", host)
		}
	}
}
