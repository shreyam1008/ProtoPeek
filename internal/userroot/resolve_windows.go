//go:build windows

package userroot

import (
	"errors"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// Resolve the trusted OS-provided root by handle; unlike EvalSymlinks this
// follows directory junctions on Go 1.23+ while descendants remain checked.
func resolveExisting(path string) (string, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	h, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0)
	if err != nil {
		return "", err
	}
	if n == 0 || int(n) >= len(buf) {
		return "", errors.New("resolved user root is too long")
	}
	resolved := windows.UTF16ToString(buf[:n])
	if strings.HasPrefix(resolved, `\\?\UNC\`) {
		resolved = `\\` + strings.TrimPrefix(resolved, `\\?\UNC\`)
	} else {
		resolved = strings.TrimPrefix(resolved, `\\?\`)
	}
	if !filepath.IsAbs(resolved) {
		return "", errors.New("resolved user root is not an absolute filesystem path")
	}
	return resolved, nil
}
