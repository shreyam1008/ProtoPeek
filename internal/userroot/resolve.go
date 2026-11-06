// Package userroot resolves an OS-provided config/cache root without creating it.
package userroot

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func Resolve(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil || !filepath.IsAbs(path) {
		return "", errors.New("user root is not absolute")
	}
	var tail []string
	for dir := abs; ; dir = filepath.Dir(dir) {
		resolved, err := resolveExisting(dir)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) || filepath.Dir(dir) == dir {
			return "", err
		}
		tail = append(tail, filepath.Base(dir))
	}
}

// CanonicalTemp resolves the OS-selected temporary root, not its descendants.
// This permits platforms such as macOS where /var is an OS-owned alias.
func CanonicalTemp(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	temp, err := filepath.Abs(os.TempDir())
	if err != nil {
		return abs
	}
	rel, err := filepath.Rel(temp, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return abs
	}
	resolved, err := Resolve(temp)
	if err != nil {
		return abs
	}
	return filepath.Join(resolved, rel)
}
