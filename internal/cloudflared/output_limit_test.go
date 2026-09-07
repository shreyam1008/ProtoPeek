package cloudflared

import (
	"io"
	"strings"
	"testing"
)

type onlyReader struct{ io.Reader }

func TestBoundedOutputThroughCopyFastPaths(t *testing.T) {
	for _, reader := range []io.Reader{strings.NewReader(strings.Repeat("x", maxToolOutput*4)), onlyReader{strings.NewReader(strings.Repeat("x", maxToolOutput*4))}} {
		var output boundedBuffer
		n, err := io.Copy(&output, reader)
		if err != nil || n != maxToolOutput*4 || output.Len() != maxToolOutput {
			t.Fatalf("copy bypassed limit: read %d retained %d error %v", n, output.Len(), err)
		}
	}
}
