package standalone

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerRedirectsSPARoutesIntoHashShell(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	routes := []string{
		"/protocols",
		"/protocols/grpc",
		"/protocols/http",
		"/downloader",
		"/this-pc",
		"/network/route",
		"/security",
		"/settings",
		"/grpc",
		"/http",
		"/downloads",
		"/routes",
		"/network",
		"/network/path",
		"/network/local",
		"/network/map",
		"/network/history",
		"/roadmap",
	}
	for _, route := range routes {
		route := route
		t.Run(route, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
			if response.Code != http.StatusTemporaryRedirect {
				t.Fatalf("status = %d", response.Code)
			}
			if location := response.Header().Get("Location"); location != "./#"+route {
				t.Fatalf("Location = %q", location)
			}
		})
	}
}

func TestHandlerRejectsMutationToSPARoute(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/downloader", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d", response.Code)
	}
}
