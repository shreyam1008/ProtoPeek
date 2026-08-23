package transfer

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

var ErrLockHeld = errors.New("transfer engine is already owned by another ProtoPeek process")

type FileLocker struct{}

func (FileLocker) TryLock(path string) (Lock, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create transfer lock directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open transfer lock: %w", err)
	}
	if err := tryFileLock(file); err != nil {
		_ = file.Close()
		if isFileLockHeld(err) {
			return nil, ErrLockHeld
		}
		return nil, fmt.Errorf("lock transfer engine: %w", err)
	}
	if err := file.Truncate(0); err == nil {
		_, _ = file.Seek(0, 0)
		_, _ = file.WriteString(strconv.Itoa(os.Getpid()) + "\n")
		_ = file.Sync()
	}
	return &fileLock{file: file}, nil
}

type fileLock struct {
	file *os.File
	once sync.Once
	err  error
}

func (lock *fileLock) Release() error {
	lock.once.Do(func() {
		lock.err = errors.Join(unlockFile(lock.file), lock.file.Close())
	})
	return lock.err
}
