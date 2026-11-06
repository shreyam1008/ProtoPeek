package managedtools

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

func ariaStatus() Tool {
	info := bundledaria2.Inspect()
	out := Tool{ID: "aria2", Version: bundledaria2.EngineVersion}
	switch {
	case info.Unavailable == bundledaria2.CompanionMessage(bundledaria2.ErrCompanionMissing):
		if url, size, ok := bundledaria2.ManagedDownload(); ok {
			out.Status = "available"
			out.CanInstall = true
			out.InstallBytes = size
			out.SourceURL = url
			out.Message = "Download and verify the pinned aria2 companion only when you choose Install."
			break
		}
		out.Status = "unavailable"
		out.Message = info.Unavailable
	case info.Unavailable != "":
		out.Status = "unavailable"
		out.Message = info.Unavailable
	case !info.Included:
		out.Status = "unavailable"
		out.Message = "This platform has no included aria2 companion. Install or configure an external engine in Files."
	case info.CacheError != "":
		out.Status = "invalid"
		out.Message = "The local aria2 companion could not be verified; no files were removed."
	case info.CachedPath != "":
		out.Status = "installed"
		out.CanRemove = true
		out.Message = "The verified aria2 companion is prepared in the local cache."
	default:
		out.Status = "available"
		out.CanInstall = true
		out.Message = "Prepare the included aria2 companion locally; no download is needed."
	}
	return out
}

// The downloader itself holds this same cross-process lock during use, so a
// cache removal cannot race a running or starting engine.
func lockAria() (transfer.Lock, error) {
	paths, err := transfer.DefaultPaths()
	if err != nil {
		return nil, ErrUnavailable
	}
	// Refuse links in the app-owned state tree and in the lock target before
	// FileLocker opens it. Never follow a user-substituted lock to truncate it.
	configRoot := filepath.Dir(filepath.Dir(paths.StateDirectory))
	if err := os.MkdirAll(configRoot, 0700); err != nil {
		return nil, ErrInvalid
	}
	for _, dir := range []string{filepath.Dir(paths.StateDirectory), paths.StateDirectory} {
		info, err := os.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) {
			if err = os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, ErrInvalid
			}
			info, err = os.Lstat(dir)
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, ErrInvalid
		}
	}
	if info, err := os.Lstat(paths.LockFile); err == nil && !info.Mode().IsRegular() {
		return nil, ErrInvalid
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, ErrInvalid
	}
	lease, err := (transfer.FileLocker{}).TryLock(paths.LockFile)
	if errors.Is(err, transfer.ErrLockHeld) {
		return nil, ErrBusy
	}
	if err != nil {
		return nil, ErrInvalid
	}
	return lease, nil
}
func (m *Manager) installAria(ctx context.Context) (Tool, error) {
	if err := ctx.Err(); err != nil {
		return Tool{}, err
	}
	lease, err := lockAria()
	if err != nil {
		return Tool{}, err
	}
	defer lease.Release()
	path, err := bundledaria2.Path()
	if errors.Is(err, bundledaria2.ErrCompanionMissing) {
		if _, _, ok := bundledaria2.ManagedDownload(); ok {
			if err = bundledaria2.InstallManaged(ctx); err == nil {
				path, err = bundledaria2.Path()
			}
		}
	}
	if err != nil {
		return Tool{}, err
	}
	if path == "" {
		return Tool{}, ErrUnavailable
	}
	return ariaStatus(), nil
}
func (m *Manager) removeAria() (Tool, error) {
	lease, err := lockAria()
	if err != nil {
		return Tool{}, err
	}
	defer lease.Release()
	if err := bundledaria2.RemoveCached(); err != nil {
		return Tool{}, err
	}
	return ariaStatus(), nil
}
