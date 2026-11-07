//go:build !windows && !linux && !darwin

package transfer

import "errors"

func directoryIdentity(string) (string, error) {
	return "", errors.New("directory identity unavailable")
}
