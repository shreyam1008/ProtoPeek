package cli

import (
	"bytes"
	"strings"
	"testing"
)

func TestUpdateCommandHelpAndValidation(t *testing.T) {
	for _, name := range []string{"pp", "protopeek"} {
		t.Run(name, func(t *testing.T) {
			var out, err bytes.Buffer
			if code := updateCommand([]string{"--help"}, &out, &err); code != 0 || !strings.Contains(err.String(), "pp update") {
				t.Fatalf("%d %s", code, err.String())
			}
		})
	}
	for _, args := range [][]string{{"--channel", "unknown"}, {"unexpected"}, {"--invalid"}} {
		var out, err bytes.Buffer
		if code := updateCommand(args, &out, &err); code != 2 {
			t.Fatalf("%v: %d", args, code)
		}
	}
}
