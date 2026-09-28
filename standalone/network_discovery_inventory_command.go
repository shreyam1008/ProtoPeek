//go:build windows || darwin

package standalone

import (
	"bytes"
	"fmt"
	"os/exec"
	"time"
)

type networkNeighborOutput struct{ bytes.Buffer }

func (output *networkNeighborOutput) Write(data []byte) (int, error) {
	if output.Len()+len(data) > 128<<10 {
		return 0, fmt.Errorf("neighbor cache exceeds 128 KiB")
	}
	return output.Buffer.Write(data)
}

func runNetworkNeighborCommand(command *exec.Cmd) ([]byte, error) {
	output := &networkNeighborOutput{}
	command.Stdout = output
	command.WaitDelay = 200 * time.Millisecond
	if err := command.Run(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
