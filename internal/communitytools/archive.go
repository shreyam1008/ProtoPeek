package communitytools

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
)

const maxExpandedArchive = 512 << 20
const maxArchiveEntries = 2048

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

// Archive paths are never written to disk, but unsafe or ambiguous names are
// rejected even for unrelated entries. Ordinary ./ prefixes are accepted.
func archiveName(name string, directory bool) (string, bool) {
	for strings.HasPrefix(name, "./") {
		name = strings.TrimPrefix(name, "./")
	}
	if directory {
		name = strings.TrimSuffix(name, "/")
		if name == "" {
			return "", true
		}
	}
	return name, validMember(name)
}

func writeMember(ctx context.Context, directory string, reader io.Reader, a Asset) (path string, result error) {
	file, err := os.CreateTemp(directory, ".extract-*")
	if err != nil {
		return "", managedtools.ErrInvalid
	}
	path = file.Name()
	name := path
	defer func() {
		_ = file.Close()
		if result != nil {
			_ = os.Remove(name)
		}
	}()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(contextReader{ctx: ctx, r: reader}, a.BinarySize+1))
	if err != nil {
		return "", err
	}
	if n != a.BinarySize || hex.EncodeToString(hash.Sum(nil)) != a.BinarySHA256 {
		return "", managedtools.ErrInvalid
	}
	if err = file.Chmod(0700); err != nil {
		return "", managedtools.ErrInvalid
	}
	if err = file.Sync(); err != nil {
		return "", managedtools.ErrInvalid
	}
	if err = file.Close(); err != nil {
		return "", managedtools.ErrInvalid
	}
	return path, nil
}

func extract(ctx context.Context, source, directory string, a Asset) (string, error) {
	switch a.Format {
	case "zip":
		return extractZIP(ctx, source, directory, a)
	case "tar.gz":
		return extractTar(ctx, source, directory, a)
	default:
		return "", managedtools.ErrInvalid
	}
}

func extractZIP(ctx context.Context, source, directory string, a Asset) (string, error) {
	reader, err := zip.OpenReader(source)
	if err != nil {
		return "", managedtools.ErrInvalid
	}
	defer reader.Close()
	if len(reader.File) > maxArchiveEntries {
		return "", managedtools.ErrInvalid
	}
	var selected *zip.File
	var total uint64
	for _, entry := range reader.File {
		name, ok := archiveName(entry.Name, entry.FileInfo().IsDir())
		if !ok || (!entry.FileInfo().IsDir() && !entry.Mode().IsRegular()) || entry.UncompressedSize64 > 256<<20 {
			return "", managedtools.ErrInvalid
		}
		total += entry.UncompressedSize64
		if total > maxExpandedArchive {
			return "", managedtools.ErrInvalid
		}
		if name == a.Member {
			if selected != nil || entry.FileInfo().IsDir() || entry.UncompressedSize64 != uint64(a.BinarySize) {
				return "", managedtools.ErrInvalid
			}
			selected = entry
		}
	}
	if selected == nil {
		return "", managedtools.ErrInvalid
	}
	member, err := selected.Open()
	if err != nil {
		return "", managedtools.ErrInvalid
	}
	defer member.Close()
	return writeMember(ctx, directory, member, a)
}

func extractTar(ctx context.Context, source, directory string, a Asset) (path string, result error) {
	file, err := os.Open(source)
	if err != nil {
		return "", managedtools.ErrInvalid
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return "", managedtools.ErrInvalid
	}
	defer gz.Close()
	limited := &io.LimitedReader{R: contextReader{ctx: ctx, r: gz}, N: maxExpandedArchive + 1}
	reader := tar.NewReader(limited)
	defer func() {
		if result != nil && path != "" {
			_ = os.Remove(path)
		}
	}()
	count := 0
	for {
		header, nextErr := reader.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			if err := ctx.Err(); err != nil {
				return path, err
			}
			return path, managedtools.ErrInvalid
		}
		count++
		isDir := header.Typeflag == tar.TypeDir
		name, ok := archiveName(header.Name, isDir)
		regular := header.Typeflag == tar.TypeReg || header.Typeflag == tar.TypeRegA
		if count > maxArchiveEntries || !ok || (!isDir && !regular) || header.Size < 0 || header.Size > 256<<20 {
			return path, managedtools.ErrInvalid
		}
		if name == a.Member {
			if path != "" || !regular || header.Size != a.BinarySize {
				return path, managedtools.ErrInvalid
			}
			path, err = writeMember(ctx, directory, reader, a)
			if err != nil {
				return path, err
			}
		}
	}
	if path == "" {
		return "", managedtools.ErrInvalid
	}
	if _, err = io.Copy(io.Discard, limited); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return path, ctxErr
		}
		return path, managedtools.ErrInvalid
	}
	if limited.N == 0 {
		return path, managedtools.ErrInvalid
	}
	if err = ctx.Err(); err != nil {
		return path, err
	}
	return path, nil
}
