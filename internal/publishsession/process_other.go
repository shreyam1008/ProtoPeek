//go:build !windows && !linux

package publishsession

import (
	"context"
	"io"
	"os/exec"
)

func hideProcess(*exec.Cmd) {}
func publishingPlatformError() error {
	return publicError("Foreground publishing is unavailable on this platform because child cleanup after a forced ProtoPeek exit cannot be guaranteed. Manage Serve, Funnel or Quick Tunnel directly in the installed native client.")
}
func launch(context.Context, string, []string, io.Writer) (child, error) {
	return nil, publishingPlatformError()
}
