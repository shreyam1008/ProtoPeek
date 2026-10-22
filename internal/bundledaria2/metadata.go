package bundledaria2

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Metadata describes the included companion and an existing verified cache.
// Inspect never extracts files, creates directories, downloads, or runs aria2.
type Metadata struct {
	Included     bool
	ArchiveBytes int
	CachedPath   string
	CacheError   string
}

func Inspect() Metadata {
	if len(nativeBundle.archive) == 0 {
		return Metadata{}
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return Metadata{Included: true, ArchiveBytes: len(nativeBundle.archive), CacheError: "The user cache directory is unavailable."}
	}
	return inspectBundle(nativeBundle, cache)
}

func inspectBundle(payload bundle, cache string) Metadata {
	result := Metadata{Included: len(payload.archive) != 0, ArchiveBytes: len(payload.archive)}
	if !result.Included {
		return result
	}
	directory := filepath.Join(cache, "protopeek", "engines", "aria2", payload.binarySHA)
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return result
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		result.CacheError = "The existing aria2 cache directory could not be read safely."
		return result
	}
	target := filepath.Join(directory, payload.binary)
	info, err = os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return result
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16<<20 {
		result.CacheError = "The cached aria2 executable is unreadable, not a regular file, or too large."
		return result
	}
	file, err := os.Open(target)
	if err != nil {
		result.CacheError = "The cached aria2 executable could not be read."
		return result
	}
	hash := sha256.New()
	_, readErr := io.Copy(hash, io.LimitReader(file, (16<<20)+1))
	closeErr := file.Close()
	if errors.Join(readErr, closeErr) != nil || hex.EncodeToString(hash.Sum(nil)) != payload.binarySHA {
		result.CacheError = "The cached aria2 executable did not match its pinned checksum."
		return result
	}
	result.CachedPath = target
	return result
}
