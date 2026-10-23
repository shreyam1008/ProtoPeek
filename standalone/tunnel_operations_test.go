package standalone

import (
	"context"
	"github.com/shreyam1008/ProtoPeek/internal/tunnels"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeCanonicalTunnelService struct {
	*fakeTunnelService
	calls int
}

func (service *fakeCanonicalTunnelService) Operation(_ context.Context, request tunnels.OperationRequest) (tunnels.OperationResult, error) {
	service.calls++
	return tunnels.OperationResult{Operation: request.Operation, Status: "completed", Message: "fixture"}, nil
}
func TestCanonicalTunnelOperationsRequireDirectLoopbackAndStrictAdmission(t *testing.T) {
	for _, test := range []struct {
		name, peer, forwarded, body string
		csrf                        bool
		want                        int
	}{
		{"valid", "127.0.0.1:12000", "", `{"operation":"validate","revision":"` + strings.Repeat("a", 64) + `","configPath":"C:/fixture/config.yml"}`, true, 200},
		{"remote", "192.0.2.4:12000", "", `{}`, true, 403},
		{"forwarded", "127.0.0.1:12000", "192.0.2.4", `{}`, true, 403},
		{"csrf", "127.0.0.1:12000", "", `{}`, false, 401},
		{"unknown", "127.0.0.1:12000", "", `{"command":"anything"}`, true, 400},
		{"oversize", "127.0.0.1:12000", "", `{"url":"` + strings.Repeat("a", 17<<10) + `"}`, true, 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeCanonicalTunnelService{fakeTunnelService: newFakeTunnelService()}
			handler := Handler(nil, "", nil, nil, WithTunnelService(service))
			request := admittedTunnelRequest(http.MethodPost, "/api/tunnels/operation", []byte(test.body))
			request.RemoteAddr = test.peer
			request.Header.Set("Content-Type", "application/json")
			if test.forwarded != "" {
				request.Header.Set("X-Forwarded-For", test.forwarded)
			}
			if !test.csrf {
				request.Header.Del(csrfHeaderName)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if (service.calls > 0) != (test.want == 200) {
				t.Fatalf("calls=%d", service.calls)
			}
		})
	}
}
func TestCanonicalTunnelOptionalOperationsDoNotExposeUnsupportedEmbedderSurface(t *testing.T) {
	handler := Handler(nil, "", nil, nil, WithTunnelService(newFakeTunnelService()))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, admittedTunnelRequest(http.MethodPost, "/api/tunnels/operation", nil))
	if response.Code != 404 {
		t.Fatalf("status=%d", response.Code)
	}
}
