//go:build linux

package standalone

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/netpath"
)

func TestHandlerPathTraceRunsNativeLinuxLoopbackObservation(t *testing.T) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("reserve loopback UDP port: %v", err)
	}
	port := listener.LocalAddr().(*net.UDPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("close reserved UDP port: %v", err)
	}

	handler := Handler(nil, "", nil, nil)
	cookie := workspaceUploadCSRFCookie(t, handler)
	body, err := json.Marshal(netpath.Request{
		Destination:       "127.0.0.1",
		Family:            "ipv4",
		Method:            "auto",
		DestinationPort:   port,
		MaxHops:           1,
		ProbesPerHop:      1,
		PerProbeTimeoutMS: 250,
		WallTimeoutMS:     1000,
		Consent:           netpath.Consent{ActiveProbe: true},
	})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/path/trace", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload netpath.Response
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Status != "complete" || !payload.Reached || payload.Termination != "reached" || payload.Backend != "linux-udp-error-queue" || payload.Method != "udp" {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Resolution.PinnedAddress != "127.0.0.1" || payload.Route.Status != "ok" {
		t.Fatalf("resolution/route = %#v / %#v", payload.Resolution, payload.Route)
	}
	if len(payload.Hops) != 1 || len(payload.Hops[0].Samples) != 1 || payload.Hops[0].Samples[0].Status != "reply" || payload.Hops[0].Samples[0].RTTMillis == nil {
		t.Fatalf("hops = %#v", payload.Hops)
	}
}
