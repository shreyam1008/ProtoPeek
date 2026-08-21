package standalone

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerRedirectsDirectSPADeepLinksToHashRoutes(t *testing.T) {
	t.Parallel()

	handler := Handler(nil, "", nil, nil)
	for _, route := range []string{
		"/grpc",
		"/http",
		"/routes",
		"/network",
		"/network/path",
		"/network/local",
		"/network/map",
		"/network/history",
		"/roadmap",
	} {
		route := route
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			method := method
			t.Run(method+" "+route, func(t *testing.T) {
				t.Parallel()
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(method, route, nil))

				if response.Code != http.StatusTemporaryRedirect {
					t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
				}
				if got, want := response.Header().Get("Location"), "./#"+route; got != want {
					t.Fatalf("Location = %q, want %q", got, want)
				}
				if method == http.MethodHead && response.Body.Len() != 0 {
					t.Fatalf("HEAD body length = %d, want 0", response.Body.Len())
				}
			})
		}
	}
}

func TestHandlerServesSPAIndexHeadersWithoutBodyForHEAD(t *testing.T) {
	t.Parallel()

	handler := Handler(nil, "", nil, nil)
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/", nil))
	if got, want := get.Header().Get("Content-Type"), "text/html; charset=utf-8"; got != want {
		t.Fatalf("GET Content-Type = %q, want %q", got, want)
	}
	if got, want := get.Header().Get("Cache-Control"), "private, must-revalidate"; got != want {
		t.Fatalf("GET Cache-Control = %q, want %q", got, want)
	}
	for _, header := range []string{"ETag", "Content-Length"} {
		if get.Header().Get(header) == "" {
			t.Fatalf("GET %s is empty", header)
		}
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodHead, "/", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if response.Body.Len() != 0 {
		t.Fatalf("HEAD body length = %d, want 0", response.Body.Len())
	}
	for _, header := range []string{"Content-Type", "Cache-Control", "ETag", "Content-Length"} {
		if got, want := response.Header().Get(header), get.Header().Get(header); got != want {
			t.Fatalf("%s = %q, want GET value %q", header, got, want)
		}
	}
}

func TestHandlerDoesNotUseSPAIndexForUnknownPathsOrMutationMethods(t *testing.T) {
	t.Parallel()

	handler := Handler(nil, "", nil, nil)
	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))

	requests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/unknown"},
		{method: http.MethodGet, path: "/grpc/nested"},
		{method: http.MethodGet, path: "/api/not-a-route"},
		{method: http.MethodPost, path: "/"},
		{method: http.MethodPost, path: "/grpc"},
		{method: http.MethodPut, path: "/http"},
		{method: http.MethodPatch, path: "/routes"},
		{method: http.MethodDelete, path: "/roadmap"},
	}
	for _, request := range requests {
		request := request
		t.Run(request.method+" "+request.path, func(t *testing.T) {
			t.Parallel()
			response := httptest.NewRecorder()
			handler.ServeHTTP(
				response,
				httptest.NewRequest(request.method, request.path, nil),
			)

			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
			}
			if response.Body.String() == root.Body.String() {
				t.Fatal("request unexpectedly received the embedded SPA index")
			}
		})
	}
}

func TestHandlerSPADeepLinksWorkBehindExistingBasePathMount(t *testing.T) {
	t.Parallel()

	const basePath = "/console"
	handler := http.StripPrefix(
		basePath,
		Handler(nil, "", nil, nil, WithBasePath(basePath)),
	)
	deepLink := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://protopeek.test"+basePath+"/grpc", nil)
	handler.ServeHTTP(deepLink, request)

	if deepLink.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, body = %q", deepLink.Code, deepLink.Body.String())
	}
	location, err := deepLink.Result().Location()
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	if got, want := request.URL.ResolveReference(location).String(), "http://protopeek.test/console/#/grpc"; got != want {
		t.Fatalf("resolved Location = %q, want %q", got, want)
	}
}
