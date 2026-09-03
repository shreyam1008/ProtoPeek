//go:build !linux && !windows

package thispc

import "context"

func platformTrafficCapability() (bool, string) {
	return false, "one-shot traffic sampling is currently supported only through native Linux or Windows counters"
}

func newCounterReader() counterReader {
	return func(context.Context) (map[string]rawCounters, error) {
		return nil, ErrTrafficUnsupported
	}
}
