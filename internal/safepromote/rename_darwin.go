//go:build darwin

package safepromote

import (
	"errors"
	"golang.org/x/sys/unix"
)

func Rename(source, target string) error {
	err := unix.RenamexNp(source, target, unix.RENAME_EXCL)
	if errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EINVAL) {
		return ErrUnsupported
	}
	return err
}
