package bundledaria2

import (
	"errors"
	"io"
	"os"
)

// These fixed messages contain no local paths or arbitrary process output and
// are safe to surface to the user when the optional local companion is absent
// or cannot be verified.
var (
	ErrCompanionMissing     = errors.New("aria2 companion is missing")
	ErrCompanionInvalid     = errors.New("aria2 companion failed verification")
	ErrCacheInvalid         = errors.New("aria2 cache cannot be verified safely")
	ErrPromotionUnsupported = errors.New("filesystem does not support safe aria2 promotion")
)

const (
	CompanionFilename  = "protopeek-aria2-1.37.0-win-64bit-build1.zip"
	EngineVersion      = "1.37.0"
	windowsArchiveSHA  = "67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288"
	windowsBinarySHA   = "be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2"
	windowsArchiveSize = 2475379
)

func CompanionMessage(err error) string {
	switch {
	case errors.Is(err, ErrCompanionMissing):
		return "Install aria2 from Extensions or configure an installed aria2c. For offline setup, place " + CompanionFilename + " beside ProtoPeek."
	case errors.Is(err, ErrCompanionInvalid):
		return "The aria2 archive could not be verified. Repair a changed cached archive in Extensions; replace an invalid sidecar with the unchanged local package."
	case errors.Is(err, ErrCacheInvalid):
		return "The local aria2 cache could not be verified; check its files before retrying."
	case errors.Is(err, ErrPromotionUnsupported):
		return "This filesystem cannot safely install the aria2 companion. Choose a supported local cache location."
	default:
		return "The local aria2 companion is unavailable."
	}
}

// readCompanion takes a fixed, built-in digest and size. It rejects links and
// changed files, reads into bounded memory, and checks the bytes before use.
func readCompanion(path, expectedSHA string, expectedSize int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrCompanionMissing
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() != expectedSize {
		return nil, ErrCompanionInvalid
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, ErrCompanionInvalid
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != expectedSize {
		return nil, ErrCompanionInvalid
	}
	data, err := io.ReadAll(io.LimitReader(f, expectedSize+1))
	if err != nil || int64(len(data)) != expectedSize || digest(data) != expectedSHA {
		return nil, ErrCompanionInvalid
	}
	return data, nil
}
