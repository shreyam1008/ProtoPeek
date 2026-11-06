// releasecheck validates actual packaged Windows binaries, not just build recipes.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"debug/buildinfo"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/releasecheck DIST_DIRECTORY")
		os.Exit(2)
	}
	if err := verifyRelease(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "Windows lightweight release contract:", err)
		os.Exit(1)
	}
}

func verifyRelease(dist string) error {
	archives, err := filepath.Glob(filepath.Join(dist, "protopeek_*_windows_x86_64.zip"))
	if err != nil || len(archives) != 1 {
		return fmt.Errorf("expected exactly one Windows amd64 archive, found %d", len(archives))
	}
	archiveName := strings.TrimPrefix(bundledaria2.CompanionFilename, "protopeek-")
	companion, err := os.ReadFile(filepath.Join("internal", "bundledaria2", "assets", archiveName))
	if err != nil {
		return fmt.Errorf("read pinned aria2 archive: %w", err)
	}
	if len(companion) == 0 {
		return fmt.Errorf("pinned aria2 archive is empty")
	}
	manifest, err := os.ReadFile(filepath.Join(dist, "checksums.txt"))
	if err != nil {
		return err
	}
	if err := verifyExtraChecksum(manifest, bundledaria2.CompanionFilename, bytes.NewReader(companion)); err != nil {
		return err
	}
	for _, source := range []string{"install.sh", "install.ps1", filepath.Join(".local", "aria2-"+bundledaria2.EngineVersion+"-companion-sources.tar.gz")} {
		file, err := os.Open(source)
		if err != nil {
			return err
		}
		err = verifyExtraChecksum(manifest, filepath.Base(source), file)
		file.Close()
		if err != nil {
			return err
		}
	}
	reader, err := zip.OpenReader(archives[0])
	if err != nil {
		return err
	}
	defer reader.Close()
	wanted := map[string]bool{"pp.exe": false, "protopeek.exe": false}
	for _, entry := range reader.File {
		name := path.Base(entry.Name)
		if name == bundledaria2.CompanionFilename || name == archiveName {
			return fmt.Errorf("unexpected companion archive in release: %s", entry.Name)
		}
		if _, ok := wanted[name]; !ok {
			continue
		}
		if wanted[name] || entry.UncompressedSize64 == 0 || entry.UncompressedSize64 > 256<<20 || entry.FileInfo().IsDir() {
			return fmt.Errorf("invalid or duplicate %s", name)
		}
		stream, err := entry.Open()
		if err != nil {
			return err
		}
		data, readErr := io.ReadAll(io.LimitReader(stream, 256<<20+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || uint64(len(data)) != entry.UncompressedSize64 {
			return fmt.Errorf("read %s: %v %v", name, readErr, closeErr)
		}
		info, err := buildinfo.Read(bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("%s: invalid Go build metadata: %w", name, err)
		}
		if err := verifyBinary(info, data, companion, strings.TrimSuffix(name, ".exe")); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		wanted[name] = true
		fmt.Printf("verified %s: windows/amd64, protopeek_lite, no embedded aria2 archive, SHA-256 %x\n", name, sha256.Sum256(data))
	}
	for name, found := range wanted {
		if !found {
			return fmt.Errorf("release archive missing %s", name)
		}
	}
	return nil
}

func verifyExtraChecksum(manifest []byte, name string, contents io.Reader) error {
	hash := sha256.New()
	if _, err := io.Copy(hash, contents); err != nil {
		return err
	}
	want := fmt.Sprintf("%x", hash.Sum(nil))
	count := 0
	for _, line := range strings.Split(string(manifest), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			if fields[0] != want {
				return fmt.Errorf("checksum mismatch for %s", name)
			}
			count++
		}
	}
	if count != 1 {
		return fmt.Errorf("expected one checksum for %s, found %d", name, count)
	}
	return nil
}

func verifyBinary(info *debug.BuildInfo, binary, companion []byte, command string) error {
	if info == nil || info.Path != "github.com/shreyam1008/ProtoPeek/cmd/"+command {
		return fmt.Errorf("unexpected Go command identity")
	}
	settings := map[string]string{}
	for _, item := range info.Settings {
		settings[item.Key] = item.Value
	}
	if settings["GOOS"] != "windows" || settings["GOARCH"] != "amd64" {
		return fmt.Errorf("incorrect target platform")
	}
	containsTag := false
	for _, tag := range strings.FieldsFunc(settings["-tags"], func(r rune) bool { return r == ',' || r == ' ' }) {
		if tag == "protopeek_lite" {
			containsTag = true
		}
	}
	if !containsTag {
		return fmt.Errorf("protopeek_lite build tag missing")
	}
	if len(companion) == 0 || bytes.Contains(binary, companion) {
		return fmt.Errorf("aria2 archive is embedded or reference is empty")
	}
	return nil
}
