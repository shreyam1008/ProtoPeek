//go:build !linux && !windows

package thispc

import "context"

func platformActivityCapability() (bool, string) {
	return false, "local socket activity is currently supported only through native Linux or Windows inspection"
}

func newActivityReader() activityReader {
	return func(context.Context) (Activity, error) {
		return Activity{}, ErrActivityUnsupported
	}
}
