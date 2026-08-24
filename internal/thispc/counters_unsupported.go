//go:build !linux

package thispc

import "context"

func platformTrafficCapability() (bool, string) {
	return false, "one-shot traffic sampling currently requires Linux /proc/net/dev counters"
}

func newCounterReader() counterReader {
	return func(context.Context) (map[string]rawCounters, error) {
		return nil, ErrTrafficUnsupported
	}
}
