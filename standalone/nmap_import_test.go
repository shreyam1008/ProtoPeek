package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNmapImportPreservesBoundedEvidenceAndDropsUntrustedSections(t *testing.T) {
	t.Parallel()
	fixture, err := os.ReadFile("testdata/nmap-basic.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	response := performNmapImport(t, context.Background(), fixture, "application/xml; charset=utf-8")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload NmapImportResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.HostCount != 1 || payload.PortCount != 2 || len(payload.Hosts) != 1 || !payload.Complete || payload.Completion != "success" {
		t.Fatalf("counts = %#v", payload)
	}
	host := payload.Hosts[0]
	if host.ID != 1 || host.Status.State != "up" || len(host.Addresses) != 1 || len(host.Hostnames) != 1 || len(host.Ports) != 2 {
		t.Fatalf("host = %#v", host)
	}
	probed := host.Ports[0]
	if probed.Port != 50051 || probed.Protocol != "tcp" || probed.State != "open" || probed.Reason != "syn-ack" {
		t.Fatalf("port = %#v", probed)
	}
	if probed.Service.Name != "grpc" || probed.Service.Product != "fixture" || probed.Service.Version != "1.2" || probed.Service.ExtraInfo != "test only" || probed.Service.Method != "probed" || probed.Service.Confidence != "10" || probed.Service.Tunnel != "ssl" {
		t.Fatalf("service = %#v", probed.Service)
	}
	if host.Ports[1].Service.Method != "table" {
		t.Fatalf("table hint = %#v", host.Ports[1].Service)
	}
	encoded := response.Body.String()
	for _, discarded := range []string{"--script", "discard-me", "not retained", "198.51.100.1"} {
		if strings.Contains(encoded, discarded) {
			t.Fatalf("response retained discarded input %q: %s", discarded, encoded)
		}
	}
}

func TestNmapImportRejectsMalformedDOCTYPEAndWrongRoot(t *testing.T) {
	t.Parallel()
	doctype, err := os.ReadFile("testdata/nmap-doctype.xml")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	for _, test := range []struct {
		name string
		xml  []byte
	}{
		{name: "malformed", xml: []byte(`<nmaprun scanner="nmap"><host></nmaprun>`)},
		{name: "doctype xxe", xml: doctype},
		{name: "wrong root", xml: []byte(`<scan/>`)},
		{name: "wrong scanner", xml: []byte(`<nmaprun scanner="other"/>`)},
		{name: "missing scanner", xml: []byte(`<nmaprun/>`)},
		{name: "empty", xml: nil},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			response := performNmapImport(t, context.Background(), test.xml, "application/xml")
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestNmapImportAcceptsOnlyBareDoctypeAndNeverFetchesStylesheets(t *testing.T) {
	t.Parallel()
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests.Add(1)
	}))
	defer server.Close()

	valid := `<?xml version="1.0"?><!DOCTYPE nmaprun><?xml-stylesheet href="` + server.URL + `/nmap.xsl" type="text/xsl"?><nmaprun scanner="nmap"/>`
	response := performNmapImport(t, context.Background(), []byte(valid), "application/xml")
	if response.Code != http.StatusOK {
		t.Fatalf("valid status = %d, body = %q", response.Code, response.Body.String())
	}
	for _, declaration := range []string{
		`<!DOCTYPE nmaprun SYSTEM "` + server.URL + `/nmap.dtd">`,
		`<!DOCTYPE nmaprun PUBLIC "nmap" "` + server.URL + `/nmap.dtd">`,
		`<!DOCTYPE nmaprun [<!ENTITY x "boom">]>`,
		`<!DOCTYPE nmaprun><!DOCTYPE nmaprun>`,
	} {
		body := `<?xml version="1.0"?>` + declaration + `<nmaprun scanner="nmap"/>`
		rejected := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if rejected.Code != http.StatusBadRequest {
			t.Fatalf("directive %q status = %d, body = %q", declaration, rejected.Code, rejected.Body.String())
		}
	}
	if requests.Load() != 0 {
		t.Fatalf("XML import made %d external request(s)", requests.Load())
	}
}

func TestNmapImportIgnoresNamespacedAndNestedSpoofs(t *testing.T) {
	t.Parallel()
	body := `<nmaprun scanner="nmap" xmlns:evil="urn:evil">` +
		`<evil:host><evil:address addr="203.0.113.8" addrtype="ipv4"/><evil:ports><evil:port protocol="tcp" portid="50051"/></evil:ports></evil:host>` +
		`<hosthint><host><address addr="203.0.113.9" addrtype="ipv4"/></host></hosthint>` +
		`<taskprogress><host><ports><port protocol="tcp" portid="443"/></ports></host></taskprogress>` +
		`</nmaprun>`
	response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload NmapImportResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.HostCount != 0 || payload.PortCount != 0 || len(payload.Hosts) != 0 {
		t.Fatalf("spoofed evidence retained: %#v", payload)
	}
}

func TestNmapImportValidatesAddressFamiliesAndPortProtocols(t *testing.T) {
	t.Parallel()
	for _, body := range []string{
		`<nmaprun scanner="nmap"><host><address addr="not-an-ip" addrtype="ipv4"/></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><address addr="2001:db8::1" addrtype="ipv4"/></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><address addr="::ffff:192.0.2.1" addrtype="ipv6"/></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><address addr="invalid" addrtype="mac"/></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><ports><port protocol="shell" portid="22"/></ports></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><ports><port protocol="tcp" portid="-1"/></ports></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><ports><port protocol="tcp" portid="65536"/></ports></host></nmaprun>`,
		`<nmaprun scanner="nmap"><host><ports><port protocol="ip" portid="256"/></ports></host></nmaprun>`,
	} {
		response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %q status = %d, response = %q", body, response.Code, response.Body.String())
		}
	}
}

func TestNmapImportAcceptsProtocolSpecificZeroAndMaximumValues(t *testing.T) {
	t.Parallel()
	body := `<nmaprun scanner="nmap"><host><ports>` +
		`<port protocol="tcp" portid="0"/><port protocol="udp" portid="0"/>` +
		`<port protocol="sctp" portid="65535"/><port protocol="ip" portid="0"/>` +
		`<port protocol="ip" portid="255"/></ports></host></nmaprun>`
	response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	var payload NmapImportResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.PortCount != 5 || payload.Hosts[0].Ports[4].Port != 255 {
		t.Fatalf("protocol ports = %#v", payload)
	}
}

func TestNmapImportDiscardsLargeUntrustedAttributes(t *testing.T) {
	t.Parallel()
	discarded := strings.Repeat("x", 64<<10)
	body := `<nmaprun scanner="nmap" args="` + discarded + `"><host><ports>` +
		`<port protocol="tcp" portid="443"><script id="fixture" output="` + discarded + `"/>` +
		`<service name="https"/></port></ports></host></nmaprun>`
	response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), discarded[:128]) {
		t.Fatal("discarded script or command attribute reached the JSON response")
	}

	retained := `<nmaprun scanner="nmap"><host><ports><port protocol="tcp" portid="443">` +
		`<service product="` + strings.Repeat("x", maxNmapRetainedAttributeBytes+1) + `"/>` +
		`</port></ports></host></nmaprun>`
	rejected := performNmapImport(t, context.Background(), []byte(retained), "application/xml")
	if rejected.Code != http.StatusBadRequest || !strings.Contains(rejected.Body.String(), "attribute product") {
		t.Fatalf("retained status = %d, body = %q", rejected.Code, rejected.Body.String())
	}
}

func TestNmapImportStructuralCaps(t *testing.T) {
	t.Parallel()

	t.Run("start elements", func(t *testing.T) {
		body := `<nmaprun scanner="nmap">` + strings.Repeat(`<x/>`, maxNmapXMLStartElements) + `</nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "start-element") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("tokens", func(t *testing.T) {
		body := `<nmaprun scanner="nmap">` + strings.Repeat(`<!--x-->`, maxNmapXMLTokens) + `</nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "token count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("attributes", func(t *testing.T) {
		body := `<nmaprun scanner="nmap"><x` + nmapAttributes(maxNmapXMLAttributesPerElement+1) + `/></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "attribute count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("aggregate attribute bytes", func(t *testing.T) {
		body := `<nmaprun scanner="nmap"><x ignored="` + strings.Repeat("a", maxNmapXMLAttributeElementBytes+1) + `"/></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(body), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "attribute bytes") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})
}

func TestNmapImportAcceptsExactStructuralBoundaries(t *testing.T) {
	if testing.Short() {
		t.Skip("exercises exact documented XML boundaries")
	}

	t.Run("body bytes", func(t *testing.T) {
		opening := `<nmaprun scanner="nmap">`
		closing := `</nmaprun>`
		body := opening + strings.Repeat(" ", maxNmapXMLBytes-len(opening)-len(closing)) + closing
		if len(body) != maxNmapXMLBytes {
			t.Fatalf("body size = %d", len(body))
		}
		assertNmapImportOK(t, []byte(body))
	})

	t.Run("depth", func(t *testing.T) {
		body := `<nmaprun scanner="nmap">` + strings.Repeat(`<x>`, maxNmapXMLDepth-1) +
			strings.Repeat(`</x>`, maxNmapXMLDepth-1) + `</nmaprun>`
		assertNmapImportOK(t, []byte(body))
	})

	t.Run("tokens", func(t *testing.T) {
		body := `<nmaprun scanner="nmap">` + strings.Repeat(`<!--x-->`, maxNmapXMLTokens-2) + `</nmaprun>`
		assertNmapImportOK(t, []byte(body))
	})

	t.Run("start elements", func(t *testing.T) {
		body := `<nmaprun scanner="nmap">` + strings.Repeat(`<x/>`, maxNmapXMLStartElements-1) + `</nmaprun>`
		assertNmapImportOK(t, []byte(body))
	})

	t.Run("attributes", func(t *testing.T) {
		body := `<nmaprun scanner="nmap"><x` + nmapAttributes(maxNmapXMLAttributesPerElement) + `/></nmaprun>`
		assertNmapImportOK(t, []byte(body))
	})

	t.Run("collections and retained values", func(t *testing.T) {
		addresses := strings.Repeat(`<address addr="192.0.2.1" addrtype="ipv4"/>`, maxNmapHostAddresses)
		hostnames := strings.Repeat(`<hostname name="`+strings.Repeat("h", maxNmapHostnameBytes)+`"/>`, maxNmapHostnames)
		body := `<nmaprun scanner="nmap"><host>` + addresses + `<hostnames>` + hostnames +
			`</hostnames><ports><port protocol="tcp" portid="443"><service product="` +
			strings.Repeat("p", maxNmapRetainedAttributeBytes) + `"/></port></ports></host></nmaprun>`
		assertNmapImportOK(t, []byte(body))
	})
}

func TestNmapImportBounds(t *testing.T) {
	t.Parallel()

	t.Run("body", func(t *testing.T) {
		response := performNmapImport(t, context.Background(), bytes.Repeat([]byte(" "), maxNmapXMLBytes+1), "application/xml")
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("body with unknown length", func(t *testing.T) {
		body := []byte(`<nmaprun scanner="nmap">` + strings.Repeat(" ", maxNmapXMLBytes) + `</nmaprun>`)
		request := httptest.NewRequest(http.MethodPost, "/api/nmap/import", bytes.NewReader(body))
		request.ContentLength = -1
		request.Header.Set("Content-Type", "application/xml")
		response := httptest.NewRecorder()
		NmapImportHandler().ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("depth", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap">` + strings.Repeat("<x>", maxNmapXMLDepth) + strings.Repeat("</x>", maxNmapXMLDepth) + "</nmaprun>"
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "depth") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("attribute", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap"><host><address addr="` + strings.Repeat("x", maxNmapRetainedAttributeBytes+1) + `" addrtype="ipv4"/></host></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "attribute") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("addresses", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap"><host>` + strings.Repeat(`<address addr="192.0.2.1" addrtype="ipv4"/>`, maxNmapHostAddresses+1) + `</host></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "address count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("hostnames", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap"><host><hostnames>` + strings.Repeat(`<hostname name="host.example"/>`, maxNmapHostnames+1) + `</hostnames></host></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "hostname count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})
}

func TestNmapImportHostAndPortCaps(t *testing.T) {
	if testing.Short() {
		t.Skip("exercises the full documented XML collection caps")
	}
	t.Parallel()

	t.Run("hosts", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap">` + strings.Repeat(`<host/>`, maxNmapHosts+1) + `</nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "host count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})

	t.Run("ports", func(t *testing.T) {
		xmlBody := `<nmaprun scanner="nmap"><host><ports>` + strings.Repeat(`<port protocol="tcp" portid="1"/>`, maxNmapPorts+1) + `</ports></host></nmaprun>`
		response := performNmapImport(t, context.Background(), []byte(xmlBody), "application/xml")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "port count") {
			t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
		}
	})
}

func TestNmapImportMethodContentTypeCancellationAndEmptyArrays(t *testing.T) {
	t.Parallel()
	handler := NmapImportHandler()

	method := httptest.NewRecorder()
	handler.ServeHTTP(method, httptest.NewRequest(http.MethodGet, "/api/nmap/import", nil))
	if method.Code != http.StatusMethodNotAllowed || method.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("method status = %d, Allow = %q", method.Code, method.Header().Get("Allow"))
	}
	wrongType := performNmapImport(t, context.Background(), []byte(`<nmaprun scanner="nmap"/>`), "text/xml")
	if wrongType.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content-type status = %d", wrongType.Code)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelled := performNmapImport(t, ctx, []byte(`<nmaprun scanner="nmap"/>`), "application/xml")
	if cancelled.Code != 499 {
		t.Fatalf("cancelled status = %d", cancelled.Code)
	}

	empty := performNmapImport(t, context.Background(), []byte(`<nmaprun scanner="nmap"><host/></nmaprun>`), "application/xml")
	if empty.Code != http.StatusOK {
		t.Fatalf("empty status = %d", empty.Code)
	}
	var raw map[string]any
	if err := json.Unmarshal(empty.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode empty response: %v", err)
	}
	host := raw["hosts"].([]any)[0].(map[string]any)
	for _, field := range []string{"addresses", "hostnames", "ports"} {
		if _, ok := host[field].([]any); !ok {
			t.Fatalf("%s = %#v, want JSON array", field, host[field])
		}
	}
	if raw["complete"] != false || raw["completion"] != "missing" {
		t.Fatalf("incomplete evidence = %#v", raw)
	}
	if empty.Header().Get("Cache-Control") != "no-store" || empty.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("security headers = %#v", empty.Header())
	}
}

func nmapAttributes(count int) string {
	var builder strings.Builder
	for index := range count {
		_, _ = builder.WriteString(` a`)
		_, _ = builder.WriteString(strconv.Itoa(index))
		_, _ = builder.WriteString(`="x"`)
	}
	return builder.String()
}

func performNmapImport(t *testing.T, ctx context.Context, body []byte, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/nmap/import", bytes.NewReader(body)).WithContext(ctx)
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	NmapImportHandler().ServeHTTP(response, request)
	return response
}

func assertNmapImportOK(t *testing.T, body []byte) {
	t.Helper()
	response := performNmapImport(t, context.Background(), body, "application/xml")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
}
