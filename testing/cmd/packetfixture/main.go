// packetfixture emulates a dumpcap invocation for UI integration testing only.
// It emits generated packets and never opens a network interface.
package main

import (
	"fmt"
	"github.com/shreyam1008/ProtoPeek/testing/packetfixture"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	for _, arg := range os.Args[1:] {
		if arg == "-D" {
			fmt.Println("1. protopeek-qa (Generated QA packets; not a real interface)")
			return
		}
	}
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "duration:") {
			n, _ := strconv.Atoi(strings.TrimPrefix(arg, "duration:"))
			if n > 0 && n <= 30 {
				time.Sleep(time.Duration(n) * time.Second)
			}
		}
	}
	_, _ = os.Stdout.Write(packetfixture.Bytes(75))
}
