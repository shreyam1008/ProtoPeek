package communitytools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
)

type Tool struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Version      string `json:"version"`
	InstallBytes int64  `json:"installBytes"`
	CanInstall   bool   `json:"canInstall"`
	CanRemove    bool   `json:"canRemove"`
	Message      string `json:"message"`
	SourceURL    string `json:"sourceUrl,omitempty"`
	Path         string `json:"path,omitempty"`
	RecoveryPath string `json:"recoveryPath,omitempty"`
}

type Manager struct {
	cache, platform string
	entries         []Entry
	client          *http.Client
}

func New() (*Manager, error) {
	cache, err := os.UserCacheDir()
	if err != nil || !filepath.IsAbs(cache) {
		return nil, managedtools.ErrUnavailable
	}
	entries, err := parseCatalog(catalogJSON)
	if err != nil {
		return nil, fmt.Errorf("invalid community tool catalog: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 8 || req.URL.Scheme != "https" || req.URL.User != nil {
			return managedtools.ErrInvalid
		}
		return nil
	}}
	return &Manager{cache: cache, platform: runtime.GOOS + "/" + runtime.GOARCH, entries: entries, client: client}, nil
}

func (m *Manager) IDs() []string {
	ids := make([]string, 0, len(m.entries))
	for _, entry := range m.entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func (m *Manager) selected(id string) (Entry, Asset, error) {
	for _, entry := range m.entries {
		if entry.ID == id {
			for _, asset := range entry.Assets {
				if asset.Platform == m.platform {
					return entry, asset, nil
				}
			}
			return entry, Asset{}, managedtools.ErrUnavailable
		}
	}
	return Entry{}, Asset{}, managedtools.ErrUnknown
}

func (m *Manager) base() string { return filepath.Join(m.cache, "protopeek", "community-tools") }

func (m *Manager) binary(id string, a Asset) string {
	name := id
	if strings.HasPrefix(m.platform, "windows/") {
		name += ".exe"
	}
	return filepath.Join(m.base(), id, a.Version, name)
}

func checkDirectory(path string, create bool) error {
	if create {
		if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return managedtools.ErrInvalid
		}
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) && !create {
		return os.ErrNotExist
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return managedtools.ErrInvalid
	}
	return nil
}

func (m *Manager) directories(id string, a Asset, create bool) error {
	if create {
		if err := os.MkdirAll(m.cache, 0700); err != nil {
			return managedtools.ErrInvalid
		}
	}
	for _, dir := range []string{filepath.Join(m.cache, "protopeek"), m.base(), filepath.Join(m.base(), id), filepath.Join(m.base(), id, a.Version)} {
		if err := checkDirectory(dir, create); err != nil {
			return err
		}
	}
	return nil
}

func expectedBinary(a Asset) (int64, string) {
	if a.Format == "binary" {
		return a.Size, a.SHA256
	}
	return a.BinarySize, a.BinarySHA256
}

func inspect(path string, a Asset, checkDigest bool) error {
	size, digest := expectedBinary(a)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.ErrNotExist
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() != size || (!strings.HasPrefix(a.Platform, "windows/") && info.Mode().Perm()&0111 == 0) {
		return managedtools.ErrInvalid
	}
	if !checkDigest {
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return managedtools.ErrInvalid
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != size {
		return managedtools.ErrInvalid
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, size+1))
	if err != nil || n != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return managedtools.ErrInvalid
	}
	return nil
}

func (m *Manager) Status(id string) (Tool, error) {
	return m.status(id, true)
}

func (m *Manager) status(id string, checkDigest bool) (Tool, error) {
	_, a, err := m.selected(id)
	if errors.Is(err, managedtools.ErrUnavailable) {
		return Tool{ID: id, Status: "unavailable", Message: "No verified build is available for this operating system and architecture."}, nil
	}
	if err != nil {
		return Tool{}, err
	}
	t := Tool{ID: id, Version: a.Version, InstallBytes: a.Size, SourceURL: a.URL}
	path := m.binary(id, a)
	directoryErr := m.directories(id, a, false)
	err = directoryErr
	if err == nil {
		err = inspect(path, a, checkDigest)
	}
	switch {
	case err == nil:
		t.Status, t.CanRemove = "installed", true
		t.InstallBytes = 0
		if checkDigest {
			t.Path = path
			t.Message = "The local executable is verified and ready."
		} else {
			t.Message = "Installed. The executable is verified before use or removal."
		}
	case errors.Is(err, os.ErrNotExist):
		t.Status, t.CanInstall = "available", true
		t.Message = "Install the pinned companion when you need it."
	default:
		t.Status = "invalid"
		t.Message = "The local companion path is unsafe or has changed."
		if checkDigest {
			t.RecoveryPath = path
			if directoryErr != nil {
				t.Message = "Inspect the parent directories and permissions, including any links. Preserve existing files, then refresh status."
			} else {
				t.Message = "The companion file could not be verified. Preserve it by moving it outside this managed path, then refresh status and install again."
			}
		}
	}
	if t.Status != "invalid" {
		if entries, readErr := os.ReadDir(filepath.Join(m.base(), id)); readErr == nil {
			for _, entry := range entries {
				if entry.IsDir() && versionPattern.MatchString(entry.Name()) && entry.Name() != a.Version {
					t.Message += " Another version remains in the local companion directory."
					break
				}
			}
		}
	}
	return t, nil
}

func (m *Manager) Inventory() []Tool {
	tools := make([]Tool, 0, len(m.entries))
	for _, entry := range m.entries {
		t, _ := m.status(entry.ID, false)
		tools = append(tools, t)
	}
	return tools
}

// lease never writes to the lock file. A pre-existing regular file could be a
// hard link to user data, so the transfer queue's PID-writing lock is unsafe
// for this independently managed directory. Both modes lock the same byte (or
// inode) and remain compatible with the transfer lock used by older builds.
func (m *Manager) lease(id string, a Asset, exclusive bool) (func(), error) {
	if err := m.directories(id, a, true); err != nil {
		return nil, err
	}
	path := filepath.Join(m.base(), id, "operation.lock")
	before, statErr := os.Lstat(path)
	if statErr == nil && !before.Mode().IsRegular() {
		return nil, managedtools.ErrInvalid
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return nil, managedtools.ErrInvalid
	}
	file, err := openLockFile(path)
	if err != nil {
		return nil, managedtools.ErrInvalid
	}
	opened, err := file.Stat()
	current, currentErr := os.Lstat(path)
	if err != nil || currentErr != nil || !opened.Mode().IsRegular() || !current.Mode().IsRegular() || !os.SameFile(opened, current) || (statErr == nil && !os.SameFile(before, opened)) {
		_ = file.Close()
		return nil, managedtools.ErrInvalid
	}
	if exclusive {
		err = lockExclusive(file)
	} else {
		err = lockShared(file)
	}
	if err != nil {
		_ = file.Close()
		if sharedBusy(err) {
			return nil, managedtools.ErrBusy
		}
		return nil, managedtools.ErrInvalid
	}
	current, err = os.Lstat(path)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(opened, current) {
		_ = unlockShared(file)
		_ = file.Close()
		return nil, managedtools.ErrInvalid
	}
	var once sync.Once
	return func() { once.Do(func() { _ = unlockShared(file); _ = file.Close() }) }, nil
}

func (m *Manager) Install(ctx context.Context, id string) (Tool, error) {
	_, a, err := m.selected(id)
	if err != nil {
		return Tool{}, err
	}
	if err = ctx.Err(); err != nil {
		return Tool{}, err
	}
	release, err := m.lease(id, a, true)
	if err != nil {
		return Tool{}, err
	}
	defer release()
	path := m.binary(id, a)
	if err = inspect(path, a, true); err == nil {
		return m.Status(id)
	} else if !errors.Is(err, os.ErrNotExist) {
		return Tool{}, managedtools.ErrInvalid
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	response, err := m.client.Do(req)
	if err != nil {
		return Tool{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Tool{}, fmt.Errorf("companion download failed: HTTP %d", response.StatusCode)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".download-*")
	if err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, hash), io.LimitReader(response.Body, a.Size+1))
	if err != nil {
		return Tool{}, err
	}
	if n != a.Size || hex.EncodeToString(hash.Sum(nil)) != a.SHA256 {
		return Tool{}, managedtools.ErrInvalid
	}
	if err = ctx.Err(); err != nil {
		return Tool{}, err
	}
	if err = tmp.Chmod(0700); err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	if err = tmp.Sync(); err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	if err = tmp.Close(); err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	promote := tmp.Name()
	if a.Format != "binary" {
		promote, err = extract(ctx, tmp.Name(), filepath.Dir(path), a)
		if err != nil {
			return Tool{}, err
		}
		defer os.Remove(promote)
	}
	if err = ctx.Err(); err != nil {
		return Tool{}, err
	}
	if err = safepromote.Rename(promote, path); err != nil {
		if errors.Is(err, safepromote.ErrUnsupported) {
			return Tool{}, managedtools.ErrStorageUnsupported
		}
		return Tool{}, managedtools.ErrInvalid
	}
	return m.Status(id)
}

func (m *Manager) Remove(id string) (Tool, error) {
	_, a, err := m.selected(id)
	if err != nil {
		return Tool{}, err
	}
	release, err := m.lease(id, a, true)
	if err != nil {
		return Tool{}, err
	}
	defer release()
	path := m.binary(id, a)
	if err = inspect(path, a, true); err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	if err = os.Remove(path); err != nil {
		return Tool{}, managedtools.ErrInvalid
	}
	return m.Status(id)
}

// Acquire verifies the executable and holds a shared use lock until release.
// Callers running a managed executable must keep the lease for its lifetime.
func (m *Manager) Acquire(id string) (string, func(), error) {
	_, a, err := m.selected(id)
	if err != nil {
		return "", nil, err
	}
	release, err := m.lease(id, a, false)
	if err != nil {
		return "", nil, err
	}
	path := m.binary(id, a)
	if err = inspect(path, a, true); err != nil {
		release()
		return "", nil, err
	}
	return path, release, nil
}
