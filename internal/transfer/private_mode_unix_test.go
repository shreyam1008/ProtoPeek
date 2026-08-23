//go:build !windows

package transfer

import (
	"os"
	"testing"
)

func assertPrivateFileContract(t *testing.T, info os.FileInfo) {
	t.Helper()
	if !info.Mode().IsRegular() {
		t.Fatalf("private state is not a regular file: %v", info.Mode())
	}
	if permissions := info.Mode().Perm(); permissions != 0o600 {
		t.Fatalf("private state permissions = %o, want 600", permissions)
	}
}

func assertPrivateDirectoryContract(t *testing.T, info os.FileInfo) {
	t.Helper()
	if !info.IsDir() {
		t.Fatalf("private state parent is not a directory: %v", info.Mode())
	}
	if permissions := info.Mode().Perm(); permissions != 0o700 {
		t.Fatalf("private state directory permissions = %o, want 700", permissions)
	}
}
