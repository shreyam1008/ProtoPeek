// Package media manages optional local download engines. No engine is started
// until the user asks to inspect or download a URL.
package media

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
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
	"github.com/shreyam1008/ProtoPeek/internal/userroot"
)

//go:embed tools.json
var toolManifest []byte

var ErrInstallUnsafe = errors.New("existing media tool files or unsafe directories prevent installation")
var ErrInstallUnsupported = errors.New("filesystem does not support safe atomic tool installation")
var ErrExternalToolPresent = errors.New("an external tool is already on PATH")
var ErrLocalUnavailable = errors.New("the local media tool directory is unavailable")

type Asset struct {
	Archive  string `json:"archive,omitempty"`
	Engine   string `json:"engine"`
	Platform string `json:"platform"`
	Version  string `json:"version"`
	URL      string `json:"url"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
}

type Tool struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	Version      string `json:"version"`
	InstallBytes int64  `json:"installBytes"`
	CanInstall   bool   `json:"canInstall"`
	CanRemove    bool   `json:"canRemove"`
	Incomplete   bool   `json:"incomplete,omitempty"`
	Invalid      bool   `json:"invalid,omitempty"`
	Help         string `json:"help"`
	warning      string
}

func assetFor(name string) (Asset, bool) {
	var assets []Asset
	_ = json.Unmarshal(toolManifest, &assets)
	for _, a := range assets {
		if a.Engine == name && a.Platform == runtime.GOOS+"/"+runtime.GOARCH {
			return a, true
		}
	}
	return Asset{}, false
}

func (s *Service) tool(name string) Tool {
	t := Tool{Name: name}
	invalidLocal := false
	if name == "native-go" {
		return Tool{Name: name, Path: "Built into ProtoPeek", Help: "Direct files, HTML media links, page images and original HTML snapshots. No installation needed."}
	}
	if a, ok := assetFor(name); ok {
		t.CanInstall, t.InstallBytes, t.Version = true, a.Size, a.Version
		p := s.assetPath(a)
		if checkExistingAncestors(filepath.Dir(p)) != nil {
			invalidLocal = true
		} else if managedAssetReady(a, p) {
			files, pinned := removalFiles(a, filepath.Base(p))
			entries, err := os.ReadDir(filepath.Dir(p))
			if pinned && err == nil && len(entries) == len(files)+1 {
				t.Path, t.CanRemove = p, true
			} else if s.recoverable(a, p) {
				t.Incomplete, t.CanRemove = true, true
			} else {
				invalidLocal = true
			}
		} else if s.recoverable(a, p) {
			t.Incomplete = true
			t.CanRemove = true
		} else if entries, err := os.ReadDir(filepath.Dir(p)); (err == nil && len(entries) > 0) || (err != nil && !errors.Is(err, os.ErrNotExist)) {
			invalidLocal = true
		}
	}
	if invalidLocal {
		t.Invalid = true
		t.CanInstall = false
	}
	if t.Path == "" && !t.Incomplete && !invalidLocal {
		t.Path, _ = exec.LookPath(name)
	}
	if t.Path != "" {
		t.InstallBytes = 0
	}
	switch name {
	case "yt-dlp":
		var invalid []string
		for _, dependency := range []string{"deno", "ffmpeg"} {
			if dependency == "deno" && s.tool("node").Path != "" {
				continue
			}
			dep := s.tool(dependency)
			if dep.Invalid || dep.Incomplete {
				invalid = append(invalid, dependency)
				continue
			}
			if dep.Path == "" {
				if a, ok := assetFor(dependency); ok {
					t.InstallBytes += a.Size
				}
			}
		}
		t.Help = "Videos, audio and playlists. FFmpeg enables merged video and audio; a JavaScript runtime improves YouTube support."
		if len(invalid) > 0 {
			t.warning = "Setup skips optional " + strings.Join(invalid, " and ") + ": review their incomplete or changed files in Extensions before setting them up separately."
			t.Help += " " + t.warning
		}
	case "gallery-dl":
		t.Help = "Image galleries and albums. On platforms without a managed build, install gallery-dl with your package manager."
	case "archivebox":
		t.Help = "Optional full website archiving. Install ArchiveBox on Linux/macOS; Windows requires a separately configured Docker or WSL service."
		if runtime.GOOS == "windows" {
			t.Path = ""
		}
	case "ffmpeg":
		t.Help = "Optional: install FFmpeg on PATH for high-quality video merging and audio conversion."
	case "node":
		t.Help = "Optional JavaScript runtime for YouTube extraction (Node 22+)."
	case "deno":
		t.Help = "Optional JavaScript runtime for YouTube extraction."
	}
	return t
}

func (s *Service) assetPath(a Asset) string {
	name := a.Engine
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(s.root, "tools", a.Engine, a.Version, name)
}

// selectedTool resolves a path once and verifies managed bytes immediately
// before launch. PATH tools remain explicitly external to ProtoPeek.
func (s *Service) selectedTool(name string) (string, error) {
	a, ok := assetFor(name)
	if !ok {
		path, _ := exec.LookPath(name)
		return path, nil
	}
	path := s.assetPath(a)
	if err := checkExistingAncestors(filepath.Dir(path)); err != nil {
		return "", errors.New("managed media tool directory is unsafe")
	}
	_, binaryErr := os.Lstat(path)
	_, receiptErr := os.Lstat(path + ".verified")
	if errors.Is(binaryErr, os.ErrNotExist) && errors.Is(receiptErr, os.ErrNotExist) {
		external, _ := exec.LookPath(name)
		return external, nil
	}
	files, pinned := removalFiles(a, filepath.Base(path))
	notices, noticeErr := noticesFor(a)
	if !pinned || noticeErr != nil || verifyManagedAsset(s.root, a, path, files, notices) != nil {
		return "", errors.New("managed media tool could not be verified; check its local files")
	}
	return path, nil
}

func checkExistingAncestors(path string) error {
	abs, err := filepath.Abs(userroot.CanonicalTemp(path))
	if err != nil {
		return err
	}
	for dir := abs; ; dir = filepath.Dir(dir) {
		info, err := os.Lstat(dir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return errors.New("unsafe directory")
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	return nil
}

// Install only accepts manifest entries, never a URL or executable from a request.
// The request context cancels a partial install; a partial file is never executed.
func (s *Service) Install(ctx context.Context, name string) error {
	if !s.installMu.TryLock() {
		return errors.New("another engine installation is already running")
	}
	defer s.installMu.Unlock()
	current := s.tool(name)
	if current.Invalid {
		return ErrInstallUnsafe
	}
	if current.Path != "" && !current.CanRemove && (name != "yt-dlp" || current.InstallBytes == 0) {
		return ErrExternalToolPresent
	}
	if name == "yt-dlp" {
		for _, dependency := range []string{"deno", "ffmpeg"} {
			if dependency == "deno" && s.tool("node").Path != "" {
				continue
			}
			dep := s.tool(dependency)
			if !dep.Invalid && !dep.Incomplete && dep.Path == "" {
				if _, ok := assetFor(dependency); ok {
					if err := s.installAsset(ctx, dependency); err != nil {
						return err
					}
				}
			}
		}
	}
	return s.installAsset(ctx, name)
}

func (s *Service) installAsset(ctx context.Context, name string) error {
	a, ok := assetFor(name)
	if !ok {
		return errors.New("no managed build for this engine and platform")
	}
	p := s.assetPath(a)
	notices, err := noticesFor(a)
	if err != nil {
		return err
	}
	current := s.tool(name)
	if current.Incomplete {
		files, _ := removalFiles(a, filepath.Base(p))
		if err := removeVerifiedAsset(s.root, a, p, files, notices); err != nil {
			return err
		}
	} else if current.Path != "" {
		return nil
	}
	return installVerifiedAsset(ctx, a, notices, p, http.DefaultClient)
}

// RecoveryGuidance identifies only a manifest-selected local directory; it
// never moves or removes files. Users can preserve unexpected contents before
// attempting setup again.
func (s *Service) RecoveryGuidance(name string) string {
	a, ok := assetFor(name)
	if !ok {
		return "Inspect the local media tool directory before retrying."
	}
	return "Inspect the tool's version folder and its parent directories: " + filepath.Dir(s.assetPath(a)) + ". If the folder is yours, move it to a safe location to preserve its contents, then retry setup. Do not follow unsafe links."
}

func (s *Service) recoverable(a Asset, path string) bool {
	files, ok := removalFiles(a, filepath.Base(path))
	if !ok {
		return false
	}
	notices, err := noticesFor(a)
	if err != nil {
		return false
	}
	_ = notices
	return partialCandidate(path, files)
}

func installVerifiedAsset(ctx context.Context, a Asset, notices assetNotices, p string, client *http.Client) error {
	return installVerifiedAssetWithPromotion(ctx, a, notices, p, client, safepromote.Rename)
}

func installVerifiedAssetWithPromotion(ctx context.Context, a Asset, notices assetNotices, p string, client *http.Client, promote func(string, string) error) error {
	if err := validateNotices(notices); err != nil {
		return err
	}
	destination := filepath.Dir(p)
	parent := filepath.Dir(destination)
	if err := ensureSafeDirectory(parent); err != nil {
		return err
	}
	info, statErr := os.Lstat(destination)
	if statErr == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		return ErrInstallUnsafe
	}
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return ErrInstallUnsafe
	}
	entries, err := os.ReadDir(destination)
	if err == nil {
		if len(entries) != 0 {
			return ErrInstallUnsafe
		}
		if err := os.Remove(destination); err != nil {
			return ErrInstallUnsafe
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return ErrInstallUnsafe
	}
	stage, err := os.MkdirTemp(parent, ".install-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("engine download: HTTP %d", resp.StatusCode)
	}
	f, err := os.CreateTemp(stage, ".package-*")
	if err != nil {
		return err
	}
	err = verifyCopy(f, resp.Body, a)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	stagedExecutable := filepath.Join(stage, filepath.Base(p))
	if a.Archive == "zip" {
		if err := installZip(ctx, f.Name(), stagedExecutable, a.Engine, notices.Files...); err != nil {
			return err
		}
		if err := os.Remove(f.Name()); err != nil {
			return err
		}
	} else {
		if err = os.Chmod(f.Name(), 0700); err != nil {
			return err
		}
		if err = os.Rename(f.Name(), stagedExecutable); err != nil {
			return err
		}
	}
	if err := prepareNotices(ctx, client, notices, stage); err != nil {
		return err
	}
	receipt, err := recordVerifiedFiles(a, notices, stage, p)
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(stage, filepath.Base(p)+".verified"), encoded, 0600); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// The complete directory is promoted atomically without replacing any
	// existing path. Interrupted staging remains outside the active version.
	if err := ensureSafeDirectory(parent); err != nil {
		return err
	}
	if err := promote(stage, destination); err != nil {
		if errors.Is(err, safepromote.ErrUnsupported) {
			return ErrInstallUnsupported
		}
		if _, statErr := os.Lstat(destination); statErr == nil {
			return ErrInstallUnsafe
		}
		return ErrLocalUnavailable
	}
	return nil
}

func ensureSafeDirectory(path string) error {
	abs, err := filepath.Abs(userroot.CanonicalTemp(path))
	if err != nil {
		return ErrLocalUnavailable
	}
	var missing []string
	for dir := abs; ; dir = filepath.Dir(dir) {
		info, err := os.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) {
			missing = append(missing, dir)
		} else if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrInstallUnsafe
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	for i := len(missing) - 1; i >= 0; i-- {
		if err := os.Mkdir(missing[i], 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return ErrLocalUnavailable
		}
		info, err := os.Lstat(missing[i])
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrInstallUnsafe
		}
	}
	return nil
}

func installZip(ctx context.Context, source, executable, engine string, notices ...noticeFile) error {
	z, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer z.Close()
	if len(z.File) > 4096 {
		return errors.New("engine archive has too many entries")
	}
	required := map[string]int64{filepath.Base(executable): 300 << 20}
	if engine == "ffmpeg" {
		required["ffprobe.exe"] = 300 << 20
	}
	for _, notice := range notices {
		if notice.Archive {
			required[notice.Name] = notice.Size
		}
	}
	found := map[string]bool{}
	for _, entry := range z.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := filepath.Base(entry.Name)
		limit, selected := required[name]
		if !selected {
			continue
		}
		if found[name] || entry.UncompressedSize64 == 0 || entry.UncompressedSize64 > uint64(limit) || !entry.Mode().IsRegular() {
			return errors.New("invalid or duplicate selected file in engine archive")
		}
		found[name] = true
		reader, err := entry.Open()
		if err != nil {
			return err
		}
		dest := filepath.Join(filepath.Dir(executable), name)
		temp, err := os.CreateTemp(filepath.Dir(dest), ".unpack-*")
		if err != nil {
			reader.Close()
			return err
		}
		n, err := io.Copy(temp, io.LimitReader(reader, limit+1))
		if err == nil && (n != int64(entry.UncompressedSize64) || n > limit) {
			err = errors.New("engine archive member exceeds its declared size")
		}
		reader.Close()
		if e := temp.Close(); err == nil {
			err = e
		}
		if err == nil {
			err = ctx.Err()
		}
		if err == nil {
			mode := os.FileMode(0600)
			if name == filepath.Base(executable) || (engine == "ffmpeg" && name == "ffprobe.exe") {
				mode = 0700
			}
			err = os.Chmod(temp.Name(), mode)
		}
		if err == nil {
			err = os.Rename(temp.Name(), dest)
		}
		os.Remove(temp.Name())
		if err != nil {
			return err
		}
	}
	if len(found) != len(required) {
		return errors.New("engine executable or required notice missing from verified archive")
	}
	return nil
}

func verifyCopy(dst io.Writer, src io.Reader, a Asset) error {
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(dst, h), io.LimitReader(src, a.Size+1))
	if err != nil {
		return err
	}
	if n != a.Size || hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
		return errors.New("engine size or SHA-256 mismatch; installation rejected")
	}
	return nil
}
