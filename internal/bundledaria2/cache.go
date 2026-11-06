package bundledaria2

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
)

type memberPin struct {
	name string
	size int64
	sha  string
}

// Pin every file extracted by v0.7.0 independently of the optional ZIP.
// Removal verifies and unlinks the executable before touching its notices.
var windowsCacheMembers = [...]memberPin{
	{"aria2c.exe", 5649408, windowsBinarySHA},
	{"COPYING", 18092, "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643"},
	{"AUTHORS", 1231, "674f3d71beaed6015a9fc189fb28835e3bc538aa30dd5c9b4c7effd7024250c1"},
	{"README.mingw", 1561, "a27706a20cbdd5af86b137441afd9e2d55504df18aa4906235aa73489ffe5e23"},
	{"LICENSE.OpenSSL", 6968, "8bf8790acc763bbae4e03f90fd28ee25acdf6daadd3b2adc90101365a403ed07"},
}

var errMemberChanged = errors.Join(ErrCacheInvalid, errors.New("cached file differs from its pin"))

func verifyCacheMember(path string, pin memberPin) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return ErrCacheInvalid
	}
	if info.Size() != pin.size {
		return errMemberChanged
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) || !opened.Mode().IsRegular() {
		return ErrCacheInvalid
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, pin.size+1))
	if err != nil {
		return err
	}
	if n != pin.size || hex.EncodeToString(hash.Sum(nil)) != pin.sha {
		return errMemberChanged
	}
	return nil
}

func isExtractionTemp(entry os.DirEntry) bool {
	suffix, ok := strings.CutPrefix(entry.Name(), ".extract-")
	return ok && suffix != "" && strings.Trim(suffix, "0123456789") == "" && entry.Type().IsRegular()
}

type cacheState int

const (
	cacheAbsent cacheState = iota
	cacheComplete
	cachePartial
	cacheChanged
	cacheUnsafe
)

func inspectCacheDirectory(directory string, pins []memberPin) cacheState {
	file, err := os.Open(directory)
	if errors.Is(err, os.ErrNotExist) {
		return cacheAbsent
	}
	if err != nil {
		return cacheUnsafe
	}
	defer file.Close()
	// An installation contains five known files. Bound local work even when an
	// unrelated application fills this private directory.
	entries, err := file.ReadDir(64)
	if (err != nil && !errors.Is(err, io.EOF)) || len(entries) == 64 {
		return cacheUnsafe
	}
	found := 0
	changed := false
	for _, entry := range entries {
		if isExtractionTemp(entry) {
			continue
		}
		i := slices.IndexFunc(pins, func(p memberPin) bool { return p.name == entry.Name() })
		if i < 0 || !entry.Type().IsRegular() {
			return cacheUnsafe
		}
		err := verifyCacheMember(filepath.Join(directory, entry.Name()), pins[i])
		if errors.Is(err, errMemberChanged) {
			changed = true
		} else if err != nil {
			return cacheUnsafe
		}
		found++
	}
	switch {
	case changed:
		return cacheChanged
	case found == 0:
		return cacheAbsent
	case found == len(pins):
		return cacheComplete
	default:
		return cachePartial
	}
}

// QuarantineChangedCache moves a recognizable, damaged installation aside so
// its original bytes survive explicit repair. The caller owns the engine lease.
func QuarantineChangedCache() error {
	cache, err := os.UserCacheDir()
	if err != nil || nativeBundle.binarySHA != windowsBinarySHA {
		return ErrCacheInvalid
	}
	directory, err := cacheDirectory(cache, windowsBinarySHA, false)
	if err != nil || inspectCacheDirectory(directory, windowsCacheMembers[:]) != cacheChanged {
		return ErrCacheInvalid
	}
	quarantine, err := os.MkdirTemp(filepath.Dir(directory), ".aria2-cache-quarantine-")
	if err != nil {
		return ErrCacheInvalid
	}
	if err = safepromote.Rename(directory, filepath.Join(quarantine, "files")); err != nil {
		_ = os.Remove(quarantine)
		if errors.Is(err, safepromote.ErrUnsupported) {
			return ErrPromotionUnsupported
		}
		return ErrCacheInvalid
	}
	return nil
}
