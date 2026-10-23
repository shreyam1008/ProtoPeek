package publishsession

import (
	"debug/buildinfo"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func linuxExecutableError() error {
	return publicError("Linux foreground publishing requires a directly installed, unprivileged native cloudflared or tailscale Go command. Scripts, Snap/Flatpak launchers, combined/multicall clients and unknown builds are unsupported. Install the official native client or manage publishing in the native client directly.")
}

// This is a compatibility check for the supported foreground vendor commands,
// not cryptographic attestation of an executable supplied by the local owner.
func validatePublishingExecutable(path, tool string) (string, error) {
	program := ""
	switch tool {
	case "cloudflared":
		program = "github.com/cloudflare/cloudflared/cmd/cloudflared"
	case "tailscale":
		program = "tailscale.com/cmd/tailscale"
	default:
		return "", linuxExecutableError()
	}
	canonical, err := validateLinuxELF(path)
	if err != nil {
		return "", err
	}
	info, err := buildinfo.ReadFile(canonical)
	if err != nil || info.Path != program {
		return "", linuxExecutableError()
	}
	return canonical, nil
}

func linuxLauncherPath(path string) bool {
	path = filepath.Clean(path)
	for _, prefix := range []string{"/snap/", "/var/lib/snapd/", "/var/lib/flatpak/"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	if strings.Contains(path, "/.local/share/flatpak/") {
		return true
	}
	switch filepath.Base(path) {
	case "snap", "snap-confine", "snap-exec", "flatpak", "bwrap":
		return true
	}
	return false
}

func validateLinuxELF(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil || linuxLauncherPath(absolute) {
		return "", linuxExecutableError()
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil || linuxLauncherPath(canonical) {
		return "", linuxExecutableError()
	}
	file, err := os.Open(canonical)
	if err != nil {
		return "", linuxExecutableError()
	}
	defer file.Close()
	info, err := file.Stat()
	var magic [4]byte
	_, readErr := io.ReadFull(file, magic[:])
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 || readErr != nil || string(magic[:]) != "\x7fELF" {
		return "", linuxExecutableError()
	}
	// A privileged exec clears Pdeathsig, even when it is otherwise valid ELF.
	_, capErr := unix.Getxattr(canonical, "security.capability", nil)
	if info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || capErr == nil || (!errors.Is(capErr, unix.ENODATA) && !errors.Is(capErr, unix.ENOTSUP)) {
		return "", linuxExecutableError()
	}
	return canonical, nil
}
