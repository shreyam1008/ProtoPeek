package media

import (
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
	"path/filepath"
	"strings"
)

//go:embed tool-notices.json
var noticeManifest []byte

const maxNoticeBytes = 512 << 10

type noticeFile struct {
	Name    string `json:"name"`
	URL     string `json:"url,omitempty"`
	Archive bool   `json:"archive,omitempty"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
}

type assetNotices struct {
	Engine       string       `json:"engine"`
	Version      string       `json:"version"`
	Distribution string       `json:"distribution"`
	SourceURL    string       `json:"sourceUrl"`
	Files        []noticeFile `json:"files"`
}

type installedFile struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type toolReceipt struct {
	SchemaVersion int             `json:"schemaVersion"`
	Asset         Asset           `json:"asset"`
	Notices       assetNotices    `json:"notices"`
	Files         []installedFile `json:"files"`
}

func noticesFor(a Asset) (assetNotices, error) {
	var entries []assetNotices
	if err := json.Unmarshal(noticeManifest, &entries); err != nil {
		return assetNotices{}, err
	}
	for _, entry := range entries {
		if entry.Engine == a.Engine && entry.Version == a.Version {
			return entry, validateNotices(entry)
		}
	}
	return assetNotices{}, errors.New("managed engine notice metadata is unavailable")
}

func validateNotices(n assetNotices) error {
	if n.Engine == "" || n.Version == "" || n.Distribution == "" || !strings.HasPrefix(n.SourceURL, "https://") || len(n.Files) == 0 || len(n.Files) > 16 {
		return errors.New("invalid managed engine notice metadata")
	}
	seen, total := map[string]bool{}, int64(0)
	for _, file := range n.Files {
		_, err := hex.DecodeString(file.SHA256)
		if file.Name == "" || file.Name == "." || file.Name == ".." || file.Name == ".verified" || strings.ContainsAny(file.Name, "/\\:\x00") || seen[file.Name] || file.Size <= 0 || file.Size > maxNoticeBytes || err != nil || len(file.SHA256) != 64 || (!file.Archive && !strings.HasPrefix(file.URL, "https://")) || (file.Archive && file.URL != "") {
			return errors.New("invalid managed engine notice file")
		}
		seen[file.Name] = true
		total += file.Size
	}
	if total > 1<<20 {
		return errors.New("managed engine notices exceed their aggregate bound")
	}
	return nil
}

// Snapshot only reads small local receipts and stats, never downloads notices or
// hashes entire executables. The receipt is created after explicit verification.
func managedAssetReady(a Asset, executable string) bool {
	f, err := os.Open(executable + ".verified")
	if err != nil {
		return false
	}
	defer f.Close()
	var receipt toolReceipt
	data, err := io.ReadAll(io.LimitReader(f, (32<<10)+1))
	if err != nil || len(data) > 32<<10 || json.Unmarshal(data, &receipt) != nil || receipt.SchemaVersion != 1 || receipt.Asset != a {
		return false
	}
	notices, err := noticesFor(a)
	if err != nil {
		return false
	}
	expected, _ := json.Marshal(notices)
	observed, _ := json.Marshal(receipt.Notices)
	if string(expected) != string(observed) {
		return false
	}
	needed := map[string]bool{filepath.Base(executable): true}
	if a.Engine == "ffmpeg" {
		needed["ffprobe.exe"] = true
	}
	for _, notice := range notices.Files {
		needed[notice.Name] = true
	}
	for _, file := range receipt.Files {
		if !needed[file.Name] || file.Size <= 0 {
			return false
		}
		info, err := os.Lstat(filepath.Join(filepath.Dir(executable), file.Name))
		if err != nil || !info.Mode().IsRegular() || info.Size() != file.Size {
			return false
		}
		delete(needed, file.Name)
	}
	return len(needed) == 0
}

func prepareNotices(ctx context.Context, client *http.Client, notices assetNotices, directory string) error {
	for _, notice := range notices.Files {
		if notice.Archive {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, notice.URL, nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("engine notice download failed: %w", err)
		}
		err = func() error {
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("engine notice download: HTTP %d", resp.StatusCode)
			}
			f, err := os.OpenFile(filepath.Join(directory, notice.Name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return err
			}
			err = verifyCopy(f, resp.Body, Asset{Size: notice.Size, SHA256: notice.SHA256})
			if closeErr := f.Close(); err == nil {
				err = closeErr
			}
			return err
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func recordVerifiedFiles(a Asset, notices assetNotices, directory, executable string) (toolReceipt, error) {
	receipt := toolReceipt{SchemaVersion: 1, Asset: a, Notices: notices}
	names := []string{filepath.Base(executable)}
	if a.Engine == "ffmpeg" {
		names = append(names, "ffprobe.exe")
	}
	for _, notice := range notices.Files {
		names = append(names, notice.Name)
	}
	for _, name := range names {
		f, err := os.Open(filepath.Join(directory, name))
		if err != nil {
			return receipt, err
		}
		hash := sha256.New()
		size, err := io.Copy(hash, f)
		f.Close()
		if err != nil {
			return receipt, err
		}
		digest := hex.EncodeToString(hash.Sum(nil))
		for _, notice := range notices.Files {
			if name == notice.Name && (size != notice.Size || digest != notice.SHA256) {
				return receipt, errors.New("managed engine notice size or SHA-256 mismatch")
			}
		}
		receipt.Files = append(receipt.Files, installedFile{Name: name, Size: size, SHA256: digest})
	}
	return receipt, nil
}
