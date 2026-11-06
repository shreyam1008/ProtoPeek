package media

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ManagedTool is a cheap, read-only observation. It does not open the media
// queue, create directories, run a tool, or verify the executable's bytes.
type ManagedTool struct {
	ID, Status, Version, Message, SourceURL string
	InstallBytes                            int64
	CanInstall, CanRemove                   bool
}

func InspectManaged(name string) (ManagedTool, error) {
	out := ManagedTool{ID: name}
	if name != "yt-dlp" && name != "gallery-dl" && name != "deno" && name != "ffmpeg" {
		return out, errors.New("unknown media tool")
	}
	root, err := os.UserConfigDir()
	if err != nil || !filepath.IsAbs(root) {
		out.Status = "unavailable"
		out.Message = "The media tool directory is unavailable."
		return out, nil
	}
	s := &Service{root: filepath.Join(root, "protopeek", "media")}
	a, supported := assetFor(name)
	if supported && checkExistingAncestors(filepath.Dir(s.assetPath(a))) != nil {
		out.Status = "invalid"
		out.Message = "The local media tool directory is unsafe."
		return out, nil
	}
	t := s.tool(name)
	out.Version, out.InstallBytes = t.Version, t.InstallBytes
	if supported {
		out.SourceURL = a.URL
		path := s.assetPath(a)
		if t.CanRemove && strings.EqualFold(filepath.Clean(t.Path), filepath.Clean(path)) {
			out.Status, out.CanRemove = "installed", true
			out.CanInstall = name == "yt-dlp" && t.InstallBytes > 0
			out.Message = "Managed files are present; integrity is verified before use or removal."
			if out.CanInstall {
				out.Message += " Setup also installs missing supported Deno and FFmpeg dependencies when needed."
			}
			return out, nil
		}
		entries, readErr := os.ReadDir(filepath.Dir(path))
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			out.Status = "invalid"
			out.Message = "The local media tool directory cannot be read safely."
			return out, nil
		}
		if len(entries) > 0 {
			out.Status = "invalid"
			out.Message = "Local media tool files are incomplete or changed; no automatic replacement was attempted."
			return out, nil
		}
	}
	if t.Path != "" {
		out.Status = "external"
		out.CanInstall = name == "yt-dlp" && supported && t.InstallBytes > 0
		out.Message = "An external executable is on PATH; ProtoPeek will not remove it."
	} else if supported {
		out.Status, out.CanInstall = "available", true
		out.Message = "Install the pinned media tool only when requested."
	} else {
		out.Status = "unavailable"
		out.Message = "No managed build is offered for this operating system and architecture."
	}
	if name == "yt-dlp" && out.CanInstall {
		out.Message += " Setup also installs missing supported Deno and FFmpeg dependencies when needed."
	}
	return out, nil
}
