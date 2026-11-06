//go:build linux

package safepromote

import (
	"errors"
	"golang.org/x/sys/unix"
)

// Rename moves a file or directory atomically without replacing a destination.
func Rename(source, target string) error {
	err := unix.Renameat2(unix.AT_FDCWD, source, unix.AT_FDCWD, target, unix.RENAME_NOREPLACE)
	if errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.EINVAL) {
		return ErrUnsupported
	}
	return err
}
