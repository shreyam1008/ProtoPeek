package transfer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerificationStateRoundTripIsBoundedAndPrivate(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state", "verification.json")
	checksums := map[string]string{
		"aabbccdd": strings.Repeat("ab", expectedSHA256Bytes),
		"eeff0011": "",
	}
	if err := saveVerificationState(path, checksums, 4); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadVerificationState(path, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded["aabbccdd"] != checksums["aabbccdd"] {
		t.Fatalf("loaded checksums = %#v", loaded)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	assertPrivateFileContract(t, info)
}

func TestVerificationStateMissingLoadIsReadOnly(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "missing", "verification.json")
	loaded, err := loadVerificationState(path, 4)
	if err != nil || len(loaded) != 0 {
		t.Fatalf("load missing = %#v err=%v", loaded, err)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("read-only load created state directory or returned unexpected error: %v", err)
	}
}

func TestVerificationStateRejectsUnsafeOrOversizedContent(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	path := filepath.Join(root, "verification.json")
	tests := []struct {
		name string
		body string
	}{
		{name: "invalid id", body: `{"version":1,"jobs":[{"id":"../job","expectedSha256":"` + strings.Repeat("ab", expectedSHA256Bytes) + `"}]}`},
		{name: "invalid digest", body: `{"version":1,"jobs":[{"id":"aabbccdd","expectedSha256":"short"}]}`},
		{name: "duplicate id", body: `{"version":1,"jobs":[{"id":"aabbccdd","expectedSha256":"` + strings.Repeat("ab", expectedSHA256Bytes) + `"},{"id":"aabbccdd","expectedSha256":"` + strings.Repeat("cd", expectedSHA256Bytes) + `"}]}`},
		{name: "future version", body: `{"version":2,"jobs":[]}`},
		{name: "unknown field", body: `{"version":1,"jobs":[],"future":true}`},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(test.body), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadVerificationState(path, 4); err == nil {
				t.Fatal("unsafe verification state was accepted")
			}
		})
	}

	if err := os.WriteFile(path, []byte(strings.Repeat("x", maxVerificationStateBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadVerificationState(path, 4); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized state error = %v", err)
	}
}
