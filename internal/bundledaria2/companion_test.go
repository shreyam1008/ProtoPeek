package bundledaria2

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalCompanionRequiresExactBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, CompanionFilename)
	content := []byte("known fixture payload")
	if _, err := readCompanion(path, digest(content), int64(len(content))); !errors.Is(err, ErrCompanionMissing) {
		t.Fatalf("missing companion: %v", err)
	}
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := readCompanion(path, digest(content), int64(len(content)))
	if err != nil || string(got) != string(content) {
		t.Fatalf("valid companion: %q %v", got, err)
	}
	content[0] ^= 1 // Same size must not bypass the digest.
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readCompanion(path, digest([]byte("known fixture payload")), int64(len(content))); !errors.Is(err, ErrCompanionInvalid) {
		t.Fatalf("tampered companion: %v", err)
	}
	if _, err := readCompanion(dir, digest(content), int64(len(content))); !errors.Is(err, ErrCompanionInvalid) {
		t.Fatalf("directory accepted as companion: %v", err)
	}
}

func TestCompanionGuidanceDoesNotExposeWrappedErrors(t *testing.T) {
	for _, test := range []struct {
		err      error
		contains string
	}{
		{errors.Join(ErrCompanionMissing, errors.New("private path")), CompanionFilename},
		{errors.Join(ErrCompanionInvalid, errors.New("private path")), "could not be verified"},
	} {
		message := CompanionMessage(test.err)
		if message == "" || strings.Contains(message, "private path") || !strings.Contains(message, test.contains) {
			t.Fatalf("unsafe or unhelpful message: %q", message)
		}
	}
}
