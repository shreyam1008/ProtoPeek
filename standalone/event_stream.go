package standalone

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
	"golang.org/x/net/http/httpguts"
)

const maxEventMessage = 64 << 10
const maxEventBytes = 2 << 20
const maxStreamEvents = 500

type eventStreamInput struct {
	Protocol     string       `json:"protocol"`
	URL          string       `json:"url"`
	Headers      []HTTPHeader `json:"headers"`
	Subprotocols []string     `json:"subprotocols"`
	TimeoutMs    int64        `json:"timeoutMs"`
}

type streamEvent struct {
	Kind        string `json:"kind"`
	SessionID   string `json:"sessionId,omitempty"`
	ElapsedMs   int64  `json:"elapsedMs"`
	Data        string `json:"data,omitempty"`
	Encoding    string `json:"encoding,omitempty"`
	Event       string `json:"event,omitempty"`
	ID          string `json:"id,omitempty"`
	Detail      string `json:"detail,omitempty"`
	Status      int    `json:"status,omitempty"`
	Subprotocol string `json:"subprotocol,omitempty"`
}

type liveWebSocket struct {
	conn  *websocket.Conn
	owner string
	mu    sync.Mutex
	sent  int
}

type eventStreams struct {
	mu      sync.Mutex
	sockets map[string]*liveWebSocket
}

func registerEventStreams(mux *http.ServeMux) {
	streams := &eventStreams{sockets: make(map[string]*liveWebSocket)}
	limiter := newAdmissionLimiter(2)
	mux.HandleFunc("/api/events/connect", func(w http.ResponseWriter, r *http.Request) {
		if !validateAdmittedPOST(w, r) {
			return
		}
		limiter.serveHTTP("Event streams", w, r, http.HandlerFunc(streams.connect))
	})
	mux.HandleFunc("/api/events/send", func(w http.ResponseWriter, r *http.Request) {
		if validateAdmittedPOST(w, r) {
			streams.send(w, r)
		}
	})
}

func validateEventStream(input eventStreamInput) (*url.URL, http.Header, time.Duration, error) {
	target, err := url.Parse(input.URL)
	if err != nil || len(input.URL) > 8192 || target.Hostname() == "" || target.User != nil || target.Fragment != "" {
		return nil, nil, 0, errors.New("enter an absolute URL without embedded credentials or a fragment")
	}
	if (input.Protocol == "websocket" && target.Scheme != "ws" && target.Scheme != "wss") ||
		(input.Protocol == "sse" && target.Scheme != "http" && target.Scheme != "https") ||
		(input.Protocol != "websocket" && input.Protocol != "sse") {
		return nil, nil, 0, errors.New("WebSocket uses ws:// or wss://; SSE uses http:// or https://")
	}
	if len(input.Headers) > 32 || len(input.Subprotocols) > 8 {
		return nil, nil, 0, errors.New("too many headers or subprotocols")
	}
	headers := make(http.Header)
	for _, h := range input.Headers {
		name := strings.TrimSpace(h.Name)
		if len(name) > 256 || len(h.Value) > 8192 || !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(h.Value) {
			return nil, nil, 0, errors.New("invalid or oversized header")
		}
		switch strings.ToLower(name) {
		case "host", "connection", "upgrade", "content-length", "transfer-encoding", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions":
			return nil, nil, 0, errors.New("transport-managed headers cannot be overridden")
		}
		headers.Add(name, h.Value)
	}
	for _, protocol := range input.Subprotocols {
		if len(protocol) > 128 || !httpguts.ValidHeaderFieldName(protocol) {
			return nil, nil, 0, errors.New("invalid WebSocket subprotocol")
		}
	}
	timeout := 60 * time.Second
	if input.TimeoutMs != 0 {
		if input.TimeoutMs < 100 || input.TimeoutMs > 120000 {
			return nil, nil, 0, errors.New("Session duration must be between 0.1 and 120 seconds")
		}
		timeout = time.Duration(input.TimeoutMs) * time.Millisecond
	}
	return target, headers, timeout, nil
}

func eventEmitter(w http.ResponseWriter) func(streamEvent) error {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	start := time.Now()
	controller := http.NewResponseController(w)
	encoder := json.NewEncoder(w)
	return func(event streamEvent) error {
		event.ElapsedMs = time.Since(start).Milliseconds()
		_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := encoder.Encode(event); err != nil {
			return err
		}
		return controller.Flush()
	}
}

func (streams *eventStreams) connect(w http.ResponseWriter, r *http.Request) {
	var input eventStreamInput
	if !decodeJSONRequest(w, r, 384<<10, &input) {
		return
	}
	target, headers, duration, err := validateEventStream(input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), duration)
	defer cancel()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxResponseHeaderBytes = 64 << 10
	transport.ResponseHeaderTimeout = 10 * time.Second
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if input.Protocol == "sse" {
		streams.sse(ctx, w, target, headers, client)
		return
	}
	conn, _, err := websocket.Dial(ctx, target.String(), &websocket.DialOptions{HTTPClient: client, HTTPHeader: headers, Subprotocols: input.Subprotocols, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		http.Error(w, "WebSocket connection failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(maxEventMessage)
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		http.Error(w, "Could not create a session", http.StatusInternalServerError)
		return
	}
	id := hex.EncodeToString(token)
	cookie, _ := r.Cookie(csrfCookieName)
	owner := ""
	if cookie != nil {
		owner = cookie.Value
	}
	streams.mu.Lock()
	streams.sockets[id] = &liveWebSocket{conn: conn, owner: owner}
	streams.mu.Unlock()
	defer func() { streams.mu.Lock(); delete(streams.sockets, id); streams.mu.Unlock() }()
	emit := eventEmitter(w)
	if emit(streamEvent{Kind: "open", SessionID: id, Subprotocol: conn.Subprotocol(), Status: 101}) != nil {
		return
	}
	bytes := 0
	for count := 0; count < maxStreamEvents; count++ {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			detail := "Connection closed"
			status := int(websocket.CloseStatus(err))
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				detail = "Session duration reached"
			} else if ctx.Err() != nil {
				detail = "Request cancelled"
			} else if status < 0 {
				detail = "Connection ended: " + err.Error()
			} else {
				var closeError websocket.CloseError
				if errors.As(err, &closeError) && closeError.Reason != "" {
					detail += ": " + closeError.Reason
				}
			}
			if status < 0 {
				status = 0
			}
			_ = emit(streamEvent{Kind: "closed", Status: status, Detail: detail})
			return
		}
		bytes += len(data)
		if bytes > maxEventBytes {
			_ = emit(streamEvent{Kind: "limit", Detail: "Stopped at the 2 MiB session limit"})
			return
		}
		event := streamEvent{Kind: "message", Data: string(data), Encoding: "text"}
		if kind == websocket.MessageBinary {
			event.Encoding = "base64"
			event.Data = base64.StdEncoding.EncodeToString(data)
		}
		if err := emit(event); err != nil {
			return
		}
	}
	_ = emit(streamEvent{Kind: "limit", Detail: "Stopped after 500 received messages"})
}

func (streams *eventStreams) send(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SessionID string `json:"sessionId"`
		Data      string `json:"data"`
		Encoding  string `json:"encoding"`
	}
	if !decodeJSONRequest(w, r, 384<<10, &input) {
		return
	}
	if len(input.SessionID) != 32 {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}
	data := []byte(input.Data)
	kind := websocket.MessageText
	if input.Encoding == "base64" {
		var err error
		data, err = base64.StdEncoding.DecodeString(input.Data)
		if err != nil {
			http.Error(w, "Invalid base64 message", http.StatusBadRequest)
			return
		}
		kind = websocket.MessageBinary
	} else if input.Encoding != "text" || !utf8.Valid(data) {
		http.Error(w, "Invalid message encoding", http.StatusBadRequest)
		return
	}
	if len(data) > maxEventMessage {
		http.Error(w, "Message exceeds 64 KiB", http.StatusRequestEntityTooLarge)
		return
	}
	streams.mu.Lock()
	socket := streams.sockets[input.SessionID]
	streams.mu.Unlock()
	cookie, _ := r.Cookie(csrfCookieName)
	if socket == nil || cookie == nil || socket.owner != cookie.Value {
		http.Error(w, "Session is closed or unavailable", http.StatusNotFound)
		return
	}
	if !socket.mu.TryLock() {
		http.Error(w, "A send is already in progress", http.StatusTooManyRequests)
		return
	}
	defer socket.mu.Unlock()
	if socket.sent >= 200 {
		http.Error(w, "Session send limit reached; reconnect to continue", http.StatusTooManyRequests)
		return
	}
	socket.sent++
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := socket.conn.Write(ctx, kind, data); err != nil {
		http.Error(w, "Message could not be sent: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (streams *eventStreams) sse(ctx context.Context, w http.ResponseWriter, target *url.URL, headers http.Header, client *http.Client) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, "Invalid event-stream request", http.StatusBadRequest)
		return
	}
	request.Header = headers
	request.Header.Set("Accept", "text/event-stream")
	response, err := client.Do(request)
	if err != nil {
		http.Error(w, "SSE connection failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != 200 || mediaType != "text/event-stream" {
		http.Error(w, fmt.Sprintf("Expected HTTP 200 text/event-stream; received %d %s", response.StatusCode, mediaType), http.StatusBadGateway)
		return
	}
	emit := eventEmitter(w)
	if emit(streamEvent{Kind: "open", Status: response.StatusCode}) != nil {
		return
	}
	err = readSSE(response.Body, emit)
	detail := "Server ended the event stream"
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		detail = "Session duration reached"
	} else if ctx.Err() != nil {
		detail = "Request cancelled"
	} else if err != nil {
		detail = err.Error()
	}
	_ = emit(streamEvent{Kind: "closed", Detail: detail})
}

// readSSE keeps multiline data and event IDs, accepts LF/CRLF/CR, ignores comments and
// retry hints (the inspector never reconnects automatically), and bounds idle traffic too.
func readSSE(reader io.Reader, emit func(streamEvent) error) error {
	limited := &io.LimitedReader{R: reader, N: maxEventBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxEventMessage+2)
	scanner.Split(splitSSELine)
	event := streamEvent{Kind: "message", Encoding: "text"}
	var data strings.Builder
	count := 0
	first := true
	for scanner.Scan() {
		line := scanner.Text()
		if first {
			line = strings.TrimPrefix(line, "\ufeff")
			first = false
		}
		if limited.N <= 0 {
			return errors.New("stopped at the 2 MiB stream limit")
		}
		if line == "" {
			if data.Len() > 0 {
				event.Data = strings.TrimSuffix(data.String(), "\n")
				if event.Event == "" {
					event.Event = "message"
				}
				if err := emit(event); err != nil {
					return err
				}
				count++
				if count >= maxStreamEvents {
					return errors.New("stopped after 500 events")
				}
			}
			data.Reset()
			event.Event = ""
			continue
		}
		name, value, _ := strings.Cut(line, ":")
		value = strings.TrimPrefix(value, " ")
		switch name {
		case "data":
			if data.Len()+len(value)+1 > maxEventMessage {
				return errors.New("event exceeds 64 KiB")
			}
			data.WriteString(value)
			data.WriteByte('\n')
		case "event":
			if len(value) > 8192 {
				return errors.New("event name exceeds 8 KiB")
			}
			event.Event = value
		case "id":
			if len(value) > 8192 {
				return errors.New("event ID exceeds 8 KiB")
			}
			if !strings.ContainsRune(value, 0) {
				event.ID = value
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("event stream read failed: %w", err)
	}
	if limited.N <= 0 {
		return errors.New("stopped at the 2 MiB stream limit")
	}
	return nil
}

func splitSSELine(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for index, value := range data {
		if value == '\n' {
			return index + 1, data[:index], nil
		}
		if value == '\r' {
			if index+1 == len(data) && !atEOF {
				return 0, nil, nil
			}
			advance = index + 1
			if advance < len(data) && data[advance] == '\n' {
				advance++
			}
			return advance, data[:index], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
