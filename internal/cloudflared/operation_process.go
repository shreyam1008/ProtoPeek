package cloudflared

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

func runOperation(parent context.Context, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, args...)
	configureToolProcess(command)
	command.WaitDelay = time.Second
	command.Env = make([]string, 0, len(os.Environ()))
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		key = strings.ToUpper(key)
		if !strings.HasPrefix(key, "TUNNEL_") && !strings.HasPrefix(key, "CLOUDFLARED_") && !strings.HasPrefix(key, "CLOUDFLARE_") && !strings.HasPrefix(key, "CF_") {
			command.Env = append(command.Env, value)
		}
	}
	var output boundedBuffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("native cloudflared operation failed")
	}
	return output.Bytes(), nil
}
