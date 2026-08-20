package cli

import "testing"

func TestResolveBuildVersionPrecedence(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name          string
		linkedVersion string
		moduleVersion string
		want          string
	}{
		{name: "release linker metadata wins", linkedVersion: "v0.4.0", moduleVersion: "v0.3.0", want: "v0.4.0"},
		{name: "go install module version", linkedVersion: unsetBuildVersion, moduleVersion: "v0.3.0", want: "v0.3.0"},
		{name: "pseudo version", linkedVersion: unsetBuildVersion, moduleVersion: "v0.0.0-20260820120000-deadbeef", want: "v0.0.0-20260820120000-deadbeef"},
		{name: "local development", linkedVersion: unsetBuildVersion, moduleVersion: "(devel)", want: unsetBuildVersion},
		{name: "empty linker value", linkedVersion: "", moduleVersion: "v0.3.0", want: "v0.3.0"},
		{name: "missing metadata", linkedVersion: "", moduleVersion: "", want: unsetBuildVersion},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveBuildVersion(test.linkedVersion, test.moduleVersion); got != test.want {
				t.Fatalf("resolveBuildVersion(%q, %q) = %q, want %q", test.linkedVersion, test.moduleVersion, got, test.want)
			}
		})
	}
}
