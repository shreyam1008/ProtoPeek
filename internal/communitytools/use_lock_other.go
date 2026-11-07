//go:build !windows && !linux && !darwin

package communitytools

import (
	"errors"
	"os"
)

func openLockFile(string) (*os.File, error) { return nil, errors.New("locking unavailable") }
func lockShared(*os.File) error             { return errors.New("shared locking unavailable") }
func lockExclusive(*os.File) error          { return errors.New("exclusive locking unavailable") }
func unlockShared(*os.File) error           { return nil }
func sharedBusy(error) bool                 { return false }
