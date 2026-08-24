//go:build linux

package thispc

import (
	"fmt"
	"strings"
	"testing"
)

func TestParseProcNetDevColumnOrder(t *testing.T) {
	t.Parallel()
	fixture := "Inter-|   Receive                                                |  Transmit\n" +
		" face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
		"  eth0: 9007199254740993 2 3 4 5 6 7 8 9007199254740994 10 11 12 13 14 15 16\n"
	result, err := parseProcNetDev(strings.NewReader(fixture))
	if err != nil {
		t.Fatal(err)
	}
	value := result["eth0"]
	if value.receivedBytes != 9007199254740993 || value.receivedPackets != 2 || value.receivedErrors != 3 || value.receivedDropped != 4 || value.transmittedBytes != 9007199254740994 || value.transmittedPackets != 10 || value.transmittedErrors != 11 || value.transmittedDropped != 12 {
		t.Fatalf("parsed counters = %#v", value)
	}
}

func TestParseProcNetDevRejectsDuplicatesAndCapsInterfaces(t *testing.T) {
	t.Parallel()
	header := "Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n"
	duplicate := header +
		"eth0: 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1\n" +
		"eth0: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2\n"
	if _, err := parseProcNetDev(strings.NewReader(duplicate)); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate interface error = %v", err)
	}
	var fixture strings.Builder
	fixture.WriteString(header)
	for index := 0; index <= maxSnapshotInterfaces; index++ {
		fmt.Fprintf(&fixture, "if%d: 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1\n", index)
	}
	result, err := parseProcNetDev(strings.NewReader(fixture.String()))
	if err == nil || len(result) != maxSnapshotInterfaces || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("interface cap len=%d error=%v", len(result), err)
	}
}
