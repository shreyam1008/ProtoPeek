package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/thispc"
)

type fakeThisPCService struct {
	capabilities  thispc.Capabilities
	snapshot      thispc.Snapshot
	activity      thispc.Activity
	traffic       thispc.TrafficSample
	public        thispc.PublicIdentity
	activityCalls atomic.Int32
	publicCalls   atomic.Int32
	lastDuration  time.Duration
	lastFamilies  []string
}

func (service *fakeThisPCService) Capabilities(context.Context) thispc.Capabilities {
	return service.capabilities
}

func (service *fakeThisPCService) Snapshot(context.Context) (thispc.Snapshot, error) {
	return service.snapshot, nil
}

func (service *fakeThisPCService) Activity(context.Context) (thispc.Activity, error) {
	service.activityCalls.Add(1)
	return service.activity, nil
}

func (service *fakeThisPCService) SampleTraffic(_ context.Context, duration time.Duration) (thispc.TrafficSample, error) {
	service.lastDuration = duration
	return service.traffic, nil
}

func (service *fakeThisPCService) PublicIdentity(_ context.Context, families []string) (thispc.PublicIdentity, error) {
	service.publicCalls.Add(1)
	service.lastFamilies = append([]string(nil), families...)
	return service.public, nil
}

func newFakeThisPCService() *fakeThisPCService {
	return &fakeThisPCService{
		capabilities: thispc.Capabilities{SchemaVersion: thispc.SchemaVersion, Scope: thispc.Scope},
		snapshot:     thispc.Snapshot{SchemaVersion: thispc.SchemaVersion, Status: "ok", Scope: thispc.Scope, Interfaces: []thispc.InterfaceSnapshot{}, Notes: []string{}},
		activity:     thispc.Activity{SchemaVersion: thispc.SchemaVersion, Status: "ok", Scope: thispc.Scope, Listeners: []thispc.Socket{}, Connections: []thispc.Socket{}, Notes: []string{}},
		traffic:      thispc.TrafficSample{SchemaVersion: thispc.SchemaVersion, Scope: thispc.Scope, Interfaces: []thispc.InterfaceTrafficSample{}, Notes: []string{}},
		public:       thispc.PublicIdentity{SchemaVersion: thispc.SchemaVersion, Provider: "ipify", Families: []thispc.PublicFamilyResult{}},
	}
}

func TestThisPCRoutesAreAbsentWithoutInjectedLocalService(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	for _, route := range []string{
		"/api/this-pc/capabilities",
		"/api/this-pc/snapshot",
		"/api/this-pc/activity",
		"/api/this-pc/traffic/sample",
		"/api/this-pc/public",
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("%s status = %d", route, response.Code)
		}
	}
}

func TestThisPCGETResponsesAreVersionedNoStoreJSON(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))
	for _, route := range []string{"/api/this-pc/capabilities", "/api/this-pc/snapshot"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("%s status=%d headers=%v", route, response.Code, response.Header())
		}
		var envelope struct {
			SchemaVersion int `json:"schemaVersion"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.SchemaVersion != thispc.SchemaVersion {
			t.Fatalf("%s body=%s err=%v", route, response.Body.String(), err)
		}
	}
}

func TestThisPCPOSTRequiresCSRFAndExplicitAcknowledgementsBeforeCallingService(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))

	noCSRFBody := &countingThisPCBody{reader: strings.NewReader(`{"acknowledgeLocalInspection":true}`)}
	noCSRF := httptest.NewRequest(http.MethodPost, "/api/this-pc/activity", noCSRFBody)
	noCSRF.Header.Set("Content-Type", "application/json")
	noCSRFResponse := httptest.NewRecorder()
	handler.ServeHTTP(noCSRFResponse, noCSRF)
	if noCSRFResponse.Code != http.StatusUnauthorized || noCSRFBody.reads != 0 || service.activityCalls.Load() != 0 {
		t.Fatalf("no CSRF status=%d reads=%d calls=%d", noCSRFResponse.Code, noCSRFBody.reads, service.activityCalls.Load())
	}
	assertVersionedError(t, noCSRFResponse)

	missingAck := newThisPCPOSTRequest("/api/this-pc/activity", `{"acknowledgeLocalInspection":false}`)
	missingAckResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingAckResponse, missingAck)
	if missingAckResponse.Code != http.StatusBadRequest || service.activityCalls.Load() != 0 {
		t.Fatalf("missing activity acknowledgement status=%d calls=%d", missingAckResponse.Code, service.activityCalls.Load())
	}
	assertVersionedError(t, missingAckResponse)

	publicAck := newThisPCPOSTRequest("/api/this-pc/public", `{"acknowledgeExternalRequest":false,"families":["ipv4"]}`)
	publicAckResponse := httptest.NewRecorder()
	handler.ServeHTTP(publicAckResponse, publicAck)
	if publicAckResponse.Code != http.StatusBadRequest || service.publicCalls.Load() != 0 {
		t.Fatalf("missing public acknowledgement status=%d calls=%d", publicAckResponse.Code, service.publicCalls.Load())
	}
	assertVersionedError(t, publicAckResponse)
}

func TestThisPCPOSTStrictJSONAndExactTrafficDurations(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))

	for _, body := range []string{
		`{"durationMs":750}`,
		`{"durationMs":500,"unknown":true}`,
		`{"durationMs":500} {"durationMs":500}`,
		`{"durationMs":500,"durationMs":1000}`,
		`{"durationMs":500,"DurationMS":1000}`,
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, newThisPCPOSTRequest("/api/this-pc/traffic/sample", body))
		if response.Code != http.StatusBadRequest {
			t.Errorf("body %q status = %d", body, response.Code)
		}
		assertVersionedError(t, response)
	}
	for _, request := range []struct {
		route string
		body  string
	}{
		{route: "/api/this-pc/activity", body: `{"acknowledgeLocalInspection":true,"AcknowledgeLocalInspection":false}`},
		{route: "/api/this-pc/public", body: `{"acknowledgeExternalRequest":true,"families":["ipv4"],"Families":["ipv6"]}`},
		{route: "/api/this-pc/public", body: `{"acknowledgeExternalRequest":true,"acknowledgeExternalRequest":false,"families":["ipv4"]}`},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, newThisPCPOSTRequest(request.route, request.body))
		if response.Code != http.StatusBadRequest {
			t.Errorf("duplicate body %q status = %d", request.body, response.Code)
		}
		assertVersionedError(t, response)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, newThisPCPOSTRequest("/api/this-pc/traffic/sample", `{"durationMs":2000}`))
	if response.Code != http.StatusOK || service.lastDuration != 2*time.Second {
		t.Fatalf("valid traffic status=%d duration=%s body=%s", response.Code, service.lastDuration, response.Body.String())
	}
}

func TestThisPCPublicFamiliesAreExplicitAndPreservePartialResponse(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	service.public.Families = []thispc.PublicFamilyResult{
		{Family: "ipv4", Status: "ok", Address: "8.8.8.8", BGPOriginStatus: "unavailable"},
		{Family: "ipv6", Status: "unavailable", Error: "public IPv6 path unavailable", BGPOriginStatus: "not-attempted"},
	}
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, newThisPCPOSTRequest("/api/this-pc/public", `{"acknowledgeExternalRequest":true,"families":["ipv4","ipv6"]}`))
	if response.Code != http.StatusOK || strings.Join(service.lastFamilies, ",") != "ipv4,ipv6" {
		t.Fatalf("status=%d families=%v body=%s", response.Code, service.lastFamilies, response.Body.String())
	}
	var decoded thispc.PublicIdentity
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil || len(decoded.Families) != 2 || decoded.Families[0].Status != "ok" || decoded.Families[1].Status != "unavailable" {
		t.Fatalf("decoded=%#v err=%v", decoded, err)
	}
}

func TestThisPCActivityHTTPResponseStaysWithinFourMiB(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	owners := make([]thispc.ProcessAttribution, 8)
	for index := range owners {
		owners[index] = thispc.ProcessAttribution{PID: index + 1, Comm: strings.Repeat("x", 256)}
	}
	service.activity.Connections = make([]thispc.Socket, 4096)
	for index := range service.activity.Connections {
		service.activity.Connections[index] = thispc.Socket{
			Protocol: "tcp6", State: "ESTABLISHED",
			Local: thispc.Endpoint{Address: "2001:db8::1", Port: 65535}, Remote: thispc.Endpoint{Address: "2001:db8::2", Port: 65535},
			Exposure: "interface-bound", OwnerStatus: "observed", Processes: owners,
		}
	}
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, newThisPCPOSTRequest("/api/this-pc/activity", `{"acknowledgeLocalInspection":true}`))
	if response.Code != http.StatusOK || response.Body.Len() > thispc.MaxEncodedActivityResponseBytes {
		t.Fatalf("status=%d bytes=%d", response.Code, response.Body.Len())
	}
	var decoded thispc.Activity
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil || !decoded.Truncated || decoded.Status != "partial" {
		t.Fatalf("decoded truncated=%v status=%q err=%v", decoded.Truncated, decoded.Status, err)
	}
}

func TestThisPCSnapshotHTTPResponseStaysWithinOneMiB(t *testing.T) {
	t.Parallel()
	service := newFakeThisPCService()
	service.snapshot.Interfaces = make([]thispc.InterfaceSnapshot, 256)
	for index := range service.snapshot.Interfaces {
		addresses := make([]thispc.InterfaceAddress, 64)
		for addressIndex := range addresses {
			addresses[addressIndex] = thispc.InterfaceAddress{Address: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", Prefix: 128, Family: "ipv6", Scope: "global-unicast"}
		}
		service.snapshot.Interfaces[index] = thispc.InterfaceSnapshot{Index: index + 1, Name: "interface", Flags: []string{}, Addresses: addresses}
	}
	handler := Handler(nil, "", nil, nil, WithThisPCService(service))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/this-pc/snapshot", nil))
	if response.Code != http.StatusOK || response.Body.Len() > thispc.MaxEncodedSnapshotResponseBytes {
		t.Fatalf("status=%d bytes=%d", response.Code, response.Body.Len())
	}
	var decoded thispc.Snapshot
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil || decoded.Status != "partial" {
		t.Fatalf("decoded status=%q err=%v", decoded.Status, err)
	}
}

func TestThisPCSPADeepLink(t *testing.T) {
	t.Parallel()
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/this-pc", nil))
	if response.Code != http.StatusTemporaryRedirect || response.Header().Get("Location") != "./#/this-pc" {
		t.Fatalf("status=%d location=%q", response.Code, response.Header().Get("Location"))
	}
}

type countingThisPCBody struct {
	reader io.Reader
	reads  int
}

func (body *countingThisPCBody) Read(buffer []byte) (int, error) {
	body.reads++
	return body.reader.Read(buffer)
}

func (body *countingThisPCBody) Close() error { return nil }

func newThisPCPOSTRequest(route, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, route, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "this-pc-test-token"})
	request.Header.Set(csrfHeaderName, "this-pc-test-token")
	return request
}

func assertVersionedError(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("error headers = %v", response.Header())
	}
	var envelope struct {
		SchemaVersion int    `json:"schemaVersion"`
		Error         string `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.SchemaVersion != thispc.SchemaVersion || envelope.Error == "" {
		t.Fatalf("error body=%s decoded=%#v err=%v", response.Body.String(), envelope, err)
	}
}
