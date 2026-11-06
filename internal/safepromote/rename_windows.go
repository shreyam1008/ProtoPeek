//go:build windows

package safepromote

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

func Rename(source, target string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	// A scanner may briefly hold a freshly written executable without delete
	// sharing. Retry only this short window while the destination is absent.
	for attempt := 0; ; attempt++ {
		err = windows.MoveFile(from, to)
		if attempt == 5 || !(errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_ACCESS_DENIED)) {
			break
		}
		if _, statErr := os.Lstat(target); !os.IsNotExist(statErr) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if errors.Is(err, windows.ERROR_NOT_SUPPORTED) || errors.Is(err, windows.ERROR_INVALID_FUNCTION) {
		return ErrUnsupported
	}
	return err
}
