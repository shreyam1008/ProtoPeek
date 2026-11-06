//go:build protopeek_lite

package bundledaria2

import (
	"errors"
	"os"
	"path/filepath"
)

// The optional lightweight build retains the same trust anchor as the default
// embedded build. A missing archive still permits reuse of the pinned v0.7 cache.
var nativeBundle = bundle{
	archiveSHA: windowsArchiveSHA,
	binarySHA:  windowsBinarySHA,
	members:    windowsCacheMembers[:],
	prefix:     "aria2-1.37.0-win-64bit-build1/",
	binary:     "aria2c.exe",
}

func loadNativeBundle() (bundle, error) {
	executable, err := os.Executable()
	if err != nil {
		return bundle{}, ErrCompanionInvalid
	}
	payload := nativeBundle
	payload.archive, err = readCompanion(filepath.Join(filepath.Dir(executable), CompanionFilename), payload.archiveSHA, windowsArchiveSize)
	if errors.Is(err, ErrCompanionMissing) {
		payload.archive, err = readManagedArchive()
	}
	if err != nil {
		return payload, err
	}
	return payload, nil
}
