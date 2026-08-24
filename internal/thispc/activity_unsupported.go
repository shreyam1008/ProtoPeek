//go:build !linux

package thispc

import "context"

func platformActivityCapability() (bool, string) {
	return false, "local socket activity currently requires bounded Linux procfs inspection"
}

func newActivityReader() activityReader {
	return func(context.Context) (Activity, error) {
		return Activity{}, ErrActivityUnsupported
	}
}
