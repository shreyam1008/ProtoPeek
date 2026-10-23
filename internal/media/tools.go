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
	"time"
)

//go:embed tools.json
var toolManifest []byte

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
	Help         string `json:"help"`
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
	if name == "native-go" {
		return Tool{Name: name, Path: "Built into ProtoPeek", Help: "Direct files, HTML media links, page images and original HTML snapshots. No installation needed."}
	}
	if a, ok := assetFor(name); ok {
		t.CanInstall, t.InstallBytes, t.Version = true, a.Size, a.Version
		p := s.assetPath(a)
		if managedAssetReady(a, p) {
			t.Path = p
		}
	}
	if t.Path == "" {
		t.Path, _ = exec.LookPath(name)
	}
	if t.Path != "" {
		t.InstallBytes = 0
	}
	switch name {
	case "yt-dlp":
		for _, dependency := range []string{"deno", "ffmpeg"} {
			if dependency == "deno" && s.tool("node").Path != "" {
				continue
			}
			if s.tool(dependency).Path == "" {
				if a, ok := assetFor(dependency); ok {
					t.InstallBytes += a.Size
				}
			}
		}
		t.Help = "Videos, audio and playlists. FFmpeg enables merged video and audio; a JavaScript runtime improves YouTube support."
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

// Install only accepts manifest entries, never a URL or executable from a request.
// The request context cancels a partial install; a partial file is never executed.
func (s *Service) Install(ctx context.Context, name string) error {
	if !s.installMu.TryLock() {
		return errors.New("another engine installation is already running")
	}
	defer s.installMu.Unlock()
	if name == "yt-dlp" {
		for _, dependency := range []string{"deno", "ffmpeg"} {
			if dependency == "deno" && s.tool("node").Path != "" {
				continue
			}
			if s.tool(dependency).Path == "" {
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
	if s.tool(name).Path != "" {
		return nil
	}
	a, ok := assetFor(name)
	if !ok {
		return errors.New("no managed build for this engine and platform")
	}
	p := s.assetPath(a)
	notices, err := noticesFor(a)
	if err != nil {
		return err
	}
	return installVerifiedAsset(ctx, a, notices, p, http.DefaultClient)
}

func installVerifiedAsset(ctx context.Context, a Asset, notices assetNotices, p string, client *http.Client) error {
	if err := validateNotices(notices); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(p), ".install-*")
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
	if err := os.WriteFile(filepath.Join(stage, ".verified"), encoded, 0600); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// The receipt is the commit marker. Incomplete/cancelled promotions are not
	// accepted as managed tools, and explicit retry can replace their own files.
	if err := os.Remove(p + ".verified"); err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, file := range receipt.Files {
		if err := os.Rename(filepath.Join(stage, file.Name), filepath.Join(filepath.Dir(p), file.Name)); err != nil {
			return err
		}
	}
	return os.Rename(filepath.Join(stage, ".verified"), p+".verified")
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
