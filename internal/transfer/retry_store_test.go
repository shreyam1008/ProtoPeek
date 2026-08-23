package transfer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const retryTestChecksum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func retryTestRequest(destination string) AddRequest {
	return AddRequest{
		Sources:              []string{" https://example.test/one#fragment ", "https://mirror.test/one"},
		OutputName:           "artifact.bin",
		SHA256:               retryTestChecksum,
		DestinationDirectory: destination,
		Headers: []RequestHeader{
			{Name: " Authorization ", Value: " Bearer private-header "},
			{Name: "X-Trace", Value: " trace-id "},
		},
		UserAgent: " RetryClient/1 ",
	}
}

func TestRetryStateRoundTripIsNormalizedPrivateAndDeterministic(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	path := filepath.Join(root, "private", "retry.json")
	request := retryTestRequest(filepath.Join(root, "downloads"))
	requests := map[string]AddRequest{"eeff0011": request, "aabbccdd": request}

	if err := saveRetryState(path, requests, 8); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	assertPrivateFileContract(t, info)
	directoryInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	assertPrivateDirectoryContract(t, directoryInfo)
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	loaded, err := loadRetryState(path, 8)
	if err != nil {
		t.Fatal(err)
	}
	normalized, err := validateAddRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	for id, got := range loaded {
		if got.OutputName != normalized.OutputName || got.SHA256 != normalized.SHA256 || got.DestinationDirectory != normalized.DestinationDirectory || got.UserAgent != normalized.UserAgent {
			t.Fatalf("loaded request %s = %#v, want %#v", id, got, normalized)
		}
		if len(got.Sources) != 2 || got.Sources[0] != "https://example.test/one" || got.Headers[0].Name != "Authorization" || got.Headers[0].Value != "Bearer private-header" {
			t.Fatalf("loaded normalized request %s = %#v", id, got)
		}
	}

	if err := saveRetryState(path, map[string]AddRequest{"aabbccdd": request, "eeff0011": request}, 8); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("retry state serialization is not deterministic")
	}
	if !strings.Contains(string(first), "private-header") {
		t.Fatal("normalized retry metadata did not preserve the private header")
	}
}

func TestRetryStateMissingLoadIsReadOnly(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "missing", "retry.json")
	requests, err := loadRetryState(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 0 {
		t.Fatalf("missing retry state = %#v", requests)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("missing load created retry directory: %v", err)
	}
}

func TestRetryStateRejectsMalformedOversizedDuplicateInvalidUnknownAndSymlink(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	path := filepath.Join(root, "retry.json")
	validRequest, err := json.Marshal(retryState{Version: retryStateVersion, Jobs: []retryEntry{{ID: "aabbccdd", Request: retryTestRequest(root)}}})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		data   []byte
		secret string
	}{
		{name: "malformed", data: []byte(`{"version":`)},
		{name: "trailing", data: append(append([]byte{}, validRequest...), []byte(` {}`)...)},
		{name: "unknown field", data: []byte(`{"version":1,"jobs":[],"private-header":"secret"}`), secret: "secret"},
		{name: "duplicate id", data: func() []byte {
			state := retryState{Version: retryStateVersion, Jobs: []retryEntry{
				{ID: "aabbccdd", Request: retryTestRequest(root)},
				{ID: "aabbccdd", Request: retryTestRequest(root)},
			}}
			encoded, _ := json.Marshal(state)
			return encoded
		}()},
		{name: "invalid request", data: []byte(`{"version":1,"jobs":[{"id":"aabbccdd","request":{"sources":["https://example.test/a"],"headers":[{"name":"Host","value":"Bearer private-header"}]}}]}`), secret: "Bearer private-header"},
		{name: "invalid id", data: []byte(`{"version":1,"jobs":[{"id":"not-a-gid","request":{"sources":["https://example.test/a"]}}]}`)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, test.data, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadRetryState(path, 8); err == nil {
				t.Fatal("invalid retry state was accepted")
			} else if test.secret != "" && strings.Contains(err.Error(), test.secret) {
				t.Fatalf("retry state error reflected secret: %v", err)
			}
		})
	}

	if err := os.WriteFile(path, []byte(strings.Repeat("x", maxRetryStateSize+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRetryState(path, 8); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized retry state error = %v", err)
	}

	link := filepath.Join(root, "link.json")
	if err := os.Symlink(path, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := loadRetryState(link, 8); err == nil {
		t.Fatal("symlink retry state was accepted")
	}
	if err := saveRetryState(link, map[string]AddRequest{"aabbccdd": retryTestRequest(root)}, 8); err == nil {
		t.Fatal("save replaced a symlink retry state")
	}
}

func TestRetryStateBoundsAndDeepClone(t *testing.T) {
	t.Parallel()
	for _, maximum := range []int{0, 4097} {
		if _, err := loadRetryState(filepath.Join(t.TempDir(), "retry.json"), maximum); err == nil {
			t.Fatalf("load accepted bound %d", maximum)
		}
		if err := saveRetryState(filepath.Join(t.TempDir(), "retry.json"), nil, maximum); err == nil {
			t.Fatalf("save accepted bound %d", maximum)
		}
	}
	tooMany := map[string]AddRequest{
		"aabbccdd": retryTestRequest(t.TempDir()),
		"eeff0011": retryTestRequest(t.TempDir()),
	}
	if err := saveRetryState(filepath.Join(t.TempDir(), "retry.json"), tooMany, 1); err == nil {
		t.Fatal("save accepted more entries than the configured bound")
	}
	tooManyPath := filepath.Join(t.TempDir(), "retry.json")
	if err := saveRetryState(tooManyPath, tooMany, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRetryState(tooManyPath, 1); err == nil {
		t.Fatal("load accepted more entries than the configured bound")
	}

	original := map[string]AddRequest{"aabbccdd": retryTestRequest("/tmp/downloads")}
	cloned := cloneRetryRequests(original)
	cloned["aabbccdd"].Sources[0] = "https://changed.test/file"
	cloned["aabbccdd"].Headers[0].Value = "changed"
	if original["aabbccdd"].Sources[0] == cloned["aabbccdd"].Sources[0] || original["aabbccdd"].Headers[0].Value == cloned["aabbccdd"].Headers[0].Value {
		t.Fatal("retry request clone shares mutable slices")
	}

	requestClone := cloneAddRequest(original["aabbccdd"])
	requestClone.Sources[1] = "https://changed.test/mirror"
	requestClone.Headers[1].Value = "changed"
	if original["aabbccdd"].Sources[1] == requestClone.Sources[1] || original["aabbccdd"].Headers[1].Value == requestClone.Headers[1].Value {
		t.Fatal("add request clone shares mutable slices")
	}
}

func TestRetryStateRequiresTheOpenedFileToMatchTheCheckedPath(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	firstPath := filepath.Join(root, "first.json")
	secondPath := filepath.Join(root, "second.json")
	if err := os.WriteFile(firstPath, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(secondPath, []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := os.Lstat(firstPath)
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.Stat(secondPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := sameRetryStateFile(first, second); err == nil {
		t.Fatal("different files passed the retry state identity check")
	}
}
