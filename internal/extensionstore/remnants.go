package extensionstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/userroot"
)

// setupRemnants reads only the named app-owned directory, at most 128 entries.
// Each component is checked and the opened directory must be the same file;
// os.Root confines any concurrent path substitution to the trusted user root.
func setupRemnants(base string, parts []string, prefixes ...string) string {
	resolved, err := userroot.Resolve(base)
	if err != nil {
		return ""
	}
	root, err := os.OpenRoot(resolved)
	if err != nil {
		return ""
	}
	defer root.Close()
	rel := ""
	for i, part := range parts {
		rel = filepath.Join(rel, part)
		if !filepath.IsLocal(rel) {
			return ""
		}
		info, err := root.Lstat(rel)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ""
		}
		f, err := root.Open(rel)
		if err != nil {
			return ""
		}
		opened, statErr := f.Stat()
		if statErr != nil || !os.SameFile(info, opened) {
			f.Close()
			return ""
		}
		if i != len(parts)-1 {
			f.Close()
			continue
		}
		entries, readErr := f.ReadDir(128)
		f.Close()
		if readErr != nil && len(entries) == 0 {
			return ""
		}
		count := 0
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			for _, prefix := range prefixes {
				if strings.HasPrefix(entry.Name(), prefix) {
					count++
					break
				}
			}
		}
		if count == 0 {
			return ""
		}
		qualifier := ""
		if len(entries) == 128 {
			qualifier = " (first 128 entries checked)"
		}
		return fmt.Sprintf(" Possible preserved or interrupted setup entries: %d%s in %s. Review them manually; ProtoPeek does not remove them automatically.", count, qualifier, filepath.Join(resolved, rel))
	}
	return ""
}

func remnantsFor(id, version string) string {
	if id == "aria2" {
		cache, err := os.UserCacheDir()
		if err != nil {
			return ""
		}
		return setupRemnants(cache, []string{"protopeek", "engines", "aria2"}, ".aria2-quarantine-", ".aria2-cache-quarantine-", ".aria2-download-")
	}
	if !IsMedia(id) {
		return ""
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	parts := []string{"protopeek", "media", "tools", id}
	message := setupRemnants(config, parts, ".install-", ".preserved-install-")
	if version != "" && filepath.IsLocal(version) && filepath.Base(version) == version {
		message += setupRemnants(config, append(parts, version), ".install-")
	}
	return message
}
