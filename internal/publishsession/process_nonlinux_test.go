//go:build !linux

package publishsession

import (
	"context"
	"io"
)

func launchFixture(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
	return launch(ctx, path, args, output)
}
