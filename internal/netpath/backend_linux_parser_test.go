//go:build linux

package netpath

import (
	"encoding/binary"
	"errors"
	"net/netip"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestParseLinuxExtendedErrorRequiresResponderEvidence(t *testing.T) {
	t.Parallel()
	data := make([]byte, 16+16)
	binary.NativeEndian.PutUint32(data[0:4], uint32(unix.EHOSTUNREACH))
	data[4] = unix.SO_EE_ORIGIN_ICMP
	data[5] = 11
	data[6] = 0
	binary.NativeEndian.PutUint16(data[16:18], unix.AF_UNSPEC)

	if _, err := parseLinuxExtendedError(data); err == nil {
		t.Fatal("missing ICMP offender address was accepted")
	}
}

func TestParseLinuxExtendedErrorRetainsIPv4Responder(t *testing.T) {
	t.Parallel()
	data := make([]byte, 16+16)
	binary.NativeEndian.PutUint32(data[0:4], uint32(unix.EHOSTUNREACH))
	data[4] = unix.SO_EE_ORIGIN_ICMP
	data[5] = 11
	data[6] = 0
	binary.NativeEndian.PutUint16(data[16:18], unix.AF_INET)
	copy(data[20:24], []byte{192, 0, 2, 1})

	parsed, err := parseLinuxExtendedError(data)
	if err != nil {
		t.Fatalf("parseLinuxExtendedError() error = %v", err)
	}
	if parsed.offender.String() != "192.0.2.1" || parsed.typeCode != 11 || parsed.code != 0 || parsed.origin != unix.SO_EE_ORIGIN_ICMP {
		t.Fatalf("parsed = %#v", parsed)
	}
	if !errors.Is(unix.Errno(parsed.errno), unix.EHOSTUNREACH) {
		t.Fatalf("errno = %v", unix.Errno(parsed.errno))
	}
}

func TestLinuxSamplePreservesUnexpectedICMPEvidenceAsAnErrorSample(t *testing.T) {
	t.Parallel()
	sample, terminal, err := linuxSample(linuxExtendedError{
		errno:    uint32(unix.EHOSTUNREACH),
		origin:   unix.SO_EE_ORIGIN_ICMP,
		typeCode: 5,
		code:     1,
		offender: netip.MustParseAddr("192.0.2.1"),
	}, netip.MustParseAddr("192.0.2.20"), 2, 3*time.Millisecond)
	if err != nil {
		t.Fatalf("linuxSample() error = %v", err)
	}
	if terminal != "" || sample.Status != "error" || sample.Responder != "192.0.2.1" || sample.RTTMillis == nil || sample.ICMPType == nil || *sample.ICMPType != 5 {
		t.Fatalf("sample = %#v, terminal = %q", sample, terminal)
	}
}
