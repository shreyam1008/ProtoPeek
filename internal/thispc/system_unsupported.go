//go:build !linux

package thispc

import "context"

func newSystemReader() systemReader {
	return func(context.Context) (*LinuxSystemSnapshot, []string) { return nil, nil }
}
