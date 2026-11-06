//go:build linux

package standalone

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
)

// This is opt-in: run only on the disposable CI runner after installing nmap
// and granting dumpcap only the capabilities it needs. It never targets any
// address other than the owned fixture on 127.0.0.1.
func TestNativeLinuxNmapAndCaptureLoopback(t *testing.T) {
	if os.Getenv("PROTOPEEK_NATIVE_NETWORK_INTEGRATION") != "1" {
		t.Skip("requires disposable Linux runner with nmap and capture permission")
	}
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("owned loopback fixture")) }))
	defer fixture.Close()
	_, portText, err := net.SplitHostPort(strings.TrimPrefix(fixture.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	api := httptest.NewServer(handler)
	defer api.Close()
	post := func(path string, body any) *http.Response {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequest(http.MethodPost, api.URL+path, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response, err := (&http.Client{Timeout: 40 * time.Second}).Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	scan := post("/api/nmap/scan", map[string]any{"target": "127.0.0.1", "ports": portText, "consent": true})
	defer scan.Body.Close()
	var found nmapScanResult
	if scan.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(scan.Body, 2048))
		t.Fatalf("nmap API status: %d: %s", scan.StatusCode, body)
	}
	if err := json.NewDecoder(scan.Body).Decode(&found); err != nil {
		t.Fatal(err)
	}
	if len(found.Inventory.Hosts) != 1 || len(found.Inventory.Hosts[0].Ports) != 1 || found.Inventory.Hosts[0].Ports[0].State != "open" || found.Inventory.Hosts[0].Ports[0].Port != port || found.Plan.Target != "127.0.0.1" {
		t.Fatalf("nmap did not observe owned listener: %+v", found.Inventory)
	}
	list := post("/api/packets/interfaces", map[string]any{})
	defer list.Body.Close()
	if list.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(list.Body, 2048))
		t.Fatalf("interfaces API status: %d: %s", list.StatusCode, body)
	}
	var interfaces []packetwork.Interface
	if err := json.NewDecoder(list.Body).Decode(&interfaces); err != nil {
		t.Fatal(err)
	}
	hasLoopback := false
	for _, iface := range interfaces {
		if iface.Name == "lo" {
			hasLoopback = true
		}
	}
	if !hasLoopback {
		t.Fatal("dumpcap did not enumerate Linux loopback")
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		client := &http.Client{Timeout: time.Second}
		ticker := time.NewTicker(75 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				r, err := client.Get(fixture.URL + "/owned")
				if err == nil {
					r.Body.Close()
				}
			}
		}
	}()
	defer func() { close(stop); <-done }()
	capture := post("/api/packets/capture", packetwork.CaptureRequest{Interface: "lo", Host: "127.0.0.1", Port: port, Seconds: 4, Packets: 100, Consent: true})
	defer capture.Body.Close()
	if capture.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(capture.Body, 2048))
		t.Fatalf("capture API status: %d: %s", capture.StatusCode, body)
	}
	raw, err := io.ReadAll(io.LimitReader(capture.Body, 2<<20))
	if err != nil {
		t.Fatal(err)
	}
	var report packetwork.Report
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("/owned")) || bytes.Contains(raw, []byte("owned loopback fixture")) || report.Reconstruction != nil {
		t.Fatal("default live capture leaked request target or payload")
	}
	matches := 0
	httpRequest, httpResponse := false, false
	for _, packet := range report.Packets {
		if packet.Transport == "TCP" && (int(packet.SourcePort) == port || int(packet.DestinationPort) == port) && packet.Source == "127.0.0.1" && packet.Destination == "127.0.0.1" {
			matches++
			if packet.Protocol == "HTTP" && strings.Contains(packet.Info, "GET") && strings.Contains(packet.Info, "request target omitted") {
				httpRequest = true
			}
			if packet.Protocol == "HTTP" && strings.Contains(packet.Info, "status 200") {
				httpResponse = true
			}
		}
	}
	if report.PacketCount == 0 || matches == 0 || !httpRequest || !httpResponse {
		t.Fatalf("missing decoded loopback HTTP evidence: count=%d matching=%d request=%t response=%t", report.PacketCount, matches, httpRequest, httpResponse)
	}
	fmt.Printf("real nmap open loopback port and real dumpcap decoded %d matching packets\n", matches)
}
