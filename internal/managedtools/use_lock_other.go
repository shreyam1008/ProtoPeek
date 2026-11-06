//go:build !windows && !linux && !darwin

package managedtools

import (
	"errors"
	"os"
)

func lockShared(*os.File) error   { return errors.New("shared locking unavailable") }
func unlockShared(*os.File) error { return nil }
func sharedBusy(error) bool       { return false }
