//go:build !linux

package netpath

import (
	"context"
	"fmt"
	"runtime"
)

type unsupportedBackend struct{}

func newPlatformBackend() Backend {
	return unsupportedBackend{}
}

func (unsupportedBackend) Capabilities(context.Context) []Capability {
	reason := "ProtoPeek does not yet have a verified unprivileged native path backend for " + runtime.GOOS + "."
	return []Capability{
		unsupportedPlatformCapability("udp", reason),
		unsupportedPlatformCapability("icmp", reason),
		unsupportedPlatformCapability("tcp", reason),
	}
}

func unsupportedPlatformCapability(method, reason string) Capability {
	return Capability{
		Backend:     "unsupported-" + runtime.GOOS,
		Method:      method,
		Families:    make([]string, 0),
		Available:   false,
		Privilege:   "none",
		Install:     "not-offered",
		Reason:      reason,
		Limitations: make([]string, 0),
	}
}

func (unsupportedBackend) Trace(context.Context, Target, TraceConfig) (BackendResult, error) {
	return BackendResult{
		Backend:     "unsupported-" + runtime.GOOS,
		Method:      "none",
		Hops:        make([]Hop, 0),
		Termination: "unsupported",
		Warnings:    make([]string, 0),
	}, fmt.Errorf("%w: no verified unprivileged native backend for %s", ErrUnsupported, runtime.GOOS)
}
