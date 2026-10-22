package standalone

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

var spaDeepLinkTestRoutes = []string{
	"/protocols", "/protocols/grpc", "/protocols/http", "/protocols/events", "/protocols/capnp",
	"/network", "/network/packets", "/network/ports", "/network/nmap", "/network/tailnet",
	"/network/route", "/network/path", "/network/local", "/network/map", "/network/history",
	"/network/diagnostics", "/extensions/netbird", "/extensions/publish",
	"/downloader", "/this-pc", "/tunnels", "/extensions", "/agents", "/security", "/settings",
	"/grpc", "/http", "/downloads", "/routes", "/roadmap", "/updates",
}

func TestHandlerRedirectsDirectSPADeepLinksToHashRoutes(t *testing.T) {
	t.Parallel()

	for _, mount := range []struct {
		name       string
		prefix     string
		optionPath bool
	}{
		{name: "root"},
		{name: "base-path", prefix: "/console", optionPath: true},
		{name: "stripped-prefix", prefix: "/console"},
		{name: "nested-base-path", prefix: "/tools/console", optionPath: true},
	} {
		mount := mount
		t.Run(mount.name, func(t *testing.T) {
			t.Parallel()
			var options []HandlerOption
			if mount.optionPath {
				options = append(options, WithBasePath(mount.prefix))
			}
			handler := Handler(nil, "", nil, nil, options...)
			if mount.prefix != "" {
				handler = http.StripPrefix(mount.prefix, handler)
			}
			root := httptest.NewRecorder()
			handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "http://protopeek.test"+mount.prefix+"/", nil))
			if root.Code != http.StatusOK || root.Body.Len() == 0 {
				t.Fatalf("embedded index status = %d, bytes = %d", root.Code, root.Body.Len())
			}
			for _, route := range spaDeepLinkTestRoutes {
				route := route
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					method := method
					t.Run(method+" "+route, func(t *testing.T) {
						t.Parallel()
						request := httptest.NewRequest(method, "http://protopeek.test"+mount.prefix+route, nil)
						response := httptest.NewRecorder()
						handler.ServeHTTP(response, request)
						if response.Code != http.StatusTemporaryRedirect {
							t.Fatalf("deep-link status = %d, body = %q", response.Code, response.Body.String())
						}
						if method == http.MethodHead && response.Body.Len() != 0 {
							t.Fatalf("HEAD redirect body length = %d, want 0", response.Body.Len())
						}
						location, err := response.Result().Location()
						if err != nil {
							t.Fatalf("parse Location: %v", err)
						}
						resolved := request.URL.ResolveReference(location)
						if resolved.Fragment != route {
							t.Fatalf("hash route = %q, want %q", resolved.Fragment, route)
						}
						browserURL := resolved.String()
						// Fragments stay client-side and are absent from the follow-up HTTP request.
						resolved.Fragment, resolved.RawFragment = "", ""
						index := httptest.NewRecorder()
						handler.ServeHTTP(index, httptest.NewRequest(method, resolved.String(), nil))
						if index.Code != http.StatusOK {
							t.Fatalf("Location = %q resolves to %q; embedded index status = %d, want 200", location, browserURL, index.Code)
						}
						if got, want := browserURL, "http://protopeek.test"+mount.prefix+"/#"+route; got != want {
							t.Fatalf("resolved Location = %q, want %q", got, want)
						}
						for _, header := range []string{"Content-Type", "Content-Length", "ETag", "Cache-Control"} {
							if got, want := index.Header().Get(header), root.Header().Get(header); got != want {
								t.Fatalf("resolved index %s = %q, want %q", header, got, want)
							}
						}
						if method == http.MethodHead {
							if index.Body.Len() != 0 {
								t.Fatalf("HEAD index body length = %d, want 0", index.Body.Len())
							}
						} else if index.Body.String() != root.Body.String() {
							t.Fatal("resolved deep link did not serve the embedded root index")
						}
					})
				}
			}
		})
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
		{method: http.MethodPost, path: "/extensions"},
		{method: http.MethodGet, path: "/extensions/nested"},
	}
	for _, route := range spaDeepLinkTestRoutes {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			requests = append(requests, struct {
				method string
				path   string
			}{method: method, path: route})
		}
	}
	for _, prefix := range []string{"", "/console"} {
		prefix := prefix
		t.Run("mount="+prefix, func(t *testing.T) {
			t.Parallel()
			handler := Handler(nil, "", nil, nil, WithBasePath(prefix))
			if prefix != "" {
				handler = http.StripPrefix(prefix, handler)
			}
			root := httptest.NewRecorder()
			handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, prefix+"/", nil))
			for _, request := range requests {
				request := request
				t.Run(request.method+" "+request.path, func(t *testing.T) {
					t.Parallel()
					response := httptest.NewRecorder()
					handler.ServeHTTP(
						response,
						httptest.NewRequest(request.method, prefix+request.path, nil),
					)

					if response.Code != http.StatusNotFound {
						t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
					}
					if response.Body.String() == root.Body.String() {
						t.Fatal("request unexpectedly received the embedded SPA index")
					}
				})
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

func TestExtensionsDeepLinkResolvesToEmbeddedIndexUnderBasePath(t *testing.T) {
	t.Parallel()
	const basePath = "/console"
	handler := http.StripPrefix(basePath, Handler(nil, "", nil, nil, WithBasePath(basePath)))
	request := httptest.NewRequest(http.MethodGet, "http://protopeek.test/console/extensions", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusTemporaryRedirect {
		t.Fatalf("deep link status = %d", response.Code)
	}
	location, err := response.Result().Location()
	if err != nil {
		t.Fatal(err)
	}
	resolved := request.URL.ResolveReference(location)
	if resolved.String() != "http://protopeek.test/console/#/extensions" {
		t.Fatalf("resolved deep link = %q", resolved)
	}
	// Browsers keep the hash route client-side; it is never sent in an HTTP request.
	resolved.Fragment = ""
	index := httptest.NewRecorder()
	handler.ServeHTTP(index, httptest.NewRequest(http.MethodGet, resolved.String(), nil))
	if index.Code != http.StatusOK || index.Header().Get("Content-Type") != "text/html; charset=utf-8" || index.Body.Len() == 0 {
		t.Fatalf("resolved index = %d %s", index.Code, index.Header().Get("Content-Type"))
	}
}
