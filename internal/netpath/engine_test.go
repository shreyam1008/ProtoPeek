package netpath_test

import (
	"context"
	"errors"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/netpath"
	"github.com/shreyam1008/ProtoPeek/internal/netroute"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (function resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return function(ctx, network, host)
}

type backendFunc struct {
	capabilities func(context.Context) []netpath.Capability
	trace        func(context.Context, netpath.Target, netpath.TraceConfig) (netpath.BackendResult, error)
}

func (backend backendFunc) Capabilities(ctx context.Context) []netpath.Capability {
	return backend.capabilities(ctx)
}

func (backend backendFunc) Trace(ctx context.Context, target netpath.Target, config netpath.TraceConfig) (netpath.BackendResult, error) {
	return backend.trace(ctx, target, config)
}

func TestEnginePinsOneResolvedAddressAndPreservesHopEvidence(t *testing.T) {
	t.Parallel()
	var resolverCalls atomic.Int32
	resolver := resolverFunc(func(_ context.Context, network, host string) ([]netip.Addr, error) {
		resolverCalls.Add(1)
		if network != "ip" || host != "service.example" {
			t.Fatalf("resolver lookup = %q %q", network, host)
		}
		return []netip.Addr{
			netip.MustParseAddr("192.0.2.10"),
			netip.MustParseAddr("2001:db8::10"),
		}, nil
	})

	lookup := func(_ context.Context, destination netip.Addr) netroute.Result {
		if got, want := destination.String(), "192.0.2.10"; got != want {
			t.Fatalf("route destination = %q, want %q", got, want)
		}
		return netroute.Result{
			Destination: destination.String(),
			Family:      "ipv4",
			Status:      "ok",
			Backend:     "fixture-route",
			SourceIP:    "192.0.2.20",
			Notes:       []string{},
		}
	}

	rttA := 3.25
	rttB := 4.75
	backend := backendFunc{
		capabilities: func(context.Context) []netpath.Capability {
			return []netpath.Capability{{
				Backend:   "fixture-error-queue",
				Method:    "udp",
				Families:  []string{"ipv4", "ipv6"},
				Available: true,
			}}
		},
		trace: func(_ context.Context, target netpath.Target, config netpath.TraceConfig) (netpath.BackendResult, error) {
			if got, want := target.Address.String(), "192.0.2.10"; got != want {
				t.Fatalf("pinned target = %q, want %q", got, want)
			}
			if config.Method != "udp" || config.MaxHops != 24 || config.ProbesPerHop != 3 || config.DestinationPort != 33434 {
				t.Fatalf("normalized config = %#v", config)
			}
			return netpath.BackendResult{
				Backend:     "fixture-error-queue",
				Method:      "udp",
				Reached:     true,
				Termination: "reached",
				Hops: []netpath.Hop{{
					TTL:        1,
					Responders: []string{"192.0.2.1", "192.0.2.2"},
					Samples: []netpath.Sample{
						{Sequence: 1, Status: "reply", Responder: "192.0.2.1", RTTMillis: &rttA},
						{Sequence: 2, Status: "timeout"},
						{Sequence: 3, Status: "reply", Responder: "192.0.2.2", RTTMillis: &rttB},
					},
				}},
			}, nil
		},
	}

	engine := netpath.NewEngine(resolver, lookup, backend)
	response, err := engine.Trace(context.Background(), netpath.Request{
		Destination: "service.example",
		Family:      "auto",
		Method:      "auto",
		Consent: netpath.Consent{
			ActiveProbe:  true,
			PublicTarget: true,
		},
	})
	if err != nil {
		t.Fatalf("Trace() error = %v", err)
	}
	if resolverCalls.Load() != 1 {
		t.Fatalf("resolver calls = %d, want 1", resolverCalls.Load())
	}
	if got, want := response.Resolution.PinnedAddress, "192.0.2.10"; got != want {
		t.Fatalf("pinned address = %q, want %q", got, want)
	}
	if got, want := len(response.Resolution.Answers), 2; got != want {
		t.Fatalf("resolution answers = %d, want %d", got, want)
	}
	if response.Route.Backend != "fixture-route" || response.Backend != "fixture-error-queue" || response.Method != "udp" {
		t.Fatalf("evidence backends = route %#v, path %q/%q", response.Route, response.Backend, response.Method)
	}
	if response.Parameters.Family != "ipv4" || response.Parameters.Method != "udp" {
		t.Fatalf("actual parameters = %#v", response.Parameters)
	}
	if response.Status != "complete" || !response.Reached || response.Termination != "reached" {
		t.Fatalf("completion = status %q reached %t termination %q", response.Status, response.Reached, response.Termination)
	}
	if len(response.Hops) != 1 || len(response.Hops[0].Responders) != 2 || response.Hops[0].Samples[1].Status != "timeout" {
		t.Fatalf("hop evidence = %#v", response.Hops)
	}
	if len(response.Warnings) == 0 || !strings.Contains(response.Warnings[0], "not per-link latency") {
		t.Fatalf("warnings = %#v", response.Warnings)
	}
}

func TestEnginePreservesResolverCancellationAndDoesNotProbe(t *testing.T) {
	t.Parallel()
	var backendCalls atomic.Int32
	engine := netpath.NewEngine(
		resolverFunc(func(ctx context.Context, _, _ string) ([]netip.Addr, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		}),
		func(context.Context, netip.Addr) netroute.Result {
			t.Fatal("route lookup ran after resolver cancellation")
			return netroute.Result{}
		},
		backendFunc{
			capabilities: func(context.Context) []netpath.Capability { return []netpath.Capability{} },
			trace: func(context.Context, netpath.Target, netpath.TraceConfig) (netpath.BackendResult, error) {
				backendCalls.Add(1)
				return netpath.BackendResult{}, nil
			},
		},
	)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := engine.Trace(ctx, netpath.Request{
		Destination: "cancel.example",
		Consent:     netpath.Consent{ActiveProbe: true, PublicTarget: true},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Trace() error = %v, want context cancellation", err)
	}
	if backendCalls.Load() != 0 {
		t.Fatalf("backend calls = %d", backendCalls.Load())
	}
}

func TestEngineRejectsPreCancelledLiteralBeforeRouteOrCapabilityChecks(t *testing.T) {
	t.Parallel()
	var capabilityCalls atomic.Int32
	engine := netpath.NewEngine(
		resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
			t.Fatal("literal destination unexpectedly used DNS")
			return nil, nil
		}),
		func(context.Context, netip.Addr) netroute.Result {
			t.Fatal("route lookup ran for pre-cancelled request")
			return netroute.Result{}
		},
		backendFunc{
			capabilities: func(context.Context) []netpath.Capability {
				capabilityCalls.Add(1)
				return []netpath.Capability{}
			},
			trace: func(context.Context, netpath.Target, netpath.TraceConfig) (netpath.BackendResult, error) {
				t.Fatal("backend trace ran for pre-cancelled request")
				return netpath.BackendResult{}, nil
			},
		},
	)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := engine.Trace(ctx, netpath.Request{
		Destination: "127.0.0.1",
		Consent:     netpath.Consent{ActiveProbe: true},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Trace() error = %v, want context cancellation", err)
	}
	if capabilityCalls.Load() != 0 {
		t.Fatalf("capability calls = %d", capabilityCalls.Load())
	}
}

func TestEngineRejectsBackendEvidenceOutsideNormalizedCaps(t *testing.T) {
	t.Parallel()
	backend := backendFunc{
		capabilities: func(context.Context) []netpath.Capability {
			return []netpath.Capability{{Backend: "fixture-native", Method: "udp", Families: []string{"ipv4"}, Available: true}}
		},
		trace: func(context.Context, netpath.Target, netpath.TraceConfig) (netpath.BackendResult, error) {
			return netpath.BackendResult{
				Backend:     "fixture-native",
				Method:      "udp",
				Termination: "max-hops",
				Hops: []netpath.Hop{
					{TTL: 1, Responders: []string{}, Samples: []netpath.Sample{{Sequence: 1, Status: "timeout"}}},
					{TTL: 2, Responders: []string{}, Samples: []netpath.Sample{{Sequence: 2, Status: "timeout"}}},
				},
			}, nil
		},
	}
	engine := netpath.NewEngine(
		resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}),
		func(_ context.Context, address netip.Addr) netroute.Result {
			return netroute.Result{Destination: address.String(), Status: "ok", Backend: "fixture-route", Notes: []string{}}
		},
		backend,
	)
	_, err := engine.Trace(context.Background(), netpath.Request{
		Destination:  "localhost",
		MaxHops:      1,
		ProbesPerHop: 1,
		Consent:      netpath.Consent{ActiveProbe: true},
	})
	if !errors.Is(err, netpath.ErrInvalidBackendEvidence) {
		t.Fatalf("Trace() error = %v, want invalid backend evidence", err)
	}
}

func TestEngineAcceptsProbeSequenceNumbersLocalToEachHop(t *testing.T) {
	t.Parallel()
	rtt := 1.5
	backend := backendFunc{
		capabilities: func(context.Context) []netpath.Capability {
			return []netpath.Capability{{Backend: "fixture-native", Method: "udp", Families: []string{"ipv4"}, Available: true}}
		},
		trace: func(context.Context, netpath.Target, netpath.TraceConfig) (netpath.BackendResult, error) {
			return netpath.BackendResult{
				Backend:     "fixture-native",
				Method:      "udp",
				Termination: "max-hops",
				Hops: []netpath.Hop{
					{TTL: 1, Responders: []string{"127.0.0.2"}, Samples: []netpath.Sample{{Sequence: 1, Status: "reply", Responder: "127.0.0.2", RTTMillis: &rtt}}},
					{TTL: 2, Responders: []string{"127.0.0.3"}, Samples: []netpath.Sample{{Sequence: 1, Status: "reply", Responder: "127.0.0.3", RTTMillis: &rtt}}},
				},
			}, nil
		},
	}
	engine := netpath.NewEngine(
		resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}),
		func(_ context.Context, address netip.Addr) netroute.Result {
			return netroute.Result{Destination: address.String(), Status: "ok", Backend: "fixture-route", Notes: []string{}}
		},
		backend,
	)
	response, err := engine.Trace(context.Background(), netpath.Request{
		Destination:  "localhost",
		MaxHops:      2,
		ProbesPerHop: 1,
		Consent:      netpath.Consent{ActiveProbe: true},
	})
	if err != nil {
		t.Fatalf("Trace() error = %v", err)
	}
	if len(response.Hops) != 2 || response.Hops[1].Samples[0].Sequence != 1 {
		t.Fatalf("hops = %#v", response.Hops)
	}
}
