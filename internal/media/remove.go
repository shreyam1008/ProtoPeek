package media

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
	"github.com/shreyam1008/ProtoPeek/internal/userroot"
)

var ErrRemoveBusy = errors.New("stop active media downloads before removing this tool")
var ErrRemoveInvalid = errors.New("managed tool files could not be verified; nothing was removed")
var ErrNotInstalled = errors.New("no managed copy of this media tool is installed")

// These hashes are derived from members of the exact SHA-256 pinned archives
// in tools.json. A new archive requires explicit member pins before removal.
var archiveMembers = map[string][]installedFile{
	"15e5300b0ba3c3695a7621d90160a746ec9e710228cee639afa9d580f6e3cd11": {{Name: "deno.exe", Size: 97316640, SHA256: "2ff9493dfa356be2975f477025ea770088e9e9cb2c83d983236d13561b96b7a6"}},
	"394f07f4da2bebe6ce6f1e7ce0fa16429b29b08c35e3fac3fe25972676dff4b2": {{Name: "deno", Size: 95600728, SHA256: "bceb5b6a6239b0b010418406d8c77a508f67cf4337d94288f1c19fe71304aab0"}},
	"9a46afc6c392c7cd2ff71a31558935545b46408d0e87f7a86908c712721c046e": {{Name: "deno", Size: 84905856, SHA256: "d08d392418df53f4e6e88a08909c0e1bccbf9adcead7232df72b6ad6075ec416"}},
	"7d4524b82bcc557fe020a1a5b56956ed42b992ae5b28026e8ad5d17329533f5f": {{Name: "deno", Size: 97693344, SHA256: "ec9fbd8e8f5f6ca5ceb0ebe4a564636f2c698bf60e3187460ded400cc0147fd5"}},
	"213a2f304f04d3c9cb5220669afad138f60a5aab1fe80962abdeb8f35807a472": {{Name: "deno", Size: 80915104, SHA256: "b3ac3bd206e48c26026cadd80c1367e96c149f9c66130952382a642b09fa8a71"}},
	"60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba": {{Name: "ffmpeg.exe", Size: 105423872, SHA256: "3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec"}, {Name: "ffprobe.exe", Size: 105221120, SHA256: "f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52"}},
}

func removalFiles(a Asset, executable string) ([]installedFile, bool) {
	var files []installedFile
	if a.Archive == "" {
		files = []installedFile{{Name: executable, Size: a.Size, SHA256: a.SHA256}}
	} else {
		files = append(files, archiveMembers[a.SHA256]...)
		if len(files) == 0 || files[0].Name != executable {
			return nil, false
		}
	}
	notices, err := noticesFor(a)
	if err != nil {
		return nil, false
	}
	for _, n := range notices.Files {
		files = append(files, installedFile{Name: n.Name, Size: n.Size, SHA256: n.SHA256})
	}
	return files, true
}

func (s *Service) Remove(name string) error {
	if name != "yt-dlp" && name != "gallery-dl" && name != "deno" && name != "ffmpeg" {
		return ErrRemoveInvalid
	}
	if !s.installMu.TryLock() {
		return ErrRemoveBusy
	}
	defer s.installMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j == nil {
			continue
		}
		_, running := s.cancels[j.ID]
		active := running || j.Status == "queued" || j.Status == "downloading" || j.Status == "processing" || j.Status == "cancelling"
		uses := j.Request.Engine == name || ((name == "deno" || name == "ffmpeg") && j.Request.Engine == "yt-dlp")
		if active && uses {
			return ErrRemoveBusy
		}
	}
	a, ok := assetFor(name)
	if !ok {
		return ErrNotInstalled
	}
	path := s.assetPath(a)
	if _, err := os.Lstat(filepath.Dir(path)); errors.Is(err, os.ErrNotExist) {
		return ErrNotInstalled
	}
	files, ok := removalFiles(a, filepath.Base(path))
	if !ok {
		return ErrRemoveInvalid
	}
	notices, err := noticesFor(a)
	if err != nil {
		return ErrRemoveInvalid
	}
	return removeVerifiedAsset(s.root, a, path, files, notices)
}

func removeVerifiedAsset(root string, a Asset, path string, files []installedFile, notices assetNotices) error {
	if err := verifyPartialManagedAsset(root, a, path, files, notices); err != nil {
		return err
	}
	// Older builds staged inside the active version. Preserve, rather than
	// delete, any abandoned stage contents when the user explicitly repairs.
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		return ErrRemoveInvalid
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".install-") {
			continue
		}
		parent := filepath.Dir(filepath.Dir(path))
		quarantine, err := os.MkdirTemp(parent, ".preserved-install-*")
		if err != nil {
			return ErrRemoveInvalid
		}
		if err := os.Remove(quarantine); err != nil {
			return ErrRemoveInvalid
		}
		if err := safepromote.Rename(filepath.Join(filepath.Dir(path), entry.Name()), quarantine); err != nil {
			return ErrRemoveInvalid
		}
	}
	// Receipt removal is the commit point; every remaining pinned file can be
	// safely retried if the process exits midway through deletion.
	if err := os.Remove(path + ".verified"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return errors.New("the tool could not be fully removed")
	}
	for _, expected := range files {
		if err := os.Remove(filepath.Join(filepath.Dir(path), expected.Name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return errors.New("some verified files could not be removed; check the local tool directory")
		}
	}
	if os.Remove(filepath.Dir(path)) != nil {
		return errors.New("the verified tool could not be fully removed")
	}
	return nil
}

func verifyManagedAsset(root string, a Asset, path string, files []installedFile, notices assetNotices) error {
	if err := verifyPartialManagedAsset(root, a, path, files, notices); err != nil {
		return err
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(entries) != len(files)+1 {
		return ErrRemoveInvalid
	}
	for _, expected := range files {
		if _, err := os.Lstat(filepath.Join(filepath.Dir(path), expected.Name)); err != nil {
			return ErrRemoveInvalid
		}
	}
	if _, err := os.Lstat(path + ".verified"); err != nil {
		return ErrRemoveInvalid
	}
	return nil
}

func sameReceiptFiles(actual, expected []installedFile) bool {
	if len(actual) != len(expected) {
		return false
	}
	want := make(map[string]installedFile, len(expected))
	for _, file := range expected {
		want[file.Name] = file
	}
	for _, file := range actual {
		if want[file.Name] != file {
			return false
		}
		delete(want, file.Name)
	}
	return len(want) == 0
}

// Status only classifies a candidate by structure and size. It is not a
// verification result; mutation and execution still hash every pinned file.
func partialCandidate(path string, files []installedFile) bool {
	dir := filepath.Dir(path)
	if checkExistingAncestors(dir) != nil {
		return false
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	want := make(map[string]installedFile, len(files))
	for _, file := range files {
		want[file.Name] = file
	}
	for _, entry := range entries {
		name := entry.Name()
		info, err := os.Lstat(filepath.Join(dir, name))
		if err != nil {
			return false
		}
		if strings.HasPrefix(name, ".install-") && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			continue
		}
		if name == filepath.Base(path)+".verified" {
			if !info.Mode().IsRegular() || info.Size() > 32<<10 {
				return false
			}
			continue
		}
		file, ok := want[name]
		if !ok || !info.Mode().IsRegular() || info.Size() != file.Size {
			return false
		}
	}
	return true
}

func verifyPartialManagedAsset(root string, a Asset, path string, files []installedFile, notices assetNotices) error {
	absRoot, err := filepath.Abs(userroot.CanonicalTemp(root))
	if err != nil {
		return ErrRemoveInvalid
	}
	for dir := absRoot; ; dir = filepath.Dir(dir) {
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrRemoveInvalid
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	for _, dir := range []string{root, filepath.Join(root, "tools"), filepath.Join(root, "tools", a.Engine), filepath.Dir(path)} {
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrRemoveInvalid
		}
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		return ErrRemoveInvalid
	}
	want := make(map[string]installedFile, len(files))
	for _, file := range files {
		want[file.Name] = file
	}
	for _, entry := range entries {
		if entry.Name() != filepath.Base(path)+".verified" {
			if strings.HasPrefix(entry.Name(), ".install-") && entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
				continue
			}
			if _, ok := want[entry.Name()]; !ok {
				return ErrRemoveInvalid
			}
		}
	}
	receiptPath := path + ".verified"
	info, err := os.Lstat(receiptPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return ErrRemoveInvalid
	}
	if err == nil && (!info.Mode().IsRegular() || info.Size() > 32<<10) {
		return ErrRemoveInvalid
	}
	if err == nil {
		f, err := os.Open(receiptPath)
		if err != nil {
			return ErrRemoveInvalid
		}
		opened, statErr := f.Stat()
		data, readErr := io.ReadAll(io.LimitReader(f, (32<<10)+1))
		closeErr := f.Close()
		if statErr != nil || !os.SameFile(info, opened) || readErr != nil || closeErr != nil || len(data) > 32<<10 {
			return ErrRemoveInvalid
		}
		var receipt toolReceipt
		if json.Unmarshal(data, &receipt) != nil || receipt.SchemaVersion != 1 || receipt.Asset != a {
			return ErrRemoveInvalid
		}
		if !reflect.DeepEqual(receipt.Notices, notices) || !sameReceiptFiles(receipt.Files, files) {
			return ErrRemoveInvalid
		}
	}
	for _, expected := range files {
		file := filepath.Join(filepath.Dir(path), expected.Name)
		info, err := os.Lstat(file)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() || info.Size() != expected.Size {
			return ErrRemoveInvalid
		}
		f, err := os.Open(file)
		if err != nil {
			return ErrRemoveInvalid
		}
		opened, err := f.Stat()
		if err != nil || !os.SameFile(info, opened) {
			f.Close()
			return ErrRemoveInvalid
		}
		h := sha256.New()
		n, readErr := io.Copy(h, io.LimitReader(f, expected.Size+1))
		closeErr := f.Close()
		if readErr != nil || closeErr != nil || n != expected.Size || hex.EncodeToString(h.Sum(nil)) != expected.SHA256 {
			return ErrRemoveInvalid
		}
	}
	return nil
}
