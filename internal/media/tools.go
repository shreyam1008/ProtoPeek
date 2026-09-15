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
		if stat, err := os.Stat(p); err == nil && stat.Mode().IsRegular() {
			if a.Archive == "" {
				t.Path = p
			} else if receipt, err := os.ReadFile(p + ".verified"); err == nil && string(receipt) == a.SHA256 {
				t.Path = p
			}
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
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("engine download: HTTP %d", resp.StatusCode)
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".install-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
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
	if a.Archive == "zip" {
		if err := installZip(ctx, f.Name(), p, a.Engine); err != nil {
			return err
		}
		return os.WriteFile(p+".verified", []byte(a.SHA256), 0600)
	}
	if err = os.Chmod(f.Name(), 0700); err != nil {
		return err
	}
	if _, err := os.Stat(p); err == nil {
		return nil
	}
	return os.Rename(f.Name(), p)
}

func installZip(ctx context.Context, source, executable, engine string) error {
	z, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer z.Close()
	found := false
	for _, entry := range z.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := filepath.Base(entry.Name)
		if name != filepath.Base(executable) && !(engine == "ffmpeg" && name == "ffprobe.exe") {
			continue
		}
		if entry.UncompressedSize64 > 300<<20 || !entry.Mode().IsRegular() {
			return errors.New("invalid executable in engine archive")
		}
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
		_, err = io.Copy(temp, io.LimitReader(reader, 300<<20+1))
		reader.Close()
		if e := temp.Close(); err == nil {
			err = e
		}
		if err == nil {
			err = ctx.Err()
		}
		if err == nil {
			err = os.Chmod(temp.Name(), 0700)
		}
		if err == nil {
			err = os.Rename(temp.Name(), dest)
		}
		os.Remove(temp.Name())
		if err != nil {
			return err
		}
		if strings.EqualFold(dest, executable) {
			found = true
		}
	}
	if !found {
		return errors.New("engine executable missing from verified archive")
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
