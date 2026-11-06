package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
		{[]string{"--json"}, 2},
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
	if _, err := os.Stat(filepath.Join(root, "protopeek", "media")); !os.IsNotExist(err) {
		t.Fatalf("status created queue: %v", err)
	}
}

func TestManagedMediaMutationHonorsQueueOwner(t *testing.T) {
	root := t.TempDir()
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
