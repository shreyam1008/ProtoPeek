package transfer

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestNewDownloadNeverResumesAnotherFilesBytes(t *testing.T) {
	t.Parallel()
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	for _, name := range []string{"archive.bin", "archive (1).bin.aria2"} {
		if err := os.WriteFile(filepath.Join(config.DownloadDirectory, name), []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	request := AddRequest{Sources: []string{"https://example.test/archive.bin?version=new"}}
	rpc := &fakeAriaRPC{addID: "aabbccdd"}
	engine := &aria2Engine{rpc: rpc}
	if _, err := engine.Add(context.Background(), request, config); err != nil {
		t.Fatal(err)
	}
	if rpc.lastOpts["out"] != "archive (2).bin" || rpc.lastOpts["continue"] != "false" {
		t.Fatalf("new job options = %#v", rpc.lastOpts)
	}
	data, err := os.ReadFile(filepath.Join(config.DownloadDirectory, "archive.bin"))
	if err != nil || string(data) != "keep" {
		t.Fatalf("existing file modified: %q %v", data, err)
	}
	config.AutoRenameConflictingFiles = false
	if _, err := newDownloadOutput(config, request); err == nil {
		t.Fatal("refuse policy reused existing file")
	}
	config.AllowOverwriteExistingFiles = true
	if name, err := newDownloadOutput(config, request); err != nil || name != "archive.bin" {
		t.Fatalf("explicit overwrite: %q %v", name, err)
	}
}

func TestOutputNamesArePortableAndRejectDeviceAndStreamPaths(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"../file", `folder\file`, "file:stream", "NUL.txt", "con", "COM1", "LPT9.log", "file.", "file ", "?", ""} {
		if safeOutputName(name) {
			t.Errorf("unsafe name accepted: %q", name)
		}
	}
	for _, name := range []string{"archive.tar.gz", "my file (2).zip", "日本語.txt"} {
		if !safeOutputName(name) {
			t.Errorf("safe name rejected: %q", name)
		}
	}
}

func TestQueuedOutputReservationsBeforeFilesExist(t *testing.T) {
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	request := AddRequest{Sources: []string{"https://example.test/archive.bin"}}
	name := "archive.bin"
	if runtime.GOOS == "windows" {
		name = "ARCHIVE.BIN" // Windows reservations are case insensitive.
	}
	jobs := []Job{
		{Status: JobQueued, OutputPath: filepath.Join(config.DownloadDirectory, name)},
		{Status: JobPaused, Directory: config.DownloadDirectory, Name: "archive (1).bin"},
		{Status: JobCompleted, OutputPath: filepath.Join(config.DownloadDirectory, "archive (2).bin")},
	}
	for _, overwrite := range []bool{false, true} {
		config.AllowOverwriteExistingFiles = overwrite
		output, err := newDownloadOutput(config, request, jobs...)
		if err != nil || output != "archive (2).bin" {
			t.Fatalf("overwrite=%t: %q %v", overwrite, output, err)
		}
	}
	config.AutoRenameConflictingFiles = false
	if _, err := newDownloadOutput(config, request, jobs...); err == nil {
		t.Fatal("overwrite policy stole a waiting job's output")
	}
}
