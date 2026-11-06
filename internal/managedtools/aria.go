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
	case errors.Is(info.ArchiveError, bundledaria2.ErrCompanionInvalid) && bundledaria2.CanRepairManagedArchive():
		out.Status, out.CanInstall = "invalid", true
		out.SourceURL, out.InstallBytes, _ = bundledaria2.ManagedDownload()
		out.Message = "The cached archive changed. Repair preserves it in quarantine and downloads the verified companion."
	case errors.Is(info.ArchiveError, bundledaria2.ErrCompanionMissing):
		out.Status, out.CanInstall = "available", true
		out.SourceURL, out.InstallBytes, _ = bundledaria2.ManagedDownload()
		out.Message = "Install the pinned aria2 companion when you need Downloader."
	case info.Unavailable != "":
		out.Status = "unavailable"
		out.Message = info.Unavailable
	case info.Partial || info.Repairable:
		out.CanInstall = true
		if !info.Included {
			out.SourceURL, out.InstallBytes, _ = bundledaria2.ManagedDownload()
		}
		if info.Partial {
			out.Status, out.CanRemove = "incomplete", true
			out.Message = "Some verified files remain from an interrupted operation. Repair or remove them."
		} else {
			out.Status = "invalid"
			out.Message = "The cached files changed. Repair preserves them in quarantine and prepares a verified copy."
		}
	case info.CacheError != "":
		out.Status = "invalid"
		out.Message = info.CacheError
	case info.CachedPath != "":
		out.Status = "installed"
		out.CanRemove = true
		out.Message = "The pinned executable and license files were verified in the local cache."
	case info.Included:
		out.Status, out.CanInstall = "available", true
		out.Message = "Prepare the local aria2 companion without a download."
	default:
		out.Status = "unavailable"
		out.Message = "This platform has no managed aria2 companion. Configure an external engine in Files."
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
	info := bundledaria2.Inspect()
	if info.Repairable {
		if err := bundledaria2.QuarantineChangedCache(); err != nil {
			if errors.Is(err, bundledaria2.ErrPromotionUnsupported) {
				return Tool{}, ErrStorageUnsupported
			}
			return Tool{}, ErrInvalid
		}
	}
	path, err := bundledaria2.Path()
	if errors.Is(err, bundledaria2.ErrCompanionInvalid) && bundledaria2.CanRepairManagedArchive() {
		if err = bundledaria2.QuarantineManagedArchive(); err == nil {
			err = bundledaria2.ErrCompanionMissing
		}
	}
	if errors.Is(err, bundledaria2.ErrCompanionMissing) {
		if _, _, ok := bundledaria2.ManagedDownload(); ok {
			if err = bundledaria2.InstallManaged(ctx); err == nil {
				path, err = bundledaria2.Path()
			}
		}
	}
	if err != nil {
		if errors.Is(err, bundledaria2.ErrCacheInvalid) {
			return Tool{}, ErrInvalid
		}
		if errors.Is(err, bundledaria2.ErrPromotionUnsupported) {
			return Tool{}, ErrStorageUnsupported
		}
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
		if errors.Is(err, bundledaria2.ErrCacheInvalid) {
			return Tool{}, ErrInvalid
		}
		return Tool{}, err
	}
	return ariaStatus(), nil
}
