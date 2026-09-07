package standalone

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type transferDirectory struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type transferDirectories struct {
	Path        string              `json:"path"`
	Parent      string              `json:"parent"`
	Directories []transferDirectory `json:"directories"`
	Truncated   bool                `json:"truncated"`
}

func listTransferDirectories(ctx context.Context, path string) (transferDirectories, error) {
	result := transferDirectories{Directories: []transferDirectory{}}
	if path == "" {
		var err error
		path, err = os.UserHomeDir()
		if err != nil {
			return result, err
		}
	}
	if len(path) > 4096 || !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) || strings.HasPrefix(path, "//") {
		return result, errors.New("choose an absolute local directory; network shares are not browsed")
	}
	path = filepath.Clean(path)
	// Do not follow directory links or junctions during browsing.
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return result, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return result, errors.New("directory links are not browsed; enter the real directory path")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	directory, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer directory.Close()
	info, err := directory.Stat()
	if err != nil || !info.IsDir() {
		return result, errors.New("choose an existing directory")
	}
	result.Path, result.Parent = path, filepath.Dir(path)
	for inspected := 0; inspected < 4096; {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		entries, err := directory.ReadDir(128)
		inspected += len(entries)
		for _, entry := range entries {
			if entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
				if len(result.Directories) == 512 {
					result.Truncated = true
					break
				}
				result.Directories = append(result.Directories, transferDirectory{Name: entry.Name(), Path: filepath.Join(path, entry.Name())})
			}
		}
		if result.Truncated || errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return result, err
		}
		if inspected >= 4096 {
			result.Truncated = true
		}
	}
	sort.Slice(result.Directories, func(i, j int) bool {
		return strings.ToLower(result.Directories[i].Name) < strings.ToLower(result.Directories[j].Name)
	})
	return result, nil
}

func registerTransferDirectoryBrowser(mux *http.ServeMux, admission *admissionLimiter) {
	registerTransferConfigPOST(mux, admission, "/api/transfers/directories", "browse download directories", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Path string `json:"path"`
		}
		if !decodeStrictTransferJSON(w, r, 8<<10, &input) {
			return
		}
		result, err := listTransferDirectories(r.Context(), input.Path)
		if err != nil {
			writeTransferError(w, err, http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
}
