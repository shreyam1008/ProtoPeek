// Package bundledaria2 extracts an optional, pinned native aria2 companion.
// Extraction happens only when the user starts Downloader and has no configured
// or PATH engine. No runtime download, installer, elevation, or shell is used.
package bundledaria2

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

var extractMu sync.Mutex

type bundle struct {
	archive                               []byte
	archiveSHA, binarySHA, prefix, binary string
}

// Path returns an empty path without error on builds with no bundled engine.
func Path() (string, error) {
	if len(nativeBundle.archive) == 0 {
		return "", nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolve aria2 cache: %w", err)
	}
	extractMu.Lock()
	defer extractMu.Unlock()
	return extract(nativeBundle, filepath.Join(cache, "protopeek", "engines", "aria2", nativeBundle.binarySHA))
}

func extract(payload bundle, directory string) (string, error) {
	if digest(payload.archive) != payload.archiveSHA {
		return "", errors.New("bundled aria2 archive checksum mismatch")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("aria2 extraction directory must be a real directory")
	}
	target := filepath.Join(directory, payload.binary)
	if info, err := os.Lstat(target); err == nil {
		if !info.Mode().IsRegular() || info.Size() > 16<<20 {
			return "", errors.New("cached aria2 is not a regular executable")
		}
		file, err := os.Open(target)
		if err != nil {
			return "", err
		}
		hash := sha256.New()
		_, readErr := io.Copy(hash, io.LimitReader(file, (16<<20)+1))
		closeErr := file.Close()
		if err := errors.Join(readErr, closeErr); err != nil {
			return "", err
		}
		if hex.EncodeToString(hash.Sum(nil)) != payload.binarySHA {
			return "", fmt.Errorf("cached aria2 checksum mismatch; remove %s and start Downloader again", directory)
		}
		return target, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	reader, err := zip.NewReader(bytes.NewReader(payload.archive), int64(len(payload.archive)))
	if err != nil {
		return "", err
	}
	// Explicit entries only: do not interpret arbitrary archive paths as local paths.
	files := make(map[string]*zip.File)
	for _, entry := range reader.File {
		files[entry.Name] = entry
	}
	// Write notices before exposing the executable. A partial extraction can retry.
	for _, name := range []string{"COPYING", "AUTHORS", "README.mingw", "LICENSE.OpenSSL", payload.binary} {
		entry := files[payload.prefix+name]
		if entry == nil || entry.UncompressedSize64 > 16<<20 {
			return "", fmt.Errorf("bundled aria2 entry %s missing or oversized", name)
		}
		if err := extractFile(entry, filepath.Join(directory, name), name == payload.binary, payload.binarySHA); err != nil {
			return "", err
		}
	}
	return target, nil
}

func extractFile(entry *zip.File, target string, executable bool, binarySHA string) error {
	input, err := entry.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	file, err := os.CreateTemp(filepath.Dir(target), ".extract-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(input, (16<<20)+1))
	if err != nil {
		return err
	}
	if written > 16<<20 || uint64(written) != entry.UncompressedSize64 {
		return errors.New("invalid aria2 archive entry length")
	}
	if executable && hex.EncodeToString(hash.Sum(nil)) != binarySHA {
		return errors.New("bundled aria2 executable checksum mismatch")
	}
	mode := os.FileMode(0o600)
	if executable {
		mode = 0o700
	}
	if err := file.Chmod(mode); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), target)
}

func digest(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
