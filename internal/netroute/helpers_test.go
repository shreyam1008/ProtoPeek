package netroute

import "testing"

func TestPrefixLengthRejectsNonContiguousMask(t *testing.T) {
	t.Parallel()
	if prefix, err := prefixLength([]byte{0xff, 0xff, 0xf0, 0x00}); err != nil || prefix != 20 {
		t.Fatalf("prefix = %d, err = %v", prefix, err)
	}
	if _, err := prefixLength([]byte{0xff, 0x7f}); err == nil {
		t.Fatal("non-contiguous mask unexpectedly accepted")
	}
}
