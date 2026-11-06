//go:build windows

package managedtools

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
)

func lockShared(f *os.File) error {
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, new(windows.Overlapped))
}
func unlockShared(f *os.File) error {
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, new(windows.Overlapped))
}
func sharedBusy(err error) bool { return errors.Is(err, windows.ERROR_LOCK_VIOLATION) }
