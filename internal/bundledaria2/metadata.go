package bundledaria2

import (
	"errors"
	"os"
	"path/filepath"
)

// Metadata describes the included companion and an existing verified cache.
// Inspect never extracts files, creates directories, downloads, or runs aria2.
type Metadata struct {
	Included            bool
	ArchiveBytes        int
	CachedPath          string
	CacheError          string
	Unavailable         string
	ArchiveError        error
	Partial, Repairable bool
}

func Inspect() Metadata {
	payload, err := loadNativeBundle()
	if err != nil && !errors.Is(err, ErrCompanionMissing) {
		return Metadata{ArchiveError: err, Unavailable: CompanionMessage(err)}
	}
	if payload.binary == "" {
		return Metadata{}
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return Metadata{CacheError: "The user cache directory is unavailable."}
	}
	return inspectBundle(payload, cache)
}

func inspectBundle(payload bundle, cache string) Metadata {
	result := Metadata{Included: len(payload.archive) != 0, ArchiveBytes: len(payload.archive)}
	if payload.binary == "" {
		return result
	}
	if result.Included && digest(payload.archive) != payload.archiveSHA {
		result.CacheError = "The aria2 companion did not match its pinned checksum."
		return result
	}
	dir, err := cacheDirectory(cache, payload.binarySHA, false)
	state := cacheAbsent
	if err == nil {
		state = inspectCacheDirectory(dir, payload.members)
	} else if !errors.Is(err, os.ErrNotExist) {
		state = cacheUnsafe
	}
	switch state {
	case cacheComplete:
		result.CachedPath = filepath.Join(dir, payload.binary)
	case cachePartial:
		result.Partial = true
	case cacheChanged:
		result.CacheError = CompanionMessage(ErrCacheInvalid)
		result.Repairable = true
	case cacheUnsafe:
		result.CacheError = CompanionMessage(ErrCacheInvalid)
	case cacheAbsent:
		if !result.Included {
			result.ArchiveError = ErrCompanionMissing
			result.Unavailable = CompanionMessage(ErrCompanionMissing)
		}
	}
	return result
}
