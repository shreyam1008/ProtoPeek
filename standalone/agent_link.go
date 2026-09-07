package standalone

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/agentlink"
	"github.com/shreyam1008/ProtoPeek/internal/portscan"
)

const agentHistoryLimit = 32
const agentReceiptBytes = 64 << 10

type agentReceipt struct {
	ID         string    `json:"id"`
	Tool       string    `json:"tool"`
	Route      string    `json:"route"`
	State      string    `json:"state"`
	StartedAt  time.Time `json:"startedAt"`
	DurationMS int64     `json:"durationMs"`
	Status     int       `json:"status"`
	result     agentlink.Result
	cancel     context.CancelFunc
}
type agentState struct {
	Executable     string           `json:"executable"`
	ConnectionFile string           `json:"connectionFile"`
	Instance       string           `json:"instance"`
	Enabled        bool             `json:"enabled"`
	AllowWrites    bool             `json:"allowWrites"`
	Revision       uint64           `json:"revision"`
	Records        []agentReceipt   `json:"records"`
	Tools          []agentlink.Tool `json:"tools"`
}
type agentManager struct {
	instance       string
	mu             sync.Mutex
	token          string
	allowWrites    bool
	revision       uint64
	changed        chan struct{}
	records        []*agentReceipt
	active         int
	watchers       chan struct{}
	mux            http.Handler
	version        string
	basePath       string
	connectionPath func() (string, error)
}

func registerAgentLink(mux *http.ServeMux, version, basePath string) *agentManager {
	instance, err := randomSessionID()
	if err != nil {
		panic(err)
	}
	m := &agentManager{changed: make(chan struct{}), watchers: make(chan struct{}, 4), mux: mux, version: version, basePath: basePath, connectionPath: agentlink.ConnectionPath}
	m.instance = instance
	mux.HandleFunc("/api/agent/state", m.stateHandler)
	mux.HandleFunc("/api/agent/control", m.controlHandler)
	mux.HandleFunc("/api/agent/result", m.resultHandler)
	mux.HandleFunc("/api/agent/call", m.callHandler)
	return m
}

func agentLocal(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		return false
	}
	host, _, err = net.SplitHostPort(r.Host)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "http" || u.Host != r.Host || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return false
		}
	}
	return true
}
func agentHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}
func agentAdmin(w http.ResponseWriter, r *http.Request, method string) bool {
	agentHeaders(w)
	if r.Method != method {
		w.Header().Set("Allow", method)
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return false
	}
	if !agentLocal(r) || !validCSRF(r) {
		http.Error(w, "local browser session required", http.StatusForbidden)
		return false
	}
	return true
}
func (m *agentManager) notifyLocked() {
	m.revision++
	close(m.changed)
	m.changed = make(chan struct{})
}
func (m *agentManager) snapshot() agentState {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := agentState{Instance: m.instance, Enabled: m.token != "", AllowWrites: m.allowWrites, Revision: m.revision, Records: make([]agentReceipt, 0, len(m.records)), Tools: agentlink.Tools()}
	state.Executable, _ = os.Executable()
	state.ConnectionFile, _ = m.connectionPath()
	for i := len(m.records) - 1; i >= 0; i-- {
		state.Records = append(state.Records, *m.records[i])
	}
	return state
}
func (m *agentManager) stateHandler(w http.ResponseWriter, r *http.Request) {
	if !agentAdmin(w, r, http.MethodGet) {
		return
	}
	if raw := r.URL.Query().Get("after"); raw != "" {
		after, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			http.Error(w, "invalid revision", http.StatusBadRequest)
			return
		}
		select {
		case m.watchers <- struct{}{}:
			defer func() { <-m.watchers }()
		default:
			http.Error(w, "too many activity viewers", http.StatusTooManyRequests)
			return
		}
		m.mu.Lock()
		revision, ch := m.revision, m.changed
		m.mu.Unlock()
		if after == revision {
			timer := time.NewTimer(25 * time.Second)
			defer timer.Stop()
			select {
			case <-r.Context().Done():
				return
			case <-ch:
			case <-timer.C:
			}
		}
	}
	_ = json.NewEncoder(w).Encode(m.snapshot())
}
func (m *agentManager) controlHandler(w http.ResponseWriter, r *http.Request) {
	if !agentAdmin(w, r, http.MethodPost) {
		return
	}
	var input struct {
		Action      string `json:"action"`
		ID          string `json:"id"`
		AllowWrites bool   `json:"allowWrites"`
	}
	if !decodeStrictTransferJSON(w, r, 2048, &input) {
		return
	}
	m.mu.Lock()
	switch input.Action {
	case "enable":
		token := make([]byte, 32)
		if _, err := rand.Read(token); err != nil {
			m.mu.Unlock()
			http.Error(w, "could not generate pairing token", http.StatusInternalServerError)
			return
		}
		path, err := m.connectionPath()
		if err == nil {
			err = agentlink.SaveConnection(path, agentlink.Connection{URL: "http://" + r.Host + strings.TrimRight(m.basePath, "/"), Token: hex.EncodeToString(token)})
		}
		if err != nil {
			m.mu.Unlock()
			http.Error(w, "could not save local agent pairing: "+err.Error(), http.StatusInternalServerError)
			return
		}
		for _, record := range m.records {
			if record.cancel != nil {
				record.cancel()
			}
		}
		m.token = hex.EncodeToString(token)
		m.allowWrites = input.AllowWrites
	case "disable":
		m.token = ""
		m.allowWrites = false
		for _, record := range m.records {
			if record.cancel != nil {
				record.cancel()
			}
		}
	case "cancel":
		found := false
		for _, record := range m.records {
			if record.ID == input.ID && record.cancel != nil {
				record.cancel()
				found = true
			}
		}
		if !found {
			m.mu.Unlock()
			http.Error(w, "active operation not found", http.StatusNotFound)
			return
		}
	case "clear":
		kept := m.records[:0]
		for _, record := range m.records {
			if record.cancel != nil {
				kept = append(kept, record)
			}
		}
		clear(m.records[len(kept):])
		m.records = kept
	default:
		m.mu.Unlock()
		http.Error(w, "unknown agent control", http.StatusBadRequest)
		return
	}
	m.notifyLocked()
	m.mu.Unlock()
	_ = json.NewEncoder(w).Encode(m.snapshot())
}
func (m *agentManager) resultHandler(w http.ResponseWriter, r *http.Request) {
	if !agentAdmin(w, r, http.MethodGet) {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, record := range m.records {
		if record.ID == r.URL.Query().Get("id") {
			_ = json.NewEncoder(w).Encode(record.result)
			return
		}
	}
	http.Error(w, "activity result expired or cleared", http.StatusNotFound)
}

func (m *agentManager) callHandler(w http.ResponseWriter, r *http.Request) {
	agentHeaders(w)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if !agentLocal(r) {
		http.Error(w, "agent API only accepts local loopback requests", http.StatusForbidden)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	m.mu.Lock()
	authorized := m.token != "" && subtle.ConstantTimeCompare([]byte(token), []byte(m.token)) == 1
	m.mu.Unlock()
	if !authorized {
		http.Error(w, "agent connection disabled or expired; enable it in Settings > AI agents", http.StatusUnauthorized)
		return
	}
	var call agentlink.Call
	if !decodeStrictTransferJSON(w, r, agentlink.MaxInput, &call) {
		return
	}
	if len(call.Arguments) == 0 {
		call.Arguments = json.RawMessage(`{}`)
	}
	tool, err := agentlink.Lookup(call.Name, call.Arguments)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writes := tool.Writes
	if tool.Name == "http_request" {
		var args HTTPRequest
		_ = json.Unmarshal(call.Arguments, &args)
		writes = args.Method != "GET" && args.Method != "HEAD" && args.Method != "OPTIONS"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	id, err := randomSessionID()
	if err != nil {
		http.Error(w, "could not allocate operation", http.StatusInternalServerError)
		return
	}
	receipt := &agentReceipt{ID: id, Tool: tool.Name, Route: tool.Route, State: "running", StartedAt: time.Now().UTC(), cancel: cancel}
	m.mu.Lock()
	if m.token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(m.token)) != 1 {
		m.mu.Unlock()
		http.Error(w, "agent connection was revoked", http.StatusUnauthorized)
		return
	}
	if writes && !m.allowWrites {
		m.mu.Unlock()
		http.Error(w, "write actions are off; enable them in AI agents for non-read HTTP methods and download controls", http.StatusForbidden)
		return
	}
	if m.active >= 2 {
		m.mu.Unlock()
		http.Error(w, "two agent operations are already running", http.StatusTooManyRequests)
		return
	}
	if len(m.records) >= agentHistoryLimit {
		for i, old := range m.records {
			if old.cancel == nil {
				m.records = append(m.records[:i], m.records[i+1:]...)
				break
			}
		}
	}
	m.records = append(m.records, receipt)
	m.active++
	m.notifyLocked()
	m.mu.Unlock()
	result := m.execute(ctx, tool, call.Arguments)
	result.ID = id
	result.State = "completed"
	if result.Status >= 400 {
		result.State = "failed"
	}
	if ctx.Err() != nil {
		result.State = "cancelled"
		result.Status = 499
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.State = "timed_out"
			result.Status = 504
		}
	}
	stored := result
	if len(stored.Data) > agentReceiptBytes {
		stored.Preview = string(stored.Data[:agentReceiptBytes])
		stored.Data = nil
		stored.Truncated = true
	}
	if len(stored.Preview) > agentReceiptBytes {
		stored.Preview = stored.Preview[:agentReceiptBytes]
		stored.Truncated = true
	}
	m.mu.Lock()
	receipt.State = result.State
	receipt.Status = result.Status
	receipt.DurationMS = time.Since(receipt.StartedAt).Milliseconds()
	receipt.result = stored
	receipt.cancel = nil
	m.active--
	m.notifyLocked()
	m.mu.Unlock()
	_ = json.NewEncoder(w).Encode(result)
}

func (m *agentManager) execute(ctx context.Context, tool agentlink.Tool, input json.RawMessage) agentlink.Result {
	if tool.Name == "workbench_info" {
		data, _ := json.Marshal(map[string]any{"version": m.version, "guide": agentlink.Guide, "tools": agentlink.Tools(), "activityRoute": "/agents"})
		return agentlink.Result{Status: 200, Data: data}
	}
	endpoint := tool.Endpoint
	if tool.Name == "scan_ports" {
		var args portscan.Request
		_ = json.Unmarshal(input, &args)
		if args.Family == "" {
			args.Family = "auto"
		}
		if args.TimeoutMS == 0 {
			args.TimeoutMS = 350
		}
		input, _ = json.Marshal(args)
	}
	if tool.Method == http.MethodGet || tool.Name == "tailnet_inspect" || tool.Name == "download_start_engine" {
		input = nil // These existing endpoints require an absent body, not an empty JSON object.
	}
	if tool.Name == "download_add" {
		var args struct {
			URL        string `json:"url"`
			OutputName string `json:"outputName"`
			SHA256     string `json:"expectedSHA256"`
		}
		_ = json.Unmarshal(input, &args)
		input, _ = json.Marshal(map[string]any{"sources": []string{args.URL}, "outputName": args.OutputName, "sha256": args.SHA256})
	}
	if tool.Name == "download_action" {
		var args struct {
			ID     string `json:"id"`
			Action string `json:"action"`
		}
		_ = json.Unmarshal(input, &args)
		endpoint = "/api/transfers/" + args.Action
		input, _ = json.Marshal(map[string]string{"id": args.ID})
	}
	request, _ := http.NewRequestWithContext(ctx, tool.Method, endpoint, bytes.NewReader(input))
	request.RemoteAddr = "127.0.0.1:0"
	request.Header.Set("Content-Type", "application/json")
	// An already authenticated, allowlisted internal dispatch. It traverses the
	// existing operation handlers and their admission/validation limits.
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "agent-internal"})
	request.Header.Set(csrfHeaderName, "agent-internal")
	writer := &agentResponseWriter{header: make(http.Header)}
	m.mux.ServeHTTP(writer, request)
	if writer.status == 0 {
		writer.status = 200
	}
	result := agentlink.Result{Status: writer.status, Truncated: writer.overflow}
	if writer.overflow || !json.Valid(writer.body.Bytes()) {
		result.Preview = writer.body.String()
		if len(result.Preview) > agentReceiptBytes {
			result.Preview = result.Preview[:agentReceiptBytes]
			result.Truncated = true
		}
	} else {
		result.Data = writer.body.Bytes()
	}
	return result
}

// Bound retained output even when an underlying handler streams or ignores a
// failed write. Headers and status still remain available as evidence.
type agentResponseWriter struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (w *agentResponseWriter) Header() http.Header { return w.header }
func (w *agentResponseWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
}
func (w *agentResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	remaining := agentlink.MaxOutput/2 - w.body.Len()
	if len(data) > remaining {
		w.overflow = true
		if remaining > 0 {
			_, _ = w.body.Write(data[:remaining])
		}
		return remaining, io.ErrShortBuffer
	}
	return w.body.Write(data)
}
