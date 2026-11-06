//go:build windows && amd64 && protopeek_lite

package bundledaria2

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
)

const managedURL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip"

func ManagedDownload() (string, int64, bool) { return managedURL, windowsArchiveSize, true }

func managedArchivePath(create bool) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil || !filepath.IsAbs(cache) {
		return "", ErrCompanionInvalid
	}
	if create {
		if err := os.MkdirAll(cache, 0700); err != nil {
			return "", ErrCompanionInvalid
		}
	}
	for _, dir := range []string{filepath.Join(cache, "protopeek"), filepath.Join(cache, "protopeek", "engines"), filepath.Join(cache, "protopeek", "engines", "aria2")} {
		info, err := os.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) && create {
			if err = os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return "", ErrCompanionInvalid
			}
			info, err = os.Lstat(dir)
		}
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrCompanionMissing
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", ErrCompanionInvalid
		}
	}
	return filepath.Join(cache, "protopeek", "engines", "aria2", CompanionFilename), nil
}
func readManagedArchive() ([]byte, error) {
	path, err := managedArchivePath(false)
	if err != nil {
		return nil, err
	}
	return readCompanion(path, windowsArchiveSHA, windowsArchiveSize)
}

// CanRepairManagedArchive only covers a fixed-name local cache file. An
// invalid adjacent sidecar is user-supplied and is never moved automatically.
func CanRepairManagedArchive() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if _, err := os.Lstat(filepath.Join(filepath.Dir(exe), CompanionFilename)); !errors.Is(err, os.ErrNotExist) {
		return false
	}
	path, err := managedArchivePath(false)
	if err != nil {
		return false
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	_, err = readCompanion(path, windowsArchiveSHA, windowsArchiveSize)
	return errors.Is(err, ErrCompanionInvalid)
}

// Quarantine preserves changed data rather than deleting an unverified file.
// The caller holds the downloader process lock and requires explicit consent.
func QuarantineManagedArchive() error {
	if !CanRepairManagedArchive() {
		return ErrCompanionInvalid
	}
	path, err := managedArchivePath(false)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".aria2-quarantine-*")
	if err != nil {
		return ErrCompanionInvalid
	}
	name := f.Name()
	if err := f.Close(); err != nil {
		return ErrCompanionInvalid
	}
	if err := os.Remove(name); err != nil {
		return ErrCompanionInvalid
	}
	if err := safepromote.Rename(path, name); err != nil {
		if errors.Is(err, safepromote.ErrUnsupported) {
			return ErrPromotionUnsupported
		}
		return ErrCompanionInvalid
	}
	return nil
}
func checkManagedArchive() error {
	_, err := readManagedArchive()
	if errors.Is(err, ErrCompanionMissing) {
		return nil
	}
	return err
}
func removeManagedArchive() error {
	path, err := managedArchivePath(false)
	if errors.Is(err, ErrCompanionMissing) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := readCompanion(path, windowsArchiveSHA, windowsArchiveSize); errors.Is(err, ErrCompanionMissing) {
		return nil
	} else if err != nil {
		return err
	}
	return os.Remove(path)
}

// InstallManaged downloads only on explicit user request. The caller holds the downloader lock.
func InstallManaged(ctx context.Context) error {
	path, err := managedArchivePath(true)
	if err != nil {
		return err
	}
	if _, err = readCompanion(path, windowsArchiveSHA, windowsArchiveSize); err == nil {
		return nil
	} else if !errors.Is(err, ErrCompanionMissing) {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 8 || req.URL.Scheme != "https" || req.URL.User != nil {
			return ErrCompanionInvalid
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, managedURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("aria2 download failed")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".aria2-download-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, windowsArchiveSize+1))
	if err != nil {
		return err
	}
	if n != windowsArchiveSize || hex.EncodeToString(h.Sum(nil)) != windowsArchiveSHA {
		return ErrCompanionInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err = f.Chmod(0600); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = safepromote.Rename(f.Name(), path); err != nil {
		if errors.Is(err, safepromote.ErrUnsupported) {
			return ErrPromotionUnsupported
		}
		return ErrCompanionInvalid
	}
	return nil
}
