//go:build linux || darwin

package managedtools

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func lockShared(f *os.File) error   { return unix.Flock(int(f.Fd()), unix.LOCK_SH|unix.LOCK_NB) }
func unlockShared(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_UN) }
func sharedBusy(err error) bool {
	return errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN)
}
