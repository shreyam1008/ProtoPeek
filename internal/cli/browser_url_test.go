package cli

import (
	"testing"
)

func TestBrowserURLHostFormatting(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name string
		bind string
		want string
	}{
		{name: "IPv4", bind: "127.0.0.1", want: "http://127.0.0.1:8080/console/"},
		{name: "IPv6", bind: "::1", want: "http://[::1]:8080/console/"},
		{name: "bracketed IPv6", bind: "[::1]", want: "http://[::1]:8080/console/"},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := browserURL(test.bind, 8080, "/console/")
			if got != test.want {
				t.Fatalf("URL = %q, want %q", got, test.want)
			}
		})
	}
}
