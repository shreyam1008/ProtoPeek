package transfer

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	verificationStateVersion  = 1
	maxVerificationStateBytes = 1 << 20
	expectedSHA256Bytes       = 32
)

type verificationState struct {
	Version int                 `json:"version"`
	Jobs    []verificationEntry `json:"jobs"`
}

type verificationEntry struct {
	ID             string `json:"id"`
	ExpectedSHA256 string `json:"expectedSha256"`
}

// loadVerificationState is read-only. A missing file means no checksum
// evidence has been persisted yet.
func loadVerificationState(path string, maximumEntries int) (map[string]string, error) {
	if maximumEntries < 1 || maximumEntries > 4096 {
		return nil, fmt.Errorf("invalid verification entry bound %d", maximumEntries)
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]string), nil
		}
		return nil, fmt.Errorf("open verification state: %w", err)
	}
	defer file.Close()
	if info, statErr := file.Stat(); statErr != nil {
		return nil, fmt.Errorf("inspect verification state: %w", statErr)
	} else if info.Size() > maxVerificationStateBytes {
		return nil, fmt.Errorf("verification state exceeds %d bytes", maxVerificationStateBytes)
	}

	limited := io.LimitReader(file, maxVerificationStateBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read verification state: %w", err)
	}
	if len(data) > maxVerificationStateBytes {
		return nil, fmt.Errorf("verification state exceeds %d bytes", maxVerificationStateBytes)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var state verificationState
	if err := decoder.Decode(&state); err != nil {
		return nil, fmt.Errorf("decode verification state: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("decode verification state: multiple JSON values are not allowed")
		}
		return nil, fmt.Errorf("decode verification state trailer: %w", err)
	}
	if state.Version != verificationStateVersion {
		return nil, fmt.Errorf("unsupported verification state version %d (supported: %d)", state.Version, verificationStateVersion)
	}
	if len(state.Jobs) > maximumEntries {
		return nil, fmt.Errorf("verification state contains more than %d jobs", maximumEntries)
	}

	checksums := make(map[string]string, len(state.Jobs))
	for _, entry := range state.Jobs {
		id := strings.TrimSpace(entry.ID)
		checksum := strings.ToLower(strings.TrimSpace(entry.ExpectedSHA256))
		if id != entry.ID || !validJobID(id) {
			return nil, errors.New("verification state contains an invalid job id")
		}
		if !validExpectedSHA256(checksum) {
			return nil, errors.New("verification state contains an invalid expected SHA-256")
		}
		if _, duplicate := checksums[id]; duplicate {
			return nil, errors.New("verification state contains a duplicate job id")
		}
		checksums[id] = checksum
	}
	return checksums, nil
}

func saveVerificationState(path string, checksums map[string]string, maximumEntries int) error {
	if maximumEntries < 1 || maximumEntries > 4096 {
		return fmt.Errorf("invalid verification entry bound %d", maximumEntries)
	}
	entries := make([]verificationEntry, 0, len(checksums))
	for id, rawChecksum := range checksums {
		checksum := strings.ToLower(strings.TrimSpace(rawChecksum))
		if checksum == "" {
			continue
		}
		if !validJobID(id) {
			return errors.New("cannot persist an invalid verification job id")
		}
		if !validExpectedSHA256(checksum) {
			return errors.New("cannot persist an invalid expected SHA-256")
		}
		entries = append(entries, verificationEntry{ID: id, ExpectedSHA256: checksum})
	}
	if len(entries) > maximumEntries {
		return fmt.Errorf("cannot persist more than %d verification jobs", maximumEntries)
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].ID < entries[right].ID })
	data, err := json.MarshalIndent(verificationState{Version: verificationStateVersion, Jobs: entries}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode verification state: %w", err)
	}
	data = append(data, '\n')
	if len(data) > maxVerificationStateBytes {
		return fmt.Errorf("verification state exceeds %d bytes", maxVerificationStateBytes)
	}

	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create verification state directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".verification-*.json")
	if err != nil {
		return fmt.Errorf("create temporary verification state: %w", err)
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("protect temporary verification state: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary verification state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary verification state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary verification state: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace verification state: %w", err)
	}
	committed = true
	return nil
}

func validExpectedSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == expectedSHA256Bytes
}
