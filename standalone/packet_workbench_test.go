package standalone

import (
	"bytes"
	"encoding/json"
	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
	"github.com/shreyam1008/ProtoPeek/testing/packetfixture"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPacketWorkbenchBoundary(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	for _, test := range []struct {
		path   string
		body   []byte
		csrf   bool
		status int
	}{
		{"analyze", packetfixture.Bytes(75), true, 200}, {"analyze", packetfixture.Bytes(1), false, 401}, {"analyze", []byte("not a capture"), true, 400},
		{"capture", []byte(`{"interface":"lo","host":"127.0.0.1","seconds":5,"packets":10,"consent":false}`), true, 400},
		{"capture", []byte(`{"arbitraryCommand":"bad"}`), true, 400}, {"interfaces", []byte(`{"unknown":1}`), true, 400},
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/packets/"+test.path, bytes.NewReader(test.body))
		if test.path != "analyze" {
			r.Header.Set("Content-Type", "application/json")
		}
		if test.csrf {
			r.AddCookie(cookie)
			r.Header.Set(csrfHeaderName, cookie.Value)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("%s got %d want %d: %s", test.path, w.Code, test.status, w.Body.String())
		}
		if w.Code == 200 && (!strings.Contains(w.Body.String(), `"packetCount":75`) || strings.Contains(w.Body.String(), "redacted")) {
			t.Fatal("incorrect report or retained request target")
		}
	}
	for _, path := range []string{"capture", "analyze", "interfaces"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/packets/"+path, nil))
		if w.Code != 405 {
			t.Fatal("accepted GET", path)
		}
	}
}

func TestPacketReconstructionRequiresExplicitOptIn(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	for _, query := range []string{"", "?reconstruct=false", "?reconstruct=true", "?reconstruct=1", "?reconstruct=true&reconstruct=false"} {
		r := httptest.NewRequest(http.MethodPost, "/api/packets/analyze"+query, bytes.NewReader(packetfixture.Bytes(1)))
		r.AddCookie(cookie)
		r.Header.Set(csrfHeaderName, cookie.Value)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if query == "?reconstruct=1" || query == "?reconstruct=true&reconstruct=false" {
			if w.Code != http.StatusBadRequest {
				t.Fatalf("accepted ambiguous option %s", query)
			}
			continue
		}
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
		}
		var report packetwork.Report
		if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if query == "?reconstruct=true" {
			if report.Reconstruction == nil || len(report.Reconstruction.Flows) != 1 || !bytes.Contains(report.Reconstruction.Flows[0].Directions[0].Segments[0].Data, []byte("token=redacted")) {
				t.Fatal("explicit retained-byte evidence missing")
			}
		} else if report.Reconstruction != nil || strings.Contains(w.Body.String(), "reconstruction") {
			t.Fatal("payload serialized on metadata-only path")
		}
	}
}
