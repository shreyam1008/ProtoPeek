//go:build !windows

package cloudflared

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func isReparse(os.FileInfo) bool { return false }
func singleLink(_ string, info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Nlink != 1 {
		return errors.New("hardlinked or unverified files are not adopted")
	}
	return nil
}
func ownedWritableConfig(path string) error {
	_, info, err := readRegularConfig(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid == 0 || int(stat.Uid) != os.Geteuid() || info.Mode().Perm()&0200 == 0 {
		return errors.New("permission-required: edit administrator-owned or read-only configs using the host's administrator workflow; no alternate copy is used")
	}
	return nil
}
func protectStage(string) error { return nil }
func preserveConfigPermissions(stage, _ string, info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("config ownership unavailable")
	}
	if err := os.Chown(stage, int(stat.Uid), int(stat.Gid)); err != nil {
		return err
	}
	return os.Chmod(stage, info.Mode().Perm())
}
func replaceConfigFile(stage, target string) (bool, error) {
	if err := os.Rename(stage, target); err != nil {
		return false, err
	}
	directory, err := os.Open(filepath.Dir(target))
	if err != nil {
		return true, err
	}
	defer directory.Close()
	return true, directory.Sync()
}

func configPermissions(_ string, info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", errors.New("config permissions unavailable")
	}
	return fmt.Sprintf("%d:%d:%o", stat.Uid, stat.Gid, info.Mode().Perm()), nil
}
