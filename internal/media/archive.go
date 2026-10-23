package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ArchiveBox is an optional, separately installed application. Its CLI has two
// generations: stable --extract and newer --plugins. Probe the actual interface
// before creating a collection and fail closed on an unknown interface.
func (s *Service) archive(ctx context.Context, j Job) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	path := s.tool("archivebox").Path
	run := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, path, args...)
		configureProcess(cmd)
		cmd.Dir = j.Directory
		cmd.WaitDelay = 3 * time.Second
		// Never submit the user's target to the Internet Archive. This collection
		// belongs solely to this job and is never served by ProtoPeek.
		cmd.Env = append(os.Environ(), "SAVE_ARCHIVE_DOT_ORG=False", "ARCHIVE_DOT_ORG_ENABLED=False", "CHECK_SSL_VALIDITY=True", "TIMEOUT=60", "OUTPUT_DIR="+j.Directory)
		var output tailBuffer
		cmd.Stdout, cmd.Stderr = &output, &output
		err := cmd.Run()
		return output.String(), err
	}
	help, err := run("add", "--help")
	if err != nil {
		return fmt.Errorf("ArchiveBox setup is incomplete: %s", help)
	}
	args := []string{"add", "--depth", "0"}
	if strings.Contains(help, "--plugins") {
		if _, err := os.Stat(filepath.Join(j.Directory, "index.sqlite3")); err != nil {
			if output, err := run("init"); err != nil {
				return fmt.Errorf("ArchiveBox init failed: %s", output)
			}
		}
		args = append(args, "--plugins", "title,wget,screenshot,pdf", "--max-urls", "1", "--crawl-timeout", "600")
	} else if strings.Contains(help, "--extract") && strings.Contains(help, "--init") {
		args = append(args, "--init", "--extract", "title,wget,screenshot,pdf")
	} else {
		return errors.New("unsupported ArchiveBox CLI; see engine setup")
	}

	output, err := run(append(args, "--", j.Request.URL)...)
	if err != nil {
		return fmt.Errorf("ArchiveBox failed: %s", output)
	}
	if _, err := os.Stat(filepath.Join(j.Directory, "index.sqlite3")); err != nil {
		return errors.New("ArchiveBox exited without creating a collection")
	}
	return nil
}
