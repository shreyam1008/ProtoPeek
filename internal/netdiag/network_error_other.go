//go:build !windows

package netdiag

func platformNetworkError(error) (string, string, bool) { return "", "", false }
