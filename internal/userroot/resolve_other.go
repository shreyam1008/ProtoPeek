//go:build !windows

package userroot

import "path/filepath"

func resolveExisting(path string) (string, error) { return filepath.EvalSymlinks(path) }
