package managedtools

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
)

// The pinned archive is already verified before reaching here. Still enforce a
// single exact regular-file entry, bounded decompression, and an independent
// executable digest; never use an archive path as a filesystem destination.
func extractArchive(ctx context.Context, source, directory string, a asset) (string, error) {
	if a.binarySize <= 0 || a.binarySize > 128<<20 || len(a.binarySHA) != 64 {
		return "", ErrInvalid
	}
	input, err := os.Open(source)
	if err != nil {
		return "", ErrInvalid
	}
	defer input.Close()
	gz, err := gzip.NewReader(input)
	if err != nil {
		return "", ErrInvalid
	}
	defer gz.Close()
	limited := &io.LimitedReader{R: gz, N: a.binarySize + (1 << 20)}
	archive := tar.NewReader(limited)
	header, err := archive.Next()
	if err != nil || header.Name != "cloudflared" || (header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA) || header.Size != a.binarySize {
		return "", ErrInvalid
	}
	output, err := os.CreateTemp(directory, ".extract-*")
	if err != nil {
		return "", ErrInvalid
	}
	success := false
	defer func() {
		_ = output.Close()
		if !success {
			_ = os.Remove(output.Name())
		}
	}()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(output, hash), &contextReader{ctx: ctx, reader: archive})
	if err != nil {
		return "", err
	}
	if n != a.binarySize || hex.EncodeToString(hash.Sum(nil)) != a.binarySHA {
		return "", ErrInvalid
	}
	if _, err = archive.Next(); !errors.Is(err, io.EOF) {
		return "", ErrInvalid
	}
	if _, err = io.Copy(io.Discard, &contextReader{ctx: ctx, reader: limited}); err != nil {
		return "", err
	}
	if limited.N == 0 {
		return "", ErrInvalid
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = output.Chmod(0700); err != nil {
		return "", ErrInvalid
	}
	if err = output.Sync(); err != nil {
		return "", ErrInvalid
	}
	if err = output.Close(); err != nil {
		return "", ErrInvalid
	}
	success = true
	return output.Name(), nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
