//go:build protopeek_lite

package bundledaria2

import (
	"os"
	"path/filepath"
)

// The optional lightweight build retains the same trust anchor as the default
// embedded build. The archive is read only from beside the running executable.
var nativeBundle = bundle{
	archiveSHA: windowsArchiveSHA,
	binarySHA:  windowsBinarySHA,
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
	if err != nil {
		return bundle{}, err
	}
	return payload, nil
}
