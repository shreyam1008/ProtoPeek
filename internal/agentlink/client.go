package agentlink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Connection struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func ConnectionPath() (string, error) {
	if p := os.Getenv("PROTOPEEK_AGENT_CONNECTION"); p != "" {
		if !filepath.IsAbs(p) {
			return "", errors.New("PROTOPEEK_AGENT_CONNECTION must be an absolute file path")
		}
		return p, nil
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "protopeek", "agent-connection.json"), nil
}

func SaveConnection(path string, c Connection) error {
	if err := ValidateURL(c.URL); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".agent-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		err = json.NewEncoder(f).Encode(c)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}

func LoadConnection() (Connection, error) {
	path, err := ConnectionPath()
	if err != nil {
		return Connection{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return Connection{}, errors.New("open the running ProtoPeek UI, then Settings > AI agents > Enable agent connection")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil || len(data) > 4096 {
		return Connection{}, errors.New("invalid agent connection file; pair again in the UI")
	}
	var c Connection
	if err := json.Unmarshal(data, &c); err != nil {
		return c, errors.New("invalid agent connection file")
	}
	if len(c.Token) != 64 {
		return c, errors.New("invalid agent token; pair again in the UI")
	}
	return c, ValidateURL(c.URL)
}

func ValidateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Port() == "" {
		return errors.New("agent connection must use an HTTP loopback URL with an explicit port")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return errors.New("agent connections require a literal loopback IP (127.0.0.1 or ::1)")
	}
	if strings.Contains(u.Path, "..") {
		return errors.New("invalid connection base path")
	}
	return nil
}

type Client struct {
	Connection Connection
	HTTP       *http.Client
}

func NewClient(c Connection) (*Client, error) {
	if err := ValidateURL(c.URL); err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil // Never send the local pairing token through an environment proxy.
	return &Client{c, &http.Client{Transport: transport, Timeout: 65 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("agent endpoint redirects are refused") }}}, nil
}

func (c *Client) Call(ctx context.Context, call Call) (Result, error) {
	if len(call.Arguments) == 0 {
		call.Arguments = json.RawMessage(`{}`)
	}
	if _, err := Lookup(call.Name, call.Arguments); err != nil {
		return Result{}, err
	}
	data, err := json.Marshal(call)
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.Connection.URL, "/")+"/api/agent/call", bytes.NewReader(data))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Connection.Token)
	response, err := c.HTTP.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("cannot reach paired workbench: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxOutput+8193))
	if err != nil {
		return Result{}, err
	}
	if len(body) > MaxOutput+8192 {
		return Result{}, errors.New("agent result exceeded its limit")
	}
	if response.StatusCode != http.StatusOK {
		if len(body) > 1024 {
			body = body[:1024]
		}
		return Result{}, fmt.Errorf("workbench: %s", strings.TrimSpace(string(body)))
	}
	var result Result
	if err := json.Unmarshal(body, &result); err != nil {
		return result, errors.New("workbench returned an invalid agent response")
	}
	return result, nil
}
