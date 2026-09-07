package standalone

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestSSEFramingAndLimits(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n", "\r"} {
		t.Run(strings.ReplaceAll(newline, "\r", "CR"), func(t *testing.T) {
			input := strings.Join([]string{"\ufeff: heartbeat", "id: 42", "event: update", "data: first", "data: second", "", "data:", "", "id: ignored\x00id", "data: next", "", "data: unfinished"}, newline)
			var events []streamEvent
			err := readSSE(strings.NewReader(input), func(event streamEvent) error { events = append(events, event); return nil })
			if err != nil || len(events) != 3 {
				t.Fatalf("events=%+v err=%v", events, err)
			}
			if events[0].Data != "first\nsecond" || events[0].ID != "42" || events[0].Event != "update" {
				t.Fatalf("wrong multiline event: %+v", events[0])
			}
			if events[1].Data != "" || events[1].ID != "42" || events[1].Event != "message" || events[2].ID != "42" {
				t.Fatalf("wrong event reset: %+v", events)
			}
		})
	}
	for _, input := range []string{"data: " + strings.Repeat("x", maxEventMessage+1) + "\n\n", strings.Repeat(": heartbeat\n", maxEventBytes/10+1), strings.Repeat("data: a\n\n", maxStreamEvents+1)} {
		if readSSE(strings.NewReader(input), func(streamEvent) error { return nil }) == nil {
			t.Fatal("expected bounded stream to stop")
		}
	}
}

func streamRequest(t *testing.T, ctx context.Context, endpoint, body, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(csrfHeaderName, token)
	req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: token})
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestWebSocketStreamEchoAndCleanup(t *testing.T) {
	disconnected := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		defer close(disconnected)
		for {
			kind, data, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			if conn.Write(r.Context(), kind, data) != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	mux := http.NewServeMux()
	registerEventStreams(mux)
	relay := httptest.NewServer(mux)
	defer relay.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	body, _ := json.Marshal(eventStreamInput{Protocol: "websocket", URL: "ws" + strings.TrimPrefix(upstream.URL, "http"), TimeoutMs: 5000})
	response := streamRequest(t, ctx, relay.URL+"/api/events/connect", string(body), "owner")
	defer response.Body.Close()
	decoder := json.NewDecoder(response.Body)
	var event streamEvent
	if err := decoder.Decode(&event); err != nil {
		t.Fatal(err)
	}
	if event.Kind != "open" || len(event.SessionID) != 32 || event.Status != 101 {
		t.Fatalf("unexpected open: %+v", event)
	}
	id := event.SessionID
	for _, sample := range []struct{ encoding, data string }{{"text", "hello"}, {"base64", "AP8B"}} {
		input, _ := json.Marshal(map[string]string{"sessionId": id, "encoding": sample.encoding, "data": sample.data})
		sent := streamRequest(t, ctx, relay.URL+"/api/events/send", string(input), "owner")
		sent.Body.Close()
		if sent.StatusCode != 204 {
			t.Fatalf("send status %d", sent.StatusCode)
		}
		if err := decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
		if event.Kind != "message" || event.Encoding != sample.encoding || event.Data != sample.data {
			t.Fatalf("unexpected echo: %+v", event)
		}
	}
	denied := streamRequest(t, ctx, relay.URL+"/api/events/send", `{"sessionId":"`+id+`","encoding":"text","data":"no"}`, "other-owner")
	denied.Body.Close()
	if denied.StatusCode != 404 {
		t.Fatalf("cross-owner send status %d", denied.StatusCode)
	}
	cancel()
	select {
	case <-disconnected:
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation did not close upstream socket")
	}
}

func TestStreamPolicyBeforeTraffic(t *testing.T) {
	mux := http.NewServeMux()
	registerEventStreams(mux)
	for _, test := range []struct {
		body, token string
		status      int
	}{
		{`{"protocol":"websocket","url":"ws://127.0.0.1:1"}`, "", 401},
		{`{"protocol":"websocket","url":"http://127.0.0.1:1"}`, "owner", 400},
		{`{"protocol":"sse","url":"https://user:pass@example.test"}`, "owner", 400},
		{`{"protocol":"sse","url":"https://example.test","timeoutMs":120001}`, "owner", 400},
		{`{"protocol":"websocket","url":"ws://example.test","headers":[{"name":"Sec-WebSocket-Key","value":"x"}]}`, "owner", 400},
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/events/connect", strings.NewReader(test.body))
		req.Header.Set(csrfHeaderName, test.token)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: test.token})
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, req)
		if recorder.Code != test.status {
			t.Fatalf("status %d expected %d: %s", recorder.Code, test.status, recorder.Body.String())
		}
	}
}

func TestSSEUpstreamHeadersAndNoRedirect(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/events", http.StatusFound)
			return
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Error("missing event-stream Accept")
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = io.WriteString(w, "data: hello\n\n")
	}))
	defer upstream.Close()
	mux := http.NewServeMux()
	registerEventStreams(mux)
	relay := httptest.NewServer(mux)
	defer relay.Close()
	for _, path := range []string{"/events", "/redirect"} {
		response := streamRequest(t, context.Background(), relay.URL+"/api/events/connect", `{"protocol":"sse","url":"`+upstream.URL+path+`"}`, "owner")
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if path == "/redirect" {
			if response.StatusCode != 502 {
				t.Fatal("followed redirect")
			}
			continue
		}
		if response.StatusCode != 200 || !strings.Contains(string(raw), `"data":"hello"`) || !strings.Contains(string(raw), `"kind":"closed"`) {
			t.Fatalf("bad stream: %s", raw)
		}
	}
}
