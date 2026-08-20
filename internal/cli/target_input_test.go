package cli

import "testing"

func TestShouldStartLauncherScan(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		input string
		want  bool
	}{
		{input: "localhost", want: true},
		{input: "127.0.0.1", want: true},
		{input: "[::1]", want: true},
		{input: "https://example.test", want: true},
		{input: "HTTP://example.test:8080/", want: true},
		{input: "localhost:50051", want: false},
		{input: "[::1]:50051", want: false},
		{input: "dns:///example.test:50051", want: false},
	} {
		test := test
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			if got := shouldStartLauncherScan(test.input); got != test.want {
				t.Fatalf("shouldStartLauncherScan(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}
