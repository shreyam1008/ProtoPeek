// Package selfupdate implements explicit, bounded updates of direct installations.
// It never runs a shell, elevates privileges, or replaces package-manager files.
package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

const repository = "https://github.com/shreyam1008/ProtoPeek"
const modulePath = "github.com/shreyam1008/ProtoPeek"
const maxArchive = 256 << 20
const maxBinary = 160 << 20

var stableVersion = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)$`)
var digestPattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)

type Installation struct {
	Version    string   `json:"version"`
	Revision   string   `json:"revision"`
	Channel    string   `json:"channel"`
	OS         string   `json:"os"`
	Arch       string   `json:"arch"`
	Executable string   `json:"executable"`
	Manager    string   `json:"manager"`
	CanUpdate  bool     `json:"canUpdate"`
	Reason     string   `json:"reason"`
	Commands   []string `json:"commands"`
}
type Plan struct {
	ID              string    `json:"id"`
	Channel         string    `json:"channel"`
	Version         string    `json:"version"`
	Revision        string    `json:"revision"`
	URL             string    `json:"url"`
	Available       bool      `json:"available"`
	CheckedAt       time.Time `json:"checkedAt"`
	Archive         string    `json:"archive"`
	Size            int64     `json:"size"`
	digest          string
	installedDigest string
}
type State struct {
	Installation    Installation `json:"installation"`
	Plan            *Plan        `json:"plan"`
	Phase           string       `json:"phase"`
	Error           string       `json:"error"`
	RestartRequired bool         `json:"restartRequired"`
	Notice          string       `json:"notice"`
}
type Engine struct {
	mu             sync.Mutex
	busy           bool
	state          State
	version        string
	client         *http.Client
	api, downloads string
	inspect        func() Installation
	validate       func(string, string) error
}

func New(version string) *Engine {
	e := &Engine{version: version, api: "https://api.github.com/repos/shreyam1008/ProtoPeek", downloads: repository + "/releases/download", validate: validateBinary}
	e.client = &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many release redirects")
		}
		if r.URL.Scheme != "https" {
			return errors.New("release redirect must use HTTPS")
		}
		switch r.URL.Hostname() {
		case "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
			return nil
		}
		return errors.New("untrusted release redirect")
	}}
	e.inspect = func() Installation { return Inspect(version) }
	e.state.Phase = "idle"
	return e
}

func defaultChannel(version string) string {
	if strings.Contains(version, "nightly") {
		return "nightly"
	}
	if strings.Contains(version, "edge") {
		return "edge"
	}
	return "stable"
}
func Inspect(version string) Installation {
	i := Installation{Version: version, Channel: defaultChannel(version), OS: runtime.GOOS, Arch: runtime.GOARCH, Manager: "direct", Commands: []string{}}
	if b, ok := debug.ReadBuildInfo(); ok {
		for _, s := range b.Settings {
			if s.Key == "vcs.revision" {
				i.Revision = s.Value
			}
		}
	}
	p, err := os.Executable()
	if err != nil {
		i.Reason = err.Error()
		return i
	}
	p, err = filepath.EvalSymlinks(p)
	if err != nil {
		i.Reason = err.Error()
		return i
	}
	i.Executable = p
	manager, commands := managedInstallation(p, runtime.GOOS)
	if manager != "" {
		i.Manager = manager
		i.Commands = commands
		i.Reason = "This installation is managed by " + manager + ". Update it through that manager."
		return i
	}
	name := strings.TrimSuffix(filepath.Base(p), ".exe")
	if (name != "protopeek" && name != "pp") || (!stableVersion.MatchString(version) && version != "v0.0.0-edge" && version != "v0.0.0-nightly") {
		i.Manager = "source or custom build"
		i.Reason = "Rebuild this source/custom installation, or install an official release first."
		return i
	}
	if err := validateBinary(p, ""); err != nil {
		i.Reason = err.Error()
		return i
	}
	i.CanUpdate = true
	return i
}

func managedInstallation(p, goos string) (string, []string) {
	lower := strings.ToLower(filepath.ToSlash(p))
	switch {
	case strings.Contains(lower, "/cellar/protopeek/"):
		return "Homebrew", []string{"brew update", "brew upgrade protopeek"}
	case strings.Contains(lower, "/scoop/apps/protopeek/"):
		return "Scoop", []string{"scoop update", "scoop update protopeek"}
	case strings.Contains(lower, "/nix/store/"):
		return "Nix", []string{"Update ProtoPeek through your Nix configuration."}
	case strings.HasPrefix(lower, "/snap/"):
		return "Snap", []string{"sudo snap refresh protopeek"}
	}
	if goos == "linux" {
		if _, err := os.Stat("/.dockerenv"); err == nil {
			return "container image", []string{"Pull or rebuild the ProtoPeek image, then recreate the container."}
		}
		for _, manager := range []struct {
			name, tool string
			args       []string
			commands   []string
		}{
			{"Debian package", "dpkg-query", []string{"-S", p}, []string{"sudo apt update", "sudo apt install --only-upgrade protopeek"}},
			{"RPM package", "rpm", []string{"-qf", p}, []string{"sudo dnf upgrade protopeek"}},
			{"Arch package", "pacman", []string{"-Qo", p}, []string{"sudo pacman -Syu protopeek"}},
		} {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := exec.CommandContext(ctx, manager.tool, manager.args...).Run()
			cancel()
			if err == nil {
				return manager.name, manager.commands
			}
		}
	}
	home, _ := os.UserHomeDir()
	gobin := os.Getenv("GOBIN")
	if gobin == "" {
		gp := os.Getenv("GOPATH")
		if gp == "" {
			gp = filepath.Join(home, "go")
		}
		gobin = filepath.Join(filepath.SplitList(gp)[0], "bin")
	}
	if filepath.Clean(filepath.Dir(p)) == filepath.Clean(gobin) {
		return "Go install", []string{"go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest", "go install github.com/shreyam1008/ProtoPeek/cmd/pp@latest"}
	}
	return "", nil
}

func (e *Engine) Snapshot() State {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.state
	if s.Installation.Executable == "" {
		s.Installation = e.inspect()
	}
	if replacedOnDisk(s.Installation) {
		s.RestartRequired = true
	}
	if s.Plan != nil {
		p := *s.Plan
		s.Plan = &p
	}
	return s
}
func (e *Engine) begin(phase string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.busy {
		return errors.New("an update operation is already running")
	}
	if e.state.RestartRequired {
		return errors.New("restart ProtoPeek before checking for another update")
	}
	e.busy = true
	e.state.Phase = phase
	e.state.Error = ""
	return nil
}
func (e *Engine) finish(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.busy = false
	if err != nil {
		e.state.Phase = "failed"
		e.state.Error = err.Error()
		if errors.Is(err, context.Canceled) {
			e.state.Phase = "cancelled"
		}
	}
}
func (e *Engine) phase(p string) { e.mu.Lock(); e.state.Phase = p; e.mu.Unlock() }

func (e *Engine) Check(ctx context.Context, channel string) (plan *Plan, err error) {
	if err = e.begin("checking"); err != nil {
		return
	}
	defer func() { e.finish(err) }()
	i := e.inspect()
	e.mu.Lock()
	e.state.Installation = i
	e.state.Plan = nil
	if replacedOnDisk(i) {
		e.state.RestartRequired = true
		e.mu.Unlock()
		return nil, errors.New("executable files were updated by another process; restart ProtoPeek first")
	}
	e.mu.Unlock()
	if channel == "" {
		channel = i.Channel
	}
	if channel != "stable" && channel != "edge" && channel != "nightly" {
		return nil, errors.New("channel must be stable, nightly or edge")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	endpoint := "/releases/latest"
	if channel != "stable" {
		endpoint = "/releases/tags/v0.0.0-" + channel
	}
	var release struct {
		Tag        string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err = e.json(ctx, e.api+endpoint, &release); err != nil {
		return
	}
	if release.Draft || (channel == "stable" && (release.Prerelease || !stableVersion.MatchString(release.Tag))) || (channel != "stable" && (release.Tag != "v0.0.0-"+channel || !release.Prerelease)) {
		return nil, errors.New("release does not match the selected channel")
	}
	arch := map[string]string{"amd64": "x86_64", "386": "x86_32", "arm64": "arm64"}[i.Arch]
	osname := i.OS
	if osname == "darwin" {
		osname = "osx"
	}
	extension := ".tar.gz"
	if i.OS == "windows" {
		extension = ".zip"
	}
	if arch == "" || (i.OS != "windows" && i.OS != "darwin" && i.OS != "linux") {
		return nil, errors.New("no release archive for this platform")
	}
	name := "protopeek_" + strings.TrimPrefix(release.Tag, "v") + "_" + osname + "_" + arch + extension
	plan = &Plan{Channel: channel, Version: release.Tag, URL: repository + "/releases/tag/" + release.Tag, Archive: name, CheckedAt: time.Now().UTC()}
	assets := 0
	checksums := 0
	for _, a := range release.Assets {
		if a.Name == name {
			assets++
			plan.Size = a.Size
			plan.digest = strings.TrimPrefix(a.Digest, "sha256:")
		}
		if a.Name == "checksums.txt" {
			checksums++
		}
	}
	if assets != 1 || checksums != 1 || plan.Size <= 0 || plan.Size > maxArchive {
		return nil, errors.New("release archives are unavailable or still being published; try again later")
	}
	if plan.digest != "" && !digestPattern.MatchString(plan.digest) {
		return nil, errors.New("invalid release asset digest")
	}
	if channel != "stable" {
		var ref struct {
			Object struct {
				SHA  string `json:"sha"`
				Type string `json:"type"`
			} `json:"object"`
		}
		if err = e.json(ctx, e.api+"/git/ref/tags/"+release.Tag, &ref); err != nil {
			return
		}
		if ref.Object.Type != "commit" || len(ref.Object.SHA) != 40 {
			return nil, errors.New("prerelease tag has no valid source revision")
		}
		plan.Revision = ref.Object.SHA
		plan.Available = i.Channel != channel || i.Revision != plan.Revision
	} else {
		plan.Available = i.Channel != "stable" || newer(release.Tag, i.Version)
	}
	if i.CanUpdate {
		plan.installedDigest, err = fileDigest(i.Executable)
		if err != nil {
			return nil, err
		}
	}
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return nil, err
	}
	plan.ID = hex.EncodeToString(id[:])
	e.mu.Lock()
	saved := *plan
	e.state.Plan = &saved
	e.state.Phase = "checked"
	e.mu.Unlock()
	return
}
func newer(a, b string) bool {
	aa, bb := stableVersion.FindStringSubmatch(a), stableVersion.FindStringSubmatch(b)
	if aa == nil {
		return false
	}
	if bb == nil {
		return true
	}
	for n := 1; n < 4; n++ {
		av, _ := strconv.ParseUint(aa[n], 10, 64)
		bv, _ := strconv.ParseUint(bb[n], 10, 64)
		if av != bv {
			return av > bv
		}
	}
	return false
}
func (e *Engine) json(ctx context.Context, url string, out any) error {
	b, err := e.read(ctx, url, 2<<20)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(b, out); err != nil {
		return errors.New("invalid release metadata")
	}
	return nil
}
func (e *Engine) response(ctx context.Context, url string) (*http.Response, error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("User-Agent", "ProtoPeek updater")
	r.Header.Set("Accept", "application/vnd.github+json")
	res, err := e.client.Do(r)
	if err != nil {
		return nil, fmt.Errorf("release request: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("release server returned HTTP %d; check your connection or try again later", res.StatusCode)
	}
	return res, nil
}
func (e *Engine) read(ctx context.Context, url string, limit int64) ([]byte, error) {
	r, err := e.response(ctx, url)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if int64(len(b)) > limit {
		return nil, errors.New("release response exceeds size limit")
	}
	return b, err
}
func fileDigest(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (e *Engine) Apply(ctx context.Context, id string) (err error) {
	if err = e.begin("preparing"); err != nil {
		return
	}
	defer func() { e.finish(err) }()
	e.mu.Lock()
	p := e.state.Plan
	i := e.state.Installation
	e.mu.Unlock()
	if p == nil || p.ID != id || time.Since(p.CheckedAt) > 10*time.Minute {
		return errors.New("update preview expired; check again")
	}
	if !i.CanUpdate {
		return errors.New(i.Reason)
	}
	if !p.Available {
		return errors.New("the selected release is already installed")
	}
	dir := filepath.Dir(i.Executable)
	unlock, err := lockInstall(filepath.Join(dir, ".protopeek-update.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	if err = unchanged(i.Executable, p.installedDigest); err != nil {
		return
	}
	stage, err := os.MkdirTemp(dir, ".protopeek-update-")
	if err != nil {
		return fmt.Errorf("cannot write installation directory; use its owner or package manager: %w", err)
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(stage)
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	e.phase("downloading")
	base := e.downloads + "/" + p.Version + "/"
	checksums, err := e.read(ctx, base+"checksums.txt", 1<<20)
	if err != nil {
		return err
	}
	expected, err := checksum(checksums, p.Archive)
	if err != nil {
		return err
	}
	if p.digest != "" && !strings.EqualFold(p.digest, expected) {
		return errors.New("release changed since the preview; check again")
	}
	response, err := e.response(ctx, base+p.Archive)
	if err != nil {
		return err
	}
	archive := filepath.Join(stage, "archive")
	f, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		response.Body.Close()
		return err
	}
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(response.Body, maxArchive+1))
	response.Body.Close()
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != p.Size || n > maxArchive || hex.EncodeToString(h.Sum(nil)) != expected {
		return errors.New("archive size or SHA-256 verification failed; installation was not changed")
	}
	e.phase("verifying")
	if err = extract(archive, stage, i.OS); err != nil {
		return err
	}
	suffix := ""
	if i.OS == "windows" {
		suffix = ".exe"
	}
	for _, name := range []string{"protopeek", "pp"} {
		if err = e.validate(filepath.Join(stage, name+suffix), p.Revision); err != nil {
			return err
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = unchanged(i.Executable, p.installedDigest); err != nil {
		return err
	}
	// Cancellation ends at the commit boundary. Complete or roll back the pair even
	// if the browser closes now; the existing server continues until user restart.
	e.phase("installing")
	var notice string
	keep, notice, err = installPair(dir, stage, suffix, e.validate)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.state.Phase = "installed"
	e.state.RestartRequired = true
	e.state.Notice = notice
	e.mu.Unlock()
	return nil
}
func unchanged(path, digest string) error {
	now, err := fileDigest(path)
	if err != nil {
		return err
	}
	if now != digest {
		return errors.New("installation changed since the preview; restart and check again")
	}
	return nil
}
func checksum(b []byte, name string) (string, error) {
	found := ""
	count := 0
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && strings.TrimPrefix(parts[1], "*") == name {
			count++
			found = strings.ToLower(parts[0])
		}
	}
	if count != 1 || !digestPattern.MatchString(found) {
		return "", errors.New("checksums.txt must contain one valid SHA-256 for this archive")
	}
	return found, nil
}

func validateBinary(p, revision string) error {
	b, err := buildinfo.ReadFile(p)
	if err != nil {
		return fmt.Errorf("invalid ProtoPeek executable: %w", err)
	}
	if b.Main.Path != modulePath || (b.Path != modulePath+"/cmd/protopeek" && b.Path != modulePath+"/cmd/pp") {
		return errors.New("executable is not an official ProtoPeek command")
	}
	if revision != "" {
		actual := ""
		for _, s := range b.Settings {
			if s.Key == "vcs.revision" {
				actual = s.Value
			}
		}
		if actual != revision {
			return errors.New("prerelease archive source does not match the preview; check again")
		}
	}
	return nil
}

func replacedOnDisk(i Installation) bool {
	if i.Revision == "" || i.Executable == "" {
		return false
	}
	b, err := buildinfo.ReadFile(i.Executable)
	if err != nil || b.Main.Path != modulePath {
		return false
	}
	for _, setting := range b.Settings {
		if setting.Key == "vcs.revision" {
			return setting.Value != "" && setting.Value != i.Revision
		}
	}
	return false
}
func extract(archive, dir, goos string) error {
	suffix := ""
	if goos == "windows" {
		suffix = ".exe"
	}
	seen := map[string]bool{}
	write := func(name string, size int64, regular bool, r io.Reader) error {
		if name != "protopeek"+suffix && name != "pp"+suffix {
			return nil
		}
		if !regular || seen[name] || size <= 0 || size > maxBinary {
			return errors.New("invalid or duplicate executable in release archive")
		}
		seen[name] = true
		f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(f, io.LimitReader(r, size+1))
		syncErr := f.Sync()
		closeErr := f.Close()
		if copyErr != nil {
			return copyErr
		}
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n != size {
			return errors.New("incomplete executable in release archive")
		}
		return nil
	}
	if goos == "windows" {
		z, err := zip.OpenReader(archive)
		if err != nil {
			return err
		}
		defer z.Close()
		if len(z.File) > 4096 {
			return errors.New("too many archive entries")
		}
		for _, f := range z.File {
			if f.Name != "protopeek.exe" && f.Name != "pp.exe" {
				continue
			}
			r, err := f.Open()
			if err != nil {
				return err
			}
			err = write(f.Name, int64(f.UncompressedSize64), f.Mode().IsRegular(), r)
			r.Close()
			if err != nil {
				return err
			}
		}
	} else {
		f, err := os.Open(archive)
		if err != nil {
			return err
		}
		defer f.Close()
		gz, err := gzip.NewReader(f)
		if err != nil {
			return err
		}
		defer gz.Close()
		tr := tar.NewReader(io.LimitReader(gz, 512<<20))
		for n := 0; ; n++ {
			hdr, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}
			if n >= 4096 {
				return errors.New("too many archive entries")
			}
			if err = write(hdr.Name, hdr.Size, hdr.Typeflag == tar.TypeReg, tr); err != nil {
				return err
			}
		}
	}
	if len(seen) != 2 {
		return errors.New("release must include both protopeek and pp")
	}
	return nil
}

// installPair preserves unrelated pp commands and rolls back every completed
// rename on error. Backups stay beside the installation if Windows still maps
// the running executable, or if rollback requires manual recovery.
func installPair(dir, stage, suffix string, validate func(string, string) error) (keep bool, notice string, err error) {
	type change struct {
		target, source, backup string
		installed, existed     bool
	}
	changes := []*change{}
	for _, name := range []string{"protopeek", "pp"} {
		target := filepath.Join(dir, name+suffix)
		info, statErr := os.Lstat(target)
		if statErr != nil && !os.IsNotExist(statErr) {
			return false, "", statErr
		}
		if statErr == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				resolved, resolveErr := filepath.EvalSymlinks(target)
				if name == "pp" && resolveErr == nil && resolved == filepath.Join(dir, "protopeek"+suffix) {
					continue
				}
				return false, "", errors.New("installation contains an unexpected executable symlink")
			}
			if err = validate(target, ""); err != nil {
				if name == "pp" {
					notice = "An unrelated pp command was preserved. Use protopeek to launch."
					continue
				}
				return false, "", err
			}
		}
		changes = append(changes, &change{target: target, source: filepath.Join(stage, name+suffix), backup: filepath.Join(stage, "previous-"+name+suffix), existed: statErr == nil})
	}
	rollback := func(cause error) (bool, string, error) {
		var failures []error
		for n := len(changes) - 1; n >= 0; n-- {
			c := changes[n]
			if c.installed {
				if e := os.Remove(c.target); e != nil {
					failures = append(failures, e)
					continue
				}
			}
			if _, e := os.Stat(c.backup); e == nil {
				if e = os.Rename(c.backup, c.target); e != nil {
					failures = append(failures, e)
				}
			}
		}
		if len(failures) > 0 {
			return true, "", fmt.Errorf("update failed: %w; recovery files retained in %s: %v", cause, stage, failures)
		}
		return false, "", fmt.Errorf("update rolled back; close other ProtoPeek processes and retry: %w", cause)
	}
	for _, c := range changes {
		if c.existed {
			if err = os.Rename(c.target, c.backup); err != nil {
				return rollback(err)
			}
		}
		if err = os.Rename(c.source, c.target); err != nil {
			return rollback(err)
		}
		c.installed = true
	}
	// The installer marker is an ownership hint, not runtime state. Failure to
	// refresh it must not invalidate a successfully installed executable pair.
	pp := filepath.Join(dir, "pp"+suffix)
	if validate(pp, "") == nil {
		if digest, e := fileDigest(pp); e == nil {
			if e = os.WriteFile(filepath.Join(dir, ".protopeek-install"), []byte("ProtoPeek "+digest), 0600); e != nil {
				notice += " Installer ownership marker could not be refreshed."
			}
		}
	}
	if err = os.RemoveAll(stage); err != nil {
		return true, strings.TrimSpace(notice + " Previous executable backups remain in " + stage + "; remove that directory after all old ProtoPeek processes exit."), nil
	}
	return false, notice, nil
}
