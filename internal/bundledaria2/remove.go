package bundledaria2

import (
	"errors"
	"os"
	"path/filepath"
)

// RemoveCached removes independently pinned files while holding the downloader lease.
// The same pins apply to an embedded install, a managed ZIP, or a verified v0.7 cache.
func RemoveCached() error {
	_, err := loadNativeBundle()
	if err != nil && !errors.Is(err, ErrCompanionMissing) {
		return err
	}
	if nativeBundle.binarySHA != windowsBinarySHA {
		return ErrCompanionMissing
	}
	if err := checkManagedArchive(); err != nil {
		return err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return ErrCacheInvalid
	}
	dir, err := cacheDirectory(cache, windowsBinarySHA, false)
	if errors.Is(err, os.ErrNotExist) {
		return removeManagedArchive()
	}
	if err != nil {
		return ErrCacheInvalid
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ErrCacheInvalid
	}
	// Never delete abandoned extraction data or unknown files. Other unexpected
	// entries (including links) block removal before any managed file is touched.
	var retainedTemp bool
	known := make(map[string]memberPin, len(windowsCacheMembers))
	for _, pin := range windowsCacheMembers {
		known[pin.name] = pin
	}
	for _, entry := range entries {
		if _, ok := known[entry.Name()]; ok {
			continue
		}
		if !isExtractionTemp(entry) {
			return ErrCacheInvalid
		}
		retainedTemp = true
	}
	var verified []string
	for _, pin := range windowsCacheMembers {
		member := filepath.Join(dir, pin.name)
		if err := verifyCacheMember(member, pin); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return ErrCacheInvalid
		}
		verified = append(verified, member)
	}
	// The executable is first. A busy executable leaves every notice in place.
	// A subsequent call verifies any remaining subset after an interrupted remove.
	for _, member := range verified {
		if err := os.Remove(member); err != nil && !errors.Is(err, os.ErrNotExist) {
			return ErrCacheInvalid
		}
	}
	if !retainedTemp {
		if err := os.Remove(dir); err != nil {
			return ErrCacheInvalid
		}
	}
	return removeManagedArchive()
}
