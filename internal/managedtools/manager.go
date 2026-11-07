// Package managedtools provides explicit, pinned local companion management.
// It never installs services or modifies PATH and does no network work on reads.
package managedtools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

var (
	ErrUnknown            = errors.New("unknown managed extension")
	ErrBusy               = errors.New("managed extension is in use or another operation is running")
	ErrInvalid            = errors.New("managed extension files could not be verified")
	ErrUnavailable        = errors.New("managed extension is unavailable on this platform")
	ErrStorageUnsupported = errors.New("filesystem does not support safe atomic companion installation")
)

// Asset hashes and sizes are from Cloudflare's official 2026.10.7 release.
// For macOS, GitHub's asset digest binds the tarball while the release notes'
// listed values match the extracted executable, independently binding both.
// No caller can supply a URL, executable name, digest, or arguments.
type asset struct {
	platform, version, url, sha string
	size                        int64
	archive                     bool
	binarySHA                   string
	binarySize                  int64
}

var cloudflareAssets = []asset{
	{platform: "windows/amd64", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-windows-amd64.exe", sha: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343", size: 55390512},
	{platform: "windows/386", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-windows-386.exe", sha: "88c6b972b410db0e26745f593510d772c825a13c5a2374819e3f13a05b333082", size: 38097032},
	{platform: "linux/amd64", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-amd64", sha: "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872", size: 40274445},
	{platform: "linux/386", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-386", sha: "4823d2f038395617e04e4070601ab45c0c43f31f15ee7586be299e19ef49d46e", size: 37694235},
	{platform: "linux/arm64", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-arm64", sha: "3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775", size: 37667293},
	{platform: "darwin/amd64", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-darwin-amd64.tgz", sha: "02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848", size: 21834416, archive: true, binarySHA: "5c55e77da7012cebca19170357e196176c48c9647cc2ead404702fa125ddbd86", binarySize: 42430512},
	{platform: "darwin/arm64", version: "2026.10.7", url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-darwin-arm64.tgz", sha: "3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd", size: 19847161, archive: true, binarySHA: "2136431d5eb467bf447d2ee514b713e192719b143aec1d9e09bf7dc290d5bb12", binarySize: 39487168},
}

type Tool struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Version      string `json:"version"`
	InstallBytes int64  `json:"installBytes"`
	CanInstall   bool   `json:"canInstall"`
	CanRemove    bool   `json:"canRemove"`
	Message      string `json:"message"`
	SourceURL    string `json:"sourceUrl,omitempty"`
}
type Inventory struct {
	SchemaVersion int    `json:"schemaVersion"`
	Tools         []Tool `json:"tools"`
}
type Manager struct {
	root, platform string
	client         *http.Client
	assets         []asset
}

func New() (*Manager, error) {
	cache, err := os.UserCacheDir()
	if err != nil || !filepath.IsAbs(cache) {
		return nil, ErrUnavailable
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 8 || req.URL.Scheme != "https" || req.URL.User != nil {
			return ErrInvalid
		}
		return nil
	}}
	return &Manager{root: filepath.Join(cache, "protopeek", "managed"), platform: runtime.GOOS + "/" + runtime.GOARCH, client: client, assets: cloudflareAssets}, nil
}

func (m *Manager) selected() (asset, bool) {
	for _, a := range m.assets {
		if a.platform == m.platform {
			return a, true
		}
	}
	return asset{}, false
}
func (m *Manager) binary(a asset) string {
	name := "cloudflared"
	if strings.HasPrefix(m.platform, "windows/") {
		name += ".exe"
	}
	return filepath.Join(m.root, "cloudflared", a.version, name)
}

// checkDirs rejects symlinked/reparse-point components within our own tree.
// Existing unrelated contents are preserved and never recursively removed.
func (m *Manager) checkDirs(create bool, dirs ...string) error {
	all := append([]string{m.root}, dirs...)
	for _, dir := range all {
		info, err := os.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) && create {
			if err = os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return ErrInvalid
			}
			info, err = os.Lstat(dir)
		}
		if errors.Is(err, os.ErrNotExist) && !create {
			return os.ErrNotExist
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrInvalid
		}
	}
	return nil
}
func (m *Manager) dirs(create bool, a asset) error {
	// User cache and ProtoPeek parent may not yet exist; create only on a user action.
	parent := filepath.Dir(m.root)
	if create {
		if err := os.MkdirAll(filepath.Dir(parent), 0700); err != nil {
			return ErrInvalid
		}
		if err := os.Mkdir(parent, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return ErrInvalid
		}
	}
	if i, e := os.Lstat(parent); errors.Is(e, os.ErrNotExist) && !create {
		return os.ErrNotExist
	} else if e != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return ErrInvalid
	}
	return m.checkDirs(create, filepath.Join(m.root, "cloudflared"), filepath.Join(m.root, "cloudflared", a.version))
}
func verify(path string, a asset) error {
	expectedSize, expectedSHA := a.size, a.sha
	if a.archive {
		expectedSize, expectedSHA = a.binarySize, a.binarySHA
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.ErrNotExist
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() != expectedSize || (!strings.HasPrefix(a.platform, "windows/") && info.Mode().Perm()&0111 == 0) {
		return ErrInvalid
	}
	f, err := os.Open(path)
	if err != nil {
		return ErrInvalid
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != expectedSize {
		return ErrInvalid
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(f, expectedSize+1))
	if err != nil || n != expectedSize || hex.EncodeToString(h.Sum(nil)) != expectedSHA {
		return ErrInvalid
	}
	return nil
}
func (m *Manager) lock(a asset) (transfer.Lock, error) {
	if err := m.dirs(true, a); err != nil {
		return nil, err
	}
	path := filepath.Join(m.root, "cloudflared", "operation.lock")
	if i, e := os.Lstat(path); e == nil && !i.Mode().IsRegular() {
		return nil, ErrInvalid
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return nil, ErrInvalid
	}
	lease, err := (transfer.FileLocker{}).TryLock(path)
	if errors.Is(err, transfer.ErrLockHeld) {
		return nil, ErrBusy
	}
	if err != nil {
		return nil, ErrInvalid
	}
	return lease, nil
}

func (m *Manager) Status(id string) (Tool, error) {
	if id == "aria2" {
		return ariaStatus(), nil
	}
	if id != "cloudflared" {
		return Tool{}, ErrUnknown
	}
	result := Tool{ID: id}
	a, ok := m.selected()
	if !ok {
		result.Status = "unavailable"
		result.Message = "No verified portable build is offered for this operating system and architecture."
		return result, nil
	}
	result.Version = a.version
	result.InstallBytes = a.size
	result.SourceURL = a.url
	err := m.dirs(false, a)
	if err == nil {
		err = verify(m.binary(a), a)
	}
	switch {
	case err == nil:
		result.Status = "installed"
		result.CanRemove = true
		result.InstallBytes = 0
		result.Message = "Verified local companion is ready for Cloudflare Tunnel inspection."
	case errors.Is(err, os.ErrNotExist):
		result.Status = "available"
		result.CanInstall = true
		result.Message = "Download the pinned Cloudflare companion only when you choose Install."
	default:
		result.Status = "invalid"
		result.Message = "Local companion files are unsafe or changed; no automatic repair or deletion was attempted."
	}
	if result.Status == "available" {
		if _, err := exec.LookPath("cloudflared"); err == nil {
			result.Status = "external"
			result.Message = "A cloudflared executable is on PATH. You can also install the verified local companion."
		}
	}
	return result, nil
}
func (m *Manager) Inventory() Inventory {
	out := Inventory{SchemaVersion: 1, Tools: make([]Tool, 0, 2)}
	for _, id := range []string{"cloudflared", "aria2"} {
		t, _ := m.Status(id)
		out.Tools = append(out.Tools, t)
	}
	return out
}

func (m *Manager) Install(ctx context.Context, id string) (Tool, error) {
	if id == "aria2" {
		return m.installAria(ctx)
	}
	if id != "cloudflared" {
		return Tool{}, ErrUnknown
	}
	a, ok := m.selected()
	if !ok {
		return Tool{}, ErrUnavailable
	}
	lease, err := m.lock(a)
	if err != nil {
		return Tool{}, err
	}
	defer lease.Release()
	path := m.binary(a)
	if err = verify(path, a); err == nil {
		return m.Status(id)
	} else if !errors.Is(err, os.ErrNotExist) {
		return Tool{}, ErrInvalid
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.url, nil)
	if err != nil {
		return Tool{}, ErrInvalid
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return Tool{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Tool{}, fmt.Errorf("companion download failed: HTTP %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".download-*")
	if err != nil {
		return Tool{}, ErrInvalid
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(resp.Body, a.size+1))
	if err != nil {
		return Tool{}, err
	}
	if n != a.size || hex.EncodeToString(h.Sum(nil)) != a.sha {
		return Tool{}, ErrInvalid
	}
	if err = ctx.Err(); err != nil {
		return Tool{}, err
	}
	if !a.archive {
		if err = tmp.Chmod(0700); err != nil {
			return Tool{}, ErrInvalid
		}
	}
	if err = tmp.Sync(); err != nil {
		return Tool{}, ErrInvalid
	}
	if err = tmp.Close(); err != nil {
		return Tool{}, ErrInvalid
	}
	promote := tmp.Name()
	if a.archive {
		promote, err = extractArchive(ctx, tmp.Name(), filepath.Dir(path), a)
		if err != nil {
			return Tool{}, err
		}
		defer os.Remove(promote)
	}
	if err = ctx.Err(); err != nil {
		return Tool{}, err
	}
	// Non-replacing atomic rename works without requiring hard-link support.
	if err = safepromote.Rename(promote, path); err != nil {
		if errors.Is(err, safepromote.ErrUnsupported) {
			return Tool{}, ErrStorageUnsupported
		}
		return Tool{}, ErrInvalid
	}
	return m.Status(id)
}
func (m *Manager) Remove(id string) (Tool, error) {
	if id == "aria2" {
		return m.removeAria()
	}
	if id != "cloudflared" {
		return Tool{}, ErrUnknown
	}
	a, ok := m.selected()
	if !ok {
		return Tool{}, ErrUnavailable
	}
	lease, err := m.lock(a)
	if err != nil {
		return Tool{}, err
	}
	defer lease.Release()
	path := m.binary(a)
	if err = verify(path, a); err != nil {
		return Tool{}, ErrInvalid
	}
	if err = os.Remove(path); err != nil {
		return Tool{}, ErrInvalid
	}
	return m.Status(id)
}

// CloudflaredPath accepts only the pinned local binary and never falls back on
// invalid owned files. Absence is represented by os.ErrNotExist.
func CloudflaredPath() (string, error) {
	m, err := New()
	if err != nil {
		return "", os.ErrNotExist
	}
	a, ok := m.selected()
	if !ok {
		return "", os.ErrNotExist
	}
	if err = m.dirs(false, a); err != nil {
		return "", err
	}
	path := m.binary(a)
	if err = verify(path, a); err != nil {
		return "", err
	}
	return path, nil
}

// AcquireCloudflaredUse holds a shared use lease for an owned foreground
// process. Non-managed executables are unaffected.
func AcquireCloudflaredUse(path string) (func(), error) {
	m, err := New()
	if err != nil {
		return func() {}, nil
	}
	a, ok := m.selected()
	if !ok || !strings.EqualFold(filepath.Clean(path), filepath.Clean(m.binary(a))) {
		return func() {}, nil
	}
	lease, err := m.shared(a)
	if err != nil {
		return nil, err
	}
	if err = verify(path, a); err != nil {
		_ = lease.Release()
		return nil, ErrInvalid
	}
	return func() { _ = lease.Release() }, nil
}
