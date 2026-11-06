package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/media"
)

func TestManagedExtensionsJSONAndValidation(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want int
	}{
		{[]string{"status", "--json"}, 0},
		{[]string{"status", "cloudflared"}, 0},
		{[]string{"install", "unknown"}, 2},
		{[]string{"remove"}, 2},
		{[]string{"--json"}, 0},
		{[]string{"--json", "status", "cloudflared"}, 0},
		{[]string{"status", "--json", "gallery-dl"}, 0},
	} {
		var out, stderr bytes.Buffer
		got := runManagedExtensions(context.Background(), tc.args, &out, &stderr)
		if got != tc.want {
			t.Fatalf("%v: got %d want %d: %s", tc.args, got, tc.want, stderr.String())
		}
		body := out.Bytes()
		if got != 0 {
			body = stderr.Bytes()
		}
		if !json.Valid(body) {
			t.Fatalf("%v: invalid JSON %q", tc.args, body)
		}
	}
}

func TestManagedInventorySixToolsDoesNotCreateQueue(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("PATH", t.TempDir())
	var out, stderr bytes.Buffer
	if code := runManagedExtensions(context.Background(), []string{"status", "--json"}, &out, &stderr); code != 0 {
		t.Fatalf("status %d: %s", code, stderr.String())
	}
	var snapshot struct {
		SchemaVersion int `json:"schemaVersion"`
		Tools         []struct {
			ID string `json:"id"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(out.Bytes(), &snapshot); err != nil || snapshot.SchemaVersion != 1 || len(snapshot.Tools) != 6 {
		t.Fatalf("inventory: %s %v", out.String(), err)
	}
	seen := map[string]bool{}
	for _, tool := range snapshot.Tools {
		seen[tool.ID] = true
	}
	for _, id := range []string{"aria2", "cloudflared", "yt-dlp", "gallery-dl", "deno", "ffmpeg"} {
		if !seen[id] {
			t.Errorf("missing %s", id)
		}
	}
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(config, "protopeek", "media")); !os.IsNotExist(err) {
		t.Fatalf("status created queue: %v", err)
	}
}

func TestManagedMediaMutationHonorsQueueOwner(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("PATH", t.TempDir())
	s, err := media.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var out, stderr bytes.Buffer
	code := runManagedExtensions(context.Background(), []string{"install", "yt-dlp"}, &out, &stderr)
	if code != 1 || !bytes.Contains(stderr.Bytes(), []byte("media session")) || out.Len() != 0 {
		t.Fatalf("lock not honored: %d out=%s err=%s", code, out.String(), stderr.String())
	}
}

func TestManagedMediaCLIReportsRecoveryPathAfterFailedVerification(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("PATH", t.TempDir())
	status, err := media.InspectManaged("gallery-dl")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status == "unavailable" {
		t.Skip("no managed gallery-dl package on this host")
	}
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(config, "protopeek", "media", "tools", "gallery-dl", status.Version)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	binary := "gallery-dl"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	receipt := filepath.Join(dir, binary+".verified")
	if err := os.WriteFile(receipt, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	var out, stderr bytes.Buffer
	if code := runManagedExtensions(context.Background(), []string{"remove", "gallery-dl"}, &out, &stderr); code != 1 || !strings.Contains(stderr.String(), "pp extensions status gallery-dl") {
		t.Fatalf("remove: %d %s", code, stderr.String())
	}
	out.Reset()
	stderr.Reset()
	if code := runManagedExtensions(context.Background(), []string{"status", "gallery-dl"}, &out, &stderr); code != 0 {
		t.Fatalf("status: %d %s", code, stderr.String())
	}
	var got struct{ Message string }
	if err := json.Unmarshal(out.Bytes(), &got); err != nil || !strings.Contains(got.Message, dir) || !strings.Contains(got.Message, "move it to a safe location") {
		t.Fatalf("recovery guidance: %s %v", out.String(), err)
	}
	if data, err := os.ReadFile(receipt); err != nil || string(data) != "changed" {
		t.Fatalf("unverified receipt changed: %q %v", data, err)
	}
}

func TestCompanionChangeLeavesQueueHistoryAlone(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("HOME", root)
	t.Setenv("PATH", t.TempDir())
	dir, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	dir = filepath.Join(dir, "protopeek", "media")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	history := filepath.Join(dir, "jobs.json")
	saved := []byte(`[{"id":"workbench-download","status":"queued","request":{"engine":"gallery-dl"}}]`)
	if err := os.WriteFile(history, saved, 0600); err != nil {
		t.Fatal(err)
	}
	// An absent tool may produce a removal error. Either outcome must leave
	// the queue intact and release the same lease used by a real workbench.
	_ = media.ChangeCompanion(context.Background(), "remove", "gallery-dl")
	got, err := os.ReadFile(history)
	if err != nil || !bytes.Equal(got, saved) {
		t.Fatalf("companion operation changed history: %q, %v", got, err)
	}
	service, err := media.New()
	if err != nil {
		t.Fatal(err)
	}
	service.Close()
}
