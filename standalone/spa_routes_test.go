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
		"/protocols/events",
		"/network/ports",
		"/network/nmap",
		"/network/tailnet",
		"/downloader",
		"/this-pc",
		"/tunnels",
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
			request := httptest.NewRequest(http.MethodGet, "http://protopeek.test"+route, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusTemporaryRedirect {
				t.Fatalf("status = %d", response.Code)
			}
			location, err := response.Result().Location()
			if err != nil {
				t.Fatal(err)
			}
			if got, want := request.URL.ResolveReference(location).String(), "http://protopeek.test/#"+route; got != want {
				t.Fatalf("resolved Location = %q, want %q", got, want)
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
