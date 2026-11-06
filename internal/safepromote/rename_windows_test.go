package safepromote

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestRenameAfterTemporarySharingViolation(t *testing.T) {
	parent := t.TempDir()
	stage, target := filepath.Join(parent, "stage"), filepath.Join(parent, "target")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(stage)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	closed := make(chan error, 1)
	time.AfterFunc(150*time.Millisecond, func() { closed <- windows.CloseHandle(handle) })
	err = Rename(stage, target)
	if closeErr := <-closed; closeErr != nil {
		t.Fatal(closeErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal(err)
	}
}
