// agent-smoke runs a real local launcher and MCP subprocess in an isolated profile.
// It performs only offline subnet math and inventory reads; no remote service is contacted.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "agent smoke:", err)
		os.Exit(1)
	}
}

func run() (finalErr error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	root, err := os.MkdirTemp("", "protopeek-agent-smoke-")
	if err != nil {
		return err
	}
	defer func() {
		if err := os.RemoveAll(root); err != nil {
			finalErr = errors.Join(finalErr, fmt.Errorf("remove isolated profile: %w", err))
		}
		if _, err := os.Stat(root); !os.IsNotExist(err) {
			finalErr = errors.Join(finalErr, errors.New("isolated profile remains after cleanup"))
		}
	}()
	env := isolatedEnv(root)
	exe := filepath.Join(root, "pp")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	build := exec.CommandContext(ctx, "go", "build", "-mod=readonly", "-o", exe, "./cmd/pp")
	build.Stderr = os.Stderr
	if err = build.Run(); err != nil {
		return fmt.Errorf("build pp: %w", err)
	}
	callCLI := func(args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, exe, args...)
		cmd.Env = env
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("pp %s: %w (%s)", strings.Join(args, " "), err, stderr.String())
		}
		return out, nil
	}
	// Discovery is available before pairing and must not create its pairing file.
	search, err := callCLI("agent", "search", "subnet")
	if err != nil {
		return err
	}
	var matches []struct {
		Name   string `json:"name"`
		Writes bool   `json:"writes"`
	}
	if err = json.Unmarshal(search, &matches); err != nil {
		return err
	}
	found := false
	for _, v := range matches {
		if v.Name == "network_diagnose" && !v.Writes {
			found = true
		}
	}
	if !found {
		return errors.New("offline search did not find read-only network_diagnose")
	}
	httpSchema, err := callCLI("agent", "schema", "http_request")
	if err != nil {
		return err
	}
	var httpTool agentlink.Tool
	if err = json.Unmarshal(httpSchema, &httpTool); err != nil || !httpTool.Writes {
		return errors.New("offline schema must disclose that HTTP can use write methods")
	}
	schema, err := callCLI("agent", "schema", "network_diagnose")
	if err != nil {
		return err
	}
	var spec agentlink.Tool
	if err = json.Unmarshal(schema, &spec); err != nil {
		return err
	}
	if spec.Name != "network_diagnose" || !bytes.Contains(spec.InputSchema, []byte(`"subnet"`)) {
		return errors.New("offline schema missing subnet")
	}
	pairPath := filepath.Join(root, "pairing", "connection.json")
	if _, err = os.Stat(pairPath); !os.IsNotExist(err) {
		return errors.New("offline discovery created a pairing file")
	}
	fmt.Println("PASS offline search and schema before pairing")

	launcher := exec.CommandContext(ctx, exe, "-port=0", "-open-browser=false")
	launcher.Env = env
	launcher.Stderr = os.Stderr
	out, err := launcher.StdoutPipe()
	if err != nil {
		return err
	}
	if err = launcher.Start(); err != nil {
		return err
	}
	defer func() { _ = launcher.Process.Kill(); _ = launcher.Wait() }()
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(out)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "ProtoPeek available at ") {
				fields := strings.Fields(line)
				if len(fields) > 3 {
					select {
					case ready <- fields[3]:
					default:
					}
				}
			}
		}
	}()
	var base string
	select {
	case base = <-ready:
	case <-time.After(20 * time.Second):
		return errors.New("launcher did not announce its loopback URL")
	case <-ctx.Done():
		return ctx.Err()
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" {
		return errors.New("launcher did not bind literal loopback")
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}
	defer client.CloseIdleConnections()
	resp, err := client.Get(base)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("launcher homepage: %d", resp.StatusCode)
	}
	token := ""
	for _, cookie := range jar.Cookies(parsed) {
		if cookie.Name == "_protopeek_csrf_token" {
			token = cookie.Value
		}
	}
	if token == "" {
		return errors.New("launcher did not issue CSRF cookie")
	}
	control := func(action string) error {
		body, _ := json.Marshal(map[string]any{"action": action, "allowWrites": false})
		request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(base, "/")+"/api/agent/control", bytes.NewReader(body))
		if err != nil {
			return err
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("x-protopeek-csrf-token", token)
		request.Header.Set("Origin", strings.TrimRight(base, "/"))
		response, err := client.Do(request)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			return err
		}
		if response.StatusCode != 200 {
			return fmt.Errorf("agent %s: %d %s", action, response.StatusCode, data)
		}
		var state struct {
			Enabled     bool `json:"enabled"`
			AllowWrites bool `json:"allowWrites"`
		}
		if err = json.Unmarshal(data, &state); err != nil {
			return err
		}
		if state.Enabled != (action == "enable") || state.AllowWrites {
			return errors.New("unexpected pairing or write state")
		}
		return nil
	}
	if err = control("enable"); err != nil {
		return err
	}
	if _, err = os.Stat(pairPath); err != nil {
		return fmt.Errorf("pairing file: %w", err)
	}
	fmt.Println("PASS loopback read-only pairing")

	command := exec.CommandContext(ctx, exe, "mcp")
	command.Env = env
	command.Stderr = os.Stderr
	sdk := mcp.NewClient(&mcp.Implementation{Name: "protopeek-native-smoke", Version: "1"}, nil)
	session, err := sdk.Connect(ctx, &mcp.CommandTransport{Command: command, TerminateDuration: time.Second}, nil)
	if err != nil {
		return fmt.Errorf("MCP initialize: %w", err)
	}
	defer func() {
		if err := session.Close(); err != nil {
			finalErr = errors.Join(finalErr, fmt.Errorf("close MCP subprocess: %w", err))
		}
	}()
	list, err := session.ListTools(ctx, nil)
	if err != nil {
		return err
	}
	names := map[string]*mcp.Tool{}
	for _, tool := range list.Tools {
		names[tool.Name] = tool
	}
	if names["network_diagnose"] == nil || names["managed_tools"] == nil {
		return errors.New("MCP tools/list missing new tools")
	}
	fmt.Println("PASS real MCP initialize and tools/list")
	invoke := func(name string, args map[string]any) (*mcp.CallToolResult, agentlink.Result, error) {
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			return nil, agentlink.Result{}, err
		}
		if len(result.Content) == 0 {
			return result, agentlink.Result{}, errors.New("empty MCP result")
		}
		text, ok := result.Content[0].(*mcp.TextContent)
		if !ok {
			return result, agentlink.Result{}, errors.New("non-text MCP result")
		}
		var data agentlink.Result
		if err = json.Unmarshal([]byte(text.Text), &data); err != nil && !result.IsError {
			return result, data, err
		}
		return result, data, nil
	}
	result, diagnostic, err := invoke("network_diagnose", map[string]any{"mode": "subnet", "target": "192.0.2.0/24"})
	if err != nil {
		return err
	}
	var evidence struct {
		Outcome string `json:"outcome"`
		Subnet  struct {
			Network string `json:"network"`
			Total   string `json:"totalAddresses"`
			Usable  string `json:"usableHosts"`
		} `json:"subnet"`
	}
	if err = json.Unmarshal(diagnostic.Data, &evidence); err != nil {
		return err
	}
	if result.IsError || diagnostic.State != "completed" || evidence.Subnet.Network != "192.0.2.0" || evidence.Subnet.Total != "256" || evidence.Subnet.Usable != "254" {
		return fmt.Errorf("unexpected subnet evidence: %+v", evidence)
	}
	invalid, _, err := invoke("network_diagnose", map[string]any{"mode": "subnet", "target": "not-a-cidr"})
	if err != nil {
		return err
	}
	if !invalid.IsError {
		return errors.New("invalid CIDR was accepted")
	}
	invalid, _, err = invoke("network_diagnose", map[string]any{"mode": "subnet"})
	if err != nil {
		return err
	}
	if !invalid.IsError {
		return errors.New("missing target was accepted")
	}
	denied, _, err := invoke("download_start_engine", map[string]any{})
	if err != nil {
		return err
	}
	if !denied.IsError {
		return errors.New("write action was accepted in read-only pairing")
	}
	fmt.Println("PASS offline subnet evidence, invalid inputs and read-only enforcement")
	result, inventory, err := invoke("managed_tools", map[string]any{})
	if err != nil {
		return err
	}
	if result.IsError || inventory.State != "completed" {
		return errors.New("managed_tools failed")
	}
	native, err := callCLI("extensions", "status", "--json")
	if err != nil {
		return err
	}
	var fromAgent, fromCLI any
	if err = json.Unmarshal(inventory.Data, &fromAgent); err != nil {
		return err
	}
	if err = json.Unmarshal(native, &fromCLI); err != nil {
		return err
	}
	if !reflect.DeepEqual(fromAgent, fromCLI) {
		return errors.New("managed_tools differs from native CLI inventory")
	}
	fmt.Println("PASS managed_tools matches native CLI inventory")
	if err = control("disable"); err != nil {
		return err
	}
	revoked, _, err := invoke("managed_tools", map[string]any{})
	if err != nil {
		return err
	}
	if !revoked.IsError {
		return errors.New("revoked pairing remained usable")
	}
	fmt.Println("PASS pairing revocation rejects MCP calls")
	return nil
}

func isolatedEnv(root string) []string {
	values := map[string]string{"HOME": filepath.Join(root, "home"), "USERPROFILE": filepath.Join(root, "home"), "APPDATA": filepath.Join(root, "roaming"), "LOCALAPPDATA": filepath.Join(root, "local"), "XDG_CONFIG_HOME": filepath.Join(root, "config"), "XDG_CACHE_HOME": filepath.Join(root, "cache"), "PROTOPEEK_AGENT_CONNECTION": filepath.Join(root, "pairing", "connection.json")}
	for key, path := range values {
		if key != "PROTOPEEK_AGENT_CONNECTION" {
			_ = os.MkdirAll(path, 0700)
		}
	}
	env := []string{}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, ok := values[strings.ToUpper(key)]; !ok {
			env = append(env, entry)
		}
	}
	for key, value := range values {
		env = append(env, key+"="+value)
	}
	return env
}
