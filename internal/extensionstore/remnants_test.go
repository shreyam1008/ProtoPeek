package extensionstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
	"github.com/shreyam1008/ProtoPeek/internal/media"
	"github.com/shreyam1008/ProtoPeek/internal/userroot"
)

func TestStatusReportsPreservedSetupEntriesWithoutChangingThem(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"HOME", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"} {
		t.Setenv(name, root)
	}
	t.Setenv("PATH", t.TempDir())
	mediaState, err := media.InspectManaged("gallery-dl")
	if err != nil || mediaState.Version == "" {
		t.Skip("gallery-dl managed build unavailable")
	}
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	config, err = userroot.Resolve(config)
	if err != nil {
		t.Fatal(err)
	}
	cache, err = userroot.Resolve(cache)
	if err != nil {
		t.Fatal(err)
	}
	mediaDir := filepath.Join(config, "protopeek", "media", "tools", "gallery-dl")
	ariaDir := filepath.Join(cache, "protopeek", "engines", "aria2")
	for _, dir := range []string{mediaDir, ariaDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	retained := filepath.Join(mediaDir, ".preserved-install-123")
	if err := os.Mkdir(retained, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(retained, "user-file")
	if err := os.WriteFile(marker, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(ariaDir, ".aria2-quarantine-123")
	if err := os.WriteFile(archive, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := managedtools.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ id, dir string }{{"gallery-dl", mediaDir}, {"aria2", ariaDir}} {
		tool, err := Status(manager, tc.id)
		if err != nil || !strings.Contains(tool.Message, "entries: 1") || !strings.Contains(tool.Message, tc.dir) {
			t.Fatalf("%s: %+v %v", tc.id, tool, err)
		}
	}
	inventory := Inventory(manager)
	found := 0
	for _, tool := range inventory.Tools {
		if (tool.ID == "gallery-dl" || tool.ID == "aria2") && strings.Contains(tool.Message, "entries: 1") {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("inventory missing remnants: %+v", inventory)
	}
	for _, path := range []string{marker, archive} {
		if data, err := os.ReadFile(path); err != nil || string(data) != "keep" {
			t.Fatalf("changed %s: %q %v", path, data, err)
		}
	}
}

func TestSetupRemnantsBoundsEnumeration(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 129; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf(".install-%03d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	got := setupRemnants(filepath.Dir(root), []string{filepath.Base(root)}, ".install-")
	if !strings.Contains(got, "128 (first 128 entries checked)") {
		t.Fatalf("unbounded or misleading observation: %q", got)
	}
}

func TestSetupRemnantsRejectsLinkedDirectories(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, ".install-123"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink not available: %v", err)
	}
	if got := setupRemnants(root, []string{"link"}, ".install-"); got != "" {
		t.Fatalf("followed link: %q", got)
	}
}
