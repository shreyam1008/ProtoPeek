package transfer

import (
	"bytes"
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
	retryStateVersion = 1
	maxRetryStateSize = 16 << 20
)

type retryState struct {
	Version int          `json:"version"`
	Jobs    []retryEntry `json:"jobs"`
}

type retryEntry struct {
	ID      string     `json:"id"`
	Request AddRequest `json:"request"`
}

// loadRetryState reads private retry metadata without creating or changing
// anything. Missing state is equivalent to an empty retry map.
func loadRetryState(path string, maximumEntries int) (map[string]AddRequest, error) {
	if err := validateRetryStateBound(maximumEntries); err != nil {
		return nil, err
	}

	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]AddRequest), nil
		}
		return nil, fmt.Errorf("inspect retry state: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("retry state must be a regular non-symlink file")
	}
	if info.Size() > maxRetryStateSize {
		return nil, fmt.Errorf("retry state exceeds %d bytes", maxRetryStateSize)
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open retry state: %w", err)
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("inspect opened retry state: %w", err)
	}
	if !openedInfo.Mode().IsRegular() {
		return nil, errors.New("retry state must be a regular non-symlink file")
	}
	if err := sameRetryStateFile(info, openedInfo); err != nil {
		return nil, err
	}
	limited := io.LimitReader(file, maxRetryStateSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read retry state: %w", err)
	}
	if len(data) > maxRetryStateSize {
		return nil, fmt.Errorf("retry state exceeds %d bytes", maxRetryStateSize)
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var state retryState
	if err := decoder.Decode(&state); err != nil {
		return nil, errors.New("retry state contains invalid JSON")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("retry state must contain exactly one JSON value")
	}
	if state.Version != retryStateVersion {
		return nil, fmt.Errorf("unsupported retry state version %d (supported: %d)", state.Version, retryStateVersion)
	}
	if len(state.Jobs) > maximumEntries {
		return nil, fmt.Errorf("retry state contains more than %d jobs", maximumEntries)
	}

	requests := make(map[string]AddRequest, len(state.Jobs))
	for _, entry := range state.Jobs {
		if entry.ID != strings.TrimSpace(entry.ID) || !validJobID(entry.ID) {
			return nil, errors.New("retry state contains an invalid job id")
		}
		if _, exists := requests[entry.ID]; exists {
			return nil, errors.New("retry state contains a duplicate job id")
		}
		normalized, err := validateAddRequest(entry.Request)
		if err != nil {
			return nil, errors.New("retry state contains an invalid transfer request")
		}
		requests[entry.ID] = cloneAddRequest(normalized)
	}
	return requests, nil
}

// saveRetryState atomically replaces private retry metadata. Requests are
// normalized before they are serialized so state loaded later has the same
// validation and canonicalization contract as a fresh add.
func saveRetryState(path string, requests map[string]AddRequest, maximumEntries int) error {
	if err := validateRetryStateBound(maximumEntries); err != nil {
		return err
	}
	if len(requests) > maximumEntries {
		return fmt.Errorf("cannot persist more than %d retry jobs", maximumEntries)
	}

	entries := make([]retryEntry, 0, len(requests))
	for id, request := range requests {
		if !validJobID(id) {
			return errors.New("cannot persist an invalid retry job id")
		}
		normalized, err := validateAddRequest(request)
		if err != nil {
			return errors.New("cannot persist an invalid transfer request")
		}
		entries = append(entries, retryEntry{ID: id, Request: cloneAddRequest(normalized)})
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].ID < entries[right].ID })

	data, err := json.MarshalIndent(retryState{Version: retryStateVersion, Jobs: entries}, "", "  ")
	if err != nil {
		return errors.New("encode retry state")
	}
	data = append(data, '\n')
	if len(data) > maxRetryStateSize {
		return fmt.Errorf("retry state exceeds %d bytes", maxRetryStateSize)
	}

	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create retry state directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("protect retry state directory: %w", err)
	}
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("retry state must be a regular non-symlink file")
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect retry state destination: %w", err)
	}

	temporary, err := os.CreateTemp(directory, ".retry-state-*.json")
	if err != nil {
		return fmt.Errorf("create temporary retry state: %w", err)
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
		return fmt.Errorf("protect temporary retry state: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary retry state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary retry state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary retry state: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace retry state: %w", err)
	}
	committed = true
	if err := syncDirectory(directory); err != nil {
		return fmt.Errorf("sync retry state directory: %w", err)
	}
	return nil
}

func validateRetryStateBound(maximumEntries int) error {
	if maximumEntries < 1 || maximumEntries > 4096 {
		return fmt.Errorf("invalid retry entry bound %d", maximumEntries)
	}
	return nil
}

func sameRetryStateFile(expected, opened os.FileInfo) error {
	if !os.SameFile(expected, opened) {
		return errors.New("retry state changed while it was being opened")
	}
	return nil
}

func cloneRetryRequests(requests map[string]AddRequest) map[string]AddRequest {
	cloned := make(map[string]AddRequest, len(requests))
	for id, request := range requests {
		cloned[id] = cloneAddRequest(request)
	}
	return cloned
}

func cloneAddRequest(request AddRequest) AddRequest {
	cloned := request
	cloned.Sources = append([]string(nil), request.Sources...)
	cloned.Headers = append([]RequestHeader(nil), request.Headers...)
	return cloned
}
