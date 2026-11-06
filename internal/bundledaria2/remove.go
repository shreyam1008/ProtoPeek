package bundledaria2

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// RemoveCached removes only the exact verified cache created by this package.
// The caller must hold the downloader's process lock throughout the operation.
func RemoveCached() error {
	payload, err := loadNativeBundle()
	if err != nil {
		return err
	}
	if len(payload.archive) == 0 || digest(payload.archive) != payload.archiveSHA {
		return errors.New("aria2 companion unavailable")
	}
	if err := checkManagedArchive(); err != nil {
		return err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return errors.New("aria2 cache unavailable")
	}
	parts := []string{filepath.Join(cache, "protopeek"), filepath.Join(cache, "protopeek", "engines"), filepath.Join(cache, "protopeek", "engines", "aria2"), filepath.Join(cache, "protopeek", "engines", "aria2", payload.binarySHA)}
	for _, dir := range parts {
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("aria2 cache is not a safe directory")
		}
	}
	directory := parts[len(parts)-1]
	names := []string{"COPYING", "AUTHORS", "README.mingw", "LICENSE.OpenSSL", payload.binary}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != len(names) {
		return errors.New("aria2 cache contains unexpected files")
	}
	archive, err := zip.NewReader(bytes.NewReader(payload.archive), int64(len(payload.archive)))
	if err != nil {
		return errors.New("aria2 archive invalid")
	}
	for _, name := range names {
		var source *zip.File
		for _, entry := range archive.File {
			if entry.Name == payload.prefix+name {
				if source != nil {
					return errors.New("duplicate archive entry")
				}
				source = entry
			}
		}
		if source == nil || source.UncompressedSize64 > 16<<20 {
			return errors.New("aria2 archive entry invalid")
		}
		reader, err := source.Open()
		if err != nil {
			return errors.New("aria2 archive entry unavailable")
		}
		expected := sha256.New()
		count, readErr := io.Copy(expected, io.LimitReader(reader, 16<<20+1))
		closeErr := reader.Close()
		if readErr != nil || closeErr != nil || uint64(count) != source.UncompressedSize64 {
			return errors.New("aria2 archive entry invalid")
		}
		path := filepath.Join(directory, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() != count {
			return errors.New("aria2 cache changed")
		}
		file, err := os.Open(path)
		if err != nil {
			return errors.New("aria2 cache unavailable")
		}
		opened, err := file.Stat()
		if err != nil || !os.SameFile(info, opened) {
			file.Close()
			return errors.New("aria2 cache changed")
		}
		actual := sha256.New()
		copied, readErr := io.Copy(actual, io.LimitReader(file, count+1))
		closeErr = file.Close()
		if readErr != nil || closeErr != nil || copied != count || !bytes.Equal(actual.Sum(nil), expected.Sum(nil)) {
			return errors.New("aria2 cache changed")
		}
	}
	for _, name := range names {
		if err := os.Remove(filepath.Join(directory, name)); err != nil {
			return errors.New("aria2 cache could not be fully removed")
		}
	}
	if err := os.Remove(directory); err != nil {
		return errors.New("aria2 cache directory could not be removed")
	}
	return removeManagedArchive()
}
