// Package communitytools manages explicitly installed, pinned optional tools.
package communitytools

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

type Asset struct {
	Platform     string `json:"platform"`
	Version      string `json:"version"`
	URL          string `json:"url"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
	Format       string `json:"format"`
	Member       string `json:"member,omitempty"`
	BinarySHA256 string `json:"binarySha256,omitempty"`
	BinarySize   int64  `json:"binarySize,omitempty"`
}

type Entry struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Group       string  `json:"group"`
	Description string  `json:"description"`
	License     string  `json:"license"`
	Source      string  `json:"source"`
	Assets      []Asset `json:"assets"`
}

var (
	identifierPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	versionPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	shaPattern        = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

func validHTTPS(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Fragment == ""
}

func validMember(name string) bool {
	if name == "" || len(name) > 512 || strings.HasPrefix(name, "/") || strings.ContainsAny(name, `\\:`) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func validate(entries []Entry) error {
	seen := make(map[string]bool)
	for _, entry := range entries {
		switch entry.Group {
		case "Inspect traffic & services", "Connect & publish", "Transfer files", "AI & agents", "Containers & clusters":
		default:
			return fmt.Errorf("invalid group for catalog entry %q", entry.ID)
		}
		switch entry.ID {
		case "aria2", "cloudflared", "yt-dlp", "gallery-dl", "deno", "ffmpeg":
			return fmt.Errorf("catalog entry %q is already managed by the core", entry.ID)
		}
		if !identifierPattern.MatchString(entry.ID) || len(entry.ID) > 64 || seen[entry.ID] ||
			strings.TrimSpace(entry.Name) == "" || len(entry.Name) > 100 ||
			strings.TrimSpace(entry.Description) == "" || len(entry.Description) > 500 ||
			strings.TrimSpace(entry.License) == "" || len(entry.License) > 200 || !validHTTPS(entry.Source) || len(entry.Assets) == 0 {
			return fmt.Errorf("invalid catalog entry %q", entry.ID)
		}
		seen[entry.ID] = true
		platforms := make(map[string]bool)
		for _, asset := range entry.Assets {
			switch asset.Platform {
			case "windows/amd64", "windows/arm64", "windows/386", "linux/amd64", "linux/arm64", "linux/386", "darwin/amd64", "darwin/arm64":
			default:
				return fmt.Errorf("invalid platform for %s", entry.ID)
			}
			if platforms[asset.Platform] || !versionPattern.MatchString(asset.Version) || !validHTTPS(asset.URL) || !shaPattern.MatchString(asset.SHA256) || asset.Size <= 0 || asset.Size > 256<<20 {
				return fmt.Errorf("invalid asset for %s", entry.ID)
			}
			platforms[asset.Platform] = true
			switch asset.Format {
			case "binary":
				if asset.Member != "" || asset.BinarySHA256 != "" || asset.BinarySize != 0 {
					return fmt.Errorf("unexpected archive fields for %s", entry.ID)
				}
			case "zip", "tar.gz":
				if !validMember(asset.Member) || !shaPattern.MatchString(asset.BinarySHA256) || asset.BinarySize <= 0 || asset.BinarySize > 256<<20 {
					return fmt.Errorf("invalid archive fields for %s", entry.ID)
				}
			default:
				return fmt.Errorf("invalid format for %s", entry.ID)
			}
		}
	}
	return nil
}

func parseCatalog(data []byte) ([]Entry, error) {
	var entries []Entry
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&entries); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("unexpected data after catalog")
	}
	if entries == nil {
		return nil, fmt.Errorf("catalog must be an array")
	}
	if err := validate(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// IDs returns the catalog identifiers without touching user storage or the network.
func IDs() []string {
	entries, err := parseCatalog(catalogJSON)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func IsKnown(id string) bool {
	for _, known := range IDs() {
		if known == id {
			return true
		}
	}
	return false
}
