//go:build windows

package safepromote

import (
	"errors"
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
	err = windows.MoveFile(from, to)
	if errors.Is(err, windows.ERROR_NOT_SUPPORTED) || errors.Is(err, windows.ERROR_INVALID_FUNCTION) {
		return ErrUnsupported
	}
	return err
}
