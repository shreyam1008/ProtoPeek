package cli

import (
	"testing"
)

func TestBrowserURLHostFormatting(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name  string
		bind  string
		route string
		want  string
	}{
		{name: "IPv4 dashboard", bind: "127.0.0.1", route: "/", want: "http://127.0.0.1:8080/console/"},
		{name: "IPv6 dashboard", bind: "::1", route: "/", want: "http://[::1]:8080/console/"},
		{name: "bracketed IPv6 dashboard", bind: "[::1]", route: "/", want: "http://[::1]:8080/console/"},
		{name: "direct gRPC target", bind: "127.0.0.1", route: "/grpc", want: "http://127.0.0.1:8080/console/#/grpc"},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := browserURL(test.bind, 8080, "/console/", test.route)
			if got != test.want {
				t.Fatalf("URL = %q, want %q", got, test.want)
			}
		})
	}
}
