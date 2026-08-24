//go:build linux

package thispc

import (
	"errors"
	"fmt"
	"io"
	"os"
)

var errProcFileTooLarge = errors.New("procfs file exceeded its byte limit")

func readBoundedFile(path string, maximum int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	contents, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maximum {
		return nil, fmt.Errorf("%w: %s", errProcFileTooLarge, path)
	}
	return contents, nil
}
