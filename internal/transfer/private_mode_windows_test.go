//go:build windows

package transfer

import (
	"os"
	"testing"
)

// Windows' os.FileMode reports synthesized DOS attributes (commonly 0666 for
// files and 0777 for directories), not the Windows ACL that governs access.
// Assert only the file-type contract exposed truthfully by Go; Unix tests
// retain the exact 0600/0700 privacy guarantee.
func assertPrivateFileContract(t *testing.T, info os.FileInfo) {
	t.Helper()
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		t.Fatalf("private state is not a regular non-symlink file: %v", info.Mode())
	}
}

func assertPrivateDirectoryContract(t *testing.T, info os.FileInfo) {
	t.Helper()
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		t.Fatalf("private state parent is not a non-symlink directory: %v", info.Mode())
	}
}
