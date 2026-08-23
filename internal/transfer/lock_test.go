package transfer

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestFileLockerIsExclusiveAndReleasable(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "engine.lock")
	locker := FileLocker{}
	first, err := locker.TryLock(path)
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	if _, err := locker.TryLock(path); !errors.Is(err, ErrLockHeld) {
		t.Fatalf("second lock error = %v; want ErrLockHeld", err)
	}
	if err := first.Release(); err != nil {
		t.Fatalf("release first lock: %v", err)
	}
	second, err := locker.TryLock(path)
	if err != nil {
		t.Fatalf("lock after release: %v", err)
	}
	if err := second.Release(); err != nil {
		t.Fatalf("release second lock: %v", err)
	}
}
