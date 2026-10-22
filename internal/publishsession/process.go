package publishsession

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
)

var errProcessOwnershipUnconfirmed = errors.New("native process ownership cleanup is unconfirmed")

func findTool(tool string) (string, error) {
	if err := publishingPlatformError(); err != nil {
		return "", err
	}
	var path string
	var err error
	if tool == "tailscale" {
		path, err = tailnet.New().Find()
	} else {
		path, err = exec.LookPath("cloudflared")
	}
	if err != nil {
		return "", err
	}
	// Preview and Start both find the client before observing or launching it.
	return validatePublishingExecutable(path, tool)
}

// Proxy, provider-token, socket and experimental environment overrides must
// not change the reviewed command's identity or select ambient credentials.
func environment() []string {
	result := []string{}
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		key = strings.ToUpper(key)
		if strings.HasPrefix(key, "TUNNEL_") || strings.HasPrefix(key, "CLOUDFLARED_") || strings.HasPrefix(key, "CF_") || strings.HasPrefix(key, "TS_") || strings.HasPrefix(key, "TAILSCALE_") || key == "HTTP_PROXY" || key == "HTTPS_PROXY" || key == "ALL_PROXY" || key == "NO_PROXY" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func command(ctx context.Context, path string, args []string, output io.Writer) *exec.Cmd {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = environment()
	cmd.Stdin = nil
	cmd.Stdout, cmd.Stderr = output, output
	cmd.WaitDelay = time.Second
	hideProcess(cmd)
	return cmd
}

type boundedOutput struct {
	sync.Mutex
	bytes.Buffer
	cancel   context.CancelFunc
	exceeded bool
}

func (w *boundedOutput) Write(data []byte) (int, error) {
	w.Lock()
	defer w.Unlock()
	if len(data) > 4<<20-w.Len() {
		w.exceeded = true
		w.cancel()
		return 0, errors.New("native observation output limit")
	}
	return w.Buffer.Write(data)
}
func runCommand(parent context.Context, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	output := &boundedOutput{cancel: cancel}
	err := command(ctx, path, args, output).Run()
	if err != nil || output.exceeded {
		return nil, errors.New("native observation did not complete within its bounds")
	}
	return output.Bytes(), nil
}

var endpointPattern = regexp.MustCompile(`https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:[/?#][^\s"<>\\]*)?`)

func reportedEndpoint(line, expected, mode string) string {
	for _, raw := range endpointPattern.FindAllString(line, -1) {
		u, err := url.Parse(raw)
		if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			continue
		}
		value := strings.TrimSuffix(u.String(), "/")
		if mode != "quick" {
			if value == expected {
				return value
			}
			continue
		}
		host := strings.TrimSuffix(u.Hostname(), ".trycloudflare.com")
		if u.Port() == "" && host != "" && !strings.Contains(host, ".") && u.Hostname() == host+".trycloudflare.com" {
			return value
		}
	}
	return ""
}
