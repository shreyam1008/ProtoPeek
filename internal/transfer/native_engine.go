package transfer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/safepromote"
	"golang.org/x/time/rate"
)

const nativeStateLimit = 16 << 20
const maxPreservedPartials = 64

var ErrNativeUnsupportedConfig = errors.New("built-in downloader does not support overwriting existing files; disable overwrite in transfer settings")
var ErrNativeManagedHeader = errors.New("the built-in downloader manages Range, If-Range and Accept-Encoding; remove these headers and retry")
var ErrPreservedLimit = errors.New("too many preserved partials; inspect the listed files and remove unneeded ones before retrying")
var ErrPreservedInvalid = errors.New("invalid preserved partial path")
var ErrPreservedNotFound = errors.New("preserved partial is not in the list; refresh before trying again")

type nativeRecord struct {
	Job                Job                `json:"job"`
	Request            AddRequest         `json:"request"`
	Validator          string             `json:"validator,omitempty"`
	SourceIndex        int                `json:"sourceIndex,omitempty"`
	EffectiveURLSHA256 string             `json:"effectiveUrlSha256,omitempty"`
	CommitSHA256       string             `json:"commitSha256,omitempty"`
	Running            bool               `json:"-"`
	Cancel             context.CancelFunc `json:"-"`
}

type nativeState struct {
	Version           int                      `json:"version"`
	Jobs              []*nativeRecord          `json:"jobs"`
	PreservedPartials []nativePreservedPartial `json:"preservedPartials,omitempty"`
}

type nativePreservedPartial struct {
	PreservedPartial
	DirectoryIdentity string `json:"directoryIdentity,omitempty"`
}

type nativeEngine struct {
	mu             sync.Mutex
	state          nativeState
	path           string
	config         HostConfig
	client         *http.Client
	limiter        *rate.Limiter
	promote        func(string, string) error
	syncDir        func(string) error
	stopping       bool
	persistenceErr error
	wg             sync.WaitGroup
	done           chan struct{}
	stopOnce       sync.Once
}

type nativeLauncher struct{}

func newNativeLauncher() Launcher { return nativeLauncher{} }

func (nativeLauncher) Start(ctx context.Context, config HostConfig, paths Paths) (*Runtime, error) {
	if err := ValidateHostConfig(config); err != nil {
		return nil, err
	}
	if err := ValidatePaths(paths); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if config.AllowOverwriteExistingFiles {
		return nil, ErrNativeUnsupportedConfig
	}
	client := newNativeHTTPClient(config.AllowInsecureTLS, 30*time.Second)
	e := &nativeEngine{path: filepath.Join(paths.StateDirectory, "session.native.json"), config: config, client: client, promote: safepromote.Rename, syncDir: syncDirectory, done: make(chan struct{}), state: nativeState{Version: 1}}
	if config.MaxDownloadBytesPerSecond > 0 {
		e.limiter = rate.NewLimiter(rate.Limit(config.MaxDownloadBytesPerSecond), 64<<10)
	}
	if err := e.load(ctx); err != nil {
		return nil, err
	}
	e.mu.Lock()
	if err := ctx.Err(); err != nil {
		e.mu.Unlock()
		return nil, err
	}
	for _, r := range e.state.Jobs {
		if r.Job.Status == JobDownloading {
			r.Job.Status = JobPaused
		}
	}
	if err := e.saveLocked(); err != nil {
		e.mu.Unlock()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		e.mu.Unlock()
		return nil, err
	}
	e.scheduleLocked()
	e.mu.Unlock()
	return &Runtime{Engine: e, EngineName: "native", EngineVersion: "built-in", Done: e.done, Stop: e.stop, Err: func() error { return nil }, observeCompletions: true, observationWake: make(chan struct{}, 1)}, nil
}

// Each read gets a fresh deadline, so a stalled peer cannot occupy a slot
// forever while an actively transferring large file has no total time limit.
type nativeIdleConn struct {
	net.Conn
	timeout time.Duration
}

func (c *nativeIdleConn) Read(p []byte) (int, error) {
	if err := c.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Read(p)
}

func newNativeHTTPClient(insecure bool, idle time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: insecure} // controlled by explicit user setting
	transport.ResponseHeaderTimeout = idle
	// Read deadlines apply to the connection, so keep each transfer on an
	// HTTP/1 connection instead of a shared multiplexed HTTP/2 connection.
	transport.ForceAttemptHTTP2 = false
	transport.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
	dial := transport.DialContext
	if dial == nil {
		dial = (&net.Dialer{Timeout: idle, KeepAlive: 30 * time.Second}).DialContext
	}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := dial(ctx, network, address)
		if err != nil {
			return nil, err
		}
		return &nativeIdleConn{Conn: conn, timeout: idle}, nil
	}
	return &http.Client{Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("unsupported redirect")
		}
		if len(via) > 0 && !sameNativeOrigin(req.URL, via[len(via)-1].URL) {
			// A redirect can return to the original origin from a signed CDN
			// URL. Never reveal that previous cross-origin URL via Referer.
			req.Header.Del("Referer")
		}
		if len(via) > 0 && !sameNativeOrigin(req.URL, via[0].URL) {
			// Request headers may contain arbitrary secrets; never forward any
			// of them to a different origin. The engine controls these three
			// headers, which are needed for safe resume through a CDN redirect.
			for k := range req.Header {
				if !strings.EqualFold(k, "Range") && !strings.EqualFold(k, "If-Range") && !strings.EqualFold(k, "Accept-Encoding") {
					req.Header.Del(k)
				}
			}
		}
		return nil
	}}
}

func sameNativeOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func (e *nativeEngine) load(ctx context.Context) error { return e.loadStateContext(ctx, true) }

func (e *nativeEngine) loadState(recoverPromotions bool) error {
	return e.loadStateContext(context.Background(), recoverPromotions)
}

func (e *nativeEngine) loadStateContext(ctx context.Context, recoverPromotions bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(e.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > nativeStateLimit {
		return errors.New("native transfer session is not a bounded regular file")
	}
	f, err := os.Open(e.path)
	if err != nil {
		return err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return errors.New("native transfer session changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, nativeStateLimit+1))
	if err != nil || len(data) > nativeStateLimit {
		return errors.New("could not read bounded native session")
	}
	if err := DecodeStrictJSON(data, &e.state); err != nil {
		return errors.New("invalid native transfer session")
	}
	if e.state.Version != 1 || len(e.state.Jobs) > e.config.MaxTrackedJobs || len(e.state.PreservedPartials) > maxPreservedPartials {
		return errors.New("unsupported or oversized native transfer session")
	}
	seen := map[string]bool{}
	seenPartial := map[string]bool{}
	for _, partial := range e.state.PreservedPartials {
		if !validPreservedPartial(partial.PreservedPartial) || len(partial.DirectoryIdentity) > 128 || containsControl(partial.DirectoryIdentity) || seenPartial[partial.Path] {
			return errors.New("invalid preserved partial metadata")
		}
		seenPartial[partial.Path] = true
	}
	for _, r := range e.state.Jobs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if r == nil || !validJobID(r.Job.ID) || seen[r.Job.ID] {
			return errors.New("invalid native transfer job")
		}
		seen[r.Job.ID] = true
		normalized, err := validateAddRequest(r.Request)
		if err != nil || normalized.OutputName == "" || r.Job.Name != normalized.OutputName {
			return errors.New("invalid native transfer request")
		}
		r.Request = normalized
		dir := nativeDirectory(e.config, r.Request)
		if r.Job.Directory != dir || r.Job.OutputPath != filepath.Join(dir, r.Request.OutputName) {
			return errors.New("invalid native transfer destination")
		}
		switch r.Job.Status {
		case JobQueued, JobDownloading, JobPaused, JobFailed, JobCompleted:
		default:
			return errors.New("invalid native transfer status")
		}
		if len(r.Validator) > 2048 || containsControl(r.Validator) || r.SourceIndex < 0 || r.SourceIndex >= len(r.Request.Sources) {
			return errors.New("invalid native transfer validator")
		}
		if r.Validator != "" && strongNativeETag(r.Validator) == "" {
			// Older local state may contain a date or weak tag. Keep its
			// partial bytes, but refuse unsafe resumption.
			r.Validator = ""
		}
		if r.EffectiveURLSHA256 != "" {
			digest, err := hex.DecodeString(r.EffectiveURLSHA256)
			if err != nil || len(digest) != sha256.Size {
				return errors.New("invalid native effective URL identity")
			}
		}
		if r.CommitSHA256 != "" {
			digest, err := hex.DecodeString(r.CommitSHA256)
			if err != nil || len(digest) != sha256.Size || r.Job.Status == JobCompleted {
				return errors.New("invalid native promotion checkpoint")
			}
			if recoverPromotions {
				if err := recoverNativePromotion(ctx, r, e.promote, e.syncDir); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// A checkpoint is written before promotion. On restart, verify the owned
// bytes before finishing the rename or recognizing an already promoted file.
func recoverNativePromotion(ctx context.Context, r *nativeRecord, promote func(string, string) error, syncDir func(string) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	part := nativePart(r)
	_, partErr := os.Lstat(part)
	_, destErr := os.Lstat(r.Job.OutputPath)
	if partErr == nil && errors.Is(destErr, os.ErrNotExist) {
		sum, err := hashNativeFile(ctx, part)
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil || sum != r.CommitSHA256 {
			return errors.New("native promotion checkpoint does not match its partial file")
		}
		if err := promote(part, r.Job.OutputPath); err != nil {
			return errors.New("could not recover native promotion safely")
		}
	} else if errors.Is(partErr, os.ErrNotExist) && destErr == nil {
		sum, err := hashNativeFile(ctx, r.Job.OutputPath)
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil || sum != r.CommitSHA256 {
			return errors.New("native promotion checkpoint does not match its output")
		}
	} else if partErr == nil && destErr == nil {
		// Preserve both files and let other jobs load. The user can resolve the
		// destination conflict before retrying this particular download.
		r.Job.Status = JobFailed
		r.Job.ErrorMessage = "The destination already exists; the partial download was preserved."
		r.CommitSHA256 = ""
		return nil
	} else {
		return errors.New("native promotion checkpoint has conflicting or missing files")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := syncDir(filepath.Dir(r.Job.OutputPath)); err != nil {
		return errors.New("could not sync the recovered download destination")
	}
	r.Job.Status = JobCompleted
	r.Job.ProgressPercent = 100
	r.Job.BytesPerSecond = 0
	if r.Request.SHA256 != "" {
		r.Job.Verification = "verified"
		r.Job.ActualSHA256 = r.CommitSHA256
	}
	r.Request.Headers = nil
	r.Request.Sources = []string{r.Job.Source}
	r.SourceIndex = 0
	r.EffectiveURLSHA256 = ""
	r.CommitSHA256 = ""
	return nil
}

func hashNativeFile(ctx context.Context, path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("downloaded file is not a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return "", errors.New("downloaded file changed while opening")
	}
	hash := sha256.New()
	buf := make([]byte, 64<<10)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, readErr := f.Read(buf)
		if n > 0 {
			_, _ = hash.Write(buf[:n])
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				return "", readErr
			}
			break
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (e *nativeEngine) saveLocked() error {
	data, err := json.Marshal(e.state)
	if err != nil || len(data) > nativeStateLimit {
		return errors.New("cannot encode bounded native transfer session")
	}
	if info, err := os.Lstat(e.path); err == nil && !info.Mode().IsRegular() {
		return errors.New("native session destination is not a regular file")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return writeAtomicPrivate(e.path, append(data, '\n'))
}

func nativeDirectory(config HostConfig, req AddRequest) string {
	if req.DestinationDirectory != "" {
		return req.DestinationDirectory
	}
	return config.DownloadDirectory
}
func nativePart(r *nativeRecord) string {
	// Do not append to the output filename: it can already be close to the
	// filesystem's component limit. Preserve partials written by earlier
	// source builds using the original appended-name convention.
	legacy := r.Job.OutputPath + ".protopeek-" + r.Job.ID + ".part"
	if _, err := os.Lstat(legacy); err == nil {
		return legacy
	}
	return filepath.Join(r.Job.Directory, ".protopeek-"+r.Job.ID+".part")
}

func (e *nativeEngine) Snapshot(ctx context.Context, maxTracked int) (EngineSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return EngineSnapshot{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.persistenceErr != nil {
		if err := e.saveLocked(); err != nil {
			e.persistenceErr = err
			return EngineSnapshot{}, fmt.Errorf("%w: cannot persist native transfer state", ErrQueueStateNotPersisted)
		}
		e.persistenceErr = nil
	}
	all := make([]Job, 0, len(e.state.Jobs))
	for _, r := range e.state.Jobs {
		all = append(all, r.Job)
	}
	m := metricsForJobs(all)
	pending := m.QueuedCount + m.PausedCount
	if maxTracked < 1 {
		return EngineSnapshot{}, errors.New("max tracked jobs must be positive")
	}
	if len(all) > maxTracked {
		all = all[:maxTracked]
	}
	return EngineSnapshot{Jobs: all, Metrics: m, PendingCount: pending, PreservedPartials: publicPreservedPartials(e.state.PreservedPartials)}, nil
}

func (e *nativeEngine) Add(ctx context.Context, req AddRequest, config HostConfig) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	for _, h := range req.Headers {
		switch strings.ToLower(h.Name) {
		case "range", "if-range", "accept-encoding":
			return "", ErrNativeManagedHeader
		}
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	id := hex.EncodeToString(raw)
	dir := nativeDirectory(config, req)
	req.DestinationDirectory = dir
	r := &nativeRecord{Request: cloneAddRequest(req), Job: Job{ID: id, Name: req.OutputName, Directory: dir, OutputPath: filepath.Join(dir, req.OutputName), Source: redactSource(req.Sources[0]), Status: JobQueued, Verification: "pending"}}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.stopping {
		return "", ErrEngineNotRunning
	}
	e.state.Jobs = append(e.state.Jobs, r)
	if err := e.saveLocked(); err != nil {
		e.state.Jobs = e.state.Jobs[:len(e.state.Jobs)-1]
		return "", err
	}
	e.scheduleLocked()
	return id, nil
}

func (e *nativeEngine) findLocked(id string) (*nativeRecord, int) {
	for i, r := range e.state.Jobs {
		if r.Job.ID == id {
			return r, i
		}
	}
	return nil, -1
}
func (e *nativeEngine) Pause(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	r, _ := e.findLocked(id)
	if r == nil {
		return errors.New("transfer not found")
	}
	if r.Job.Status != JobQueued && r.Job.Status != JobDownloading {
		return errors.New("transfer cannot be paused")
	}
	old := r.Job.Status
	r.Job.Status = JobPaused
	if err := e.saveLocked(); err != nil {
		r.Job.Status = old
		return err
	}
	if r.Cancel != nil {
		r.Cancel()
	}
	return nil
}
func (e *nativeEngine) Resume(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	r, _ := e.findLocked(id)
	if r == nil || r.Job.Status != JobPaused {
		return errors.New("transfer is not paused")
	}
	r.Job.Status = JobQueued
	if err := e.saveLocked(); err != nil {
		r.Job.Status = JobPaused
		return err
	}
	e.scheduleLocked()
	return nil
}
func (e *nativeEngine) Retry(ctx context.Context, id string, req AddRequest, config HostConfig) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	e.mu.Lock()
	r, _ := e.findLocked(id)
	if r == nil || r.Job.Status != JobFailed || r.Running {
		e.mu.Unlock()
		return "", errors.New("only failed transfers can be retried")
	}
	if r.CommitSHA256 != "" {
		e.mu.Unlock()
		return "", errors.New("restart the downloader to recover the completed output")
	}
	// A retry may resume a compatible partial. If the prior bytes are known
	// bad, or identity cannot be trusted, preserve them under a unique name
	// and start over only after the user explicitly requests Retry.
	restart := r.Job.Verification == "failed" || r.Validator == "" || r.EffectiveURLSHA256 == "" ||
		strings.Contains(r.Job.ErrorMessage, "validator") || strings.Contains(r.Job.ErrorMessage, "redirect target changed") ||
		strings.Contains(r.Job.ErrorMessage, "resume range") || strings.Contains(r.Job.ErrorMessage, "completed range") ||
		strings.Contains(r.Job.ErrorMessage, "encoded response") || strings.Contains(r.Job.ErrorMessage, "accept the download or safe resume")
	if restart {
		e.state.PreservedPartials = existingPreservedPartials(e.state.PreservedPartials)
		part := nativePart(r)
		info, err := os.Lstat(part)
		if err == nil {
			if !info.Mode().IsRegular() {
				e.mu.Unlock()
				return "", errors.New("partial download is not a regular file")
			}
			if len(e.state.PreservedPartials) >= maxPreservedPartials {
				e.mu.Unlock()
				return "", ErrPreservedLimit
			}
			random := make([]byte, 8)
			if _, err := rand.Read(random); err != nil {
				e.mu.Unlock()
				return "", err
			}
			preserved := filepath.Join(r.Job.Directory, ".protopeek-"+r.Job.ID+"-"+hex.EncodeToString(random)+"-preserved.part")
			identity, _ := directoryIdentity(r.Job.Directory)
			// Reserve the destination durably before the rename. A crash after
			// the rename can then never leave an unlisted retained file.
			e.state.PreservedPartials = append(e.state.PreservedPartials, nativePreservedPartial{PreservedPartial: PreservedPartial{JobID: r.Job.ID, Path: preserved, SizeBytes: info.Size()}, DirectoryIdentity: identity})
			if err := e.saveLocked(); err != nil {
				e.state.PreservedPartials = e.state.PreservedPartials[:len(e.state.PreservedPartials)-1]
				e.persistenceErr = err
				e.mu.Unlock()
				return "", fmt.Errorf("%w: could not record preserved partial", ErrQueueStateNotPersisted)
			}
			if err := safepromote.Rename(part, preserved); err != nil {
				e.state.PreservedPartials = e.state.PreservedPartials[:len(e.state.PreservedPartials)-1]
				if saveErr := e.saveLocked(); saveErr != nil {
					e.persistenceErr = saveErr
				}
				e.mu.Unlock()
				return "", errors.New("could not preserve the prior partial download")
			}
			if err := e.syncDir(r.Job.Directory); err != nil {
				e.mu.Unlock()
				return "", errors.New("could not sync the preserved partial download")
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			e.mu.Unlock()
			return "", errors.New("could not inspect the partial download")
		}
		r.Validator, r.EffectiveURLSHA256 = "", ""
		r.SourceIndex = 0
		r.Job.CompletedBytes, r.Job.TotalBytes = 0, 0
		r.Job.ProgressPercent = 0
	}
	r.Job.Status = JobQueued
	r.Job.ErrorMessage = ""
	r.Job.ErrorCode = ""
	r.Job.Verification = "pending"
	r.Job.VerifyMessage = ""
	r.Job.ActualSHA256 = ""
	r.Job.VerifiedBytes = 0
	if err := e.saveLocked(); err != nil {
		r.Job.Status = JobFailed
		e.mu.Unlock()
		return "", err
	}
	e.scheduleLocked()
	e.mu.Unlock()
	return id, nil
}

func validPreservedPartial(partial PreservedPartial) bool {
	if !validJobID(partial.JobID) || !filepath.IsAbs(partial.Path) || filepath.Clean(partial.Path) != partial.Path || len(partial.Path) > maxDestinationLength+128 || containsControl(partial.Path) || partial.SizeBytes < 0 {
		return false
	}
	base := filepath.Base(partial.Path)
	prefix := ".protopeek-" + partial.JobID + "-"
	const suffix = "-preserved.part"
	if !strings.HasPrefix(base, prefix) || !strings.HasSuffix(base, suffix) {
		return false
	}
	random := strings.TrimSuffix(strings.TrimPrefix(base, prefix), suffix)
	decoded, err := hex.DecodeString(random)
	return err == nil && len(decoded) == 8
}

// A user may remove a listed file manually. Missing entries are hidden and
// pruned on the next retry; inaccessible or replaced paths remain visible.
func existingPreservedPartials(partials []nativePreservedPartial) []nativePreservedPartial {
	result := make([]nativePreservedPartial, 0, len(partials))
	for _, partial := range partials {
		if _, err := os.Lstat(partial.Path); errors.Is(err, os.ErrNotExist) {
			// A disconnected drive or unmounted directory can also return
			// ENOENT. Forget a missing file only on the same known directory.
			identity, identityErr := directoryIdentity(filepath.Dir(partial.Path))
			if partial.DirectoryIdentity != "" && identityErr == nil && identity == partial.DirectoryIdentity {
				continue
			}
		}
		result = append(result, partial)
	}
	return result
}

func publicPreservedPartials(partials []nativePreservedPartial) []PreservedPartial {
	visible := existingPreservedPartials(partials)
	result := make([]PreservedPartial, 0, len(visible))
	for _, partial := range visible {
		result = append(result, partial.PreservedPartial)
	}
	return result
}

func readPreservedPartials(config HostConfig, paths Paths) ([]PreservedPartial, error) {
	e := &nativeEngine{path: filepath.Join(paths.StateDirectory, "session.native.json"), config: config, state: nativeState{Version: 1}}
	if err := e.loadState(false); err != nil {
		return nil, err
	}
	return publicPreservedPartials(e.state.PreservedPartials), nil
}

// forgetPreserved changes only the private ledger. It never opens or modifies
// the recorded file, including when its volume is disconnected or identity is
// unavailable. Callers must first validate the path and own the engine lease.
func (e *nativeEngine) forgetPreserved(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	index := -1
	for i, partial := range e.state.PreservedPartials {
		if partial.Path == path {
			index = i
			break
		}
	}
	if index < 0 {
		return ErrPreservedNotFound
	}
	updated := make([]nativePreservedPartial, 0, len(e.state.PreservedPartials)-1)
	updated = append(updated, e.state.PreservedPartials[:index]...)
	updated = append(updated, e.state.PreservedPartials[index+1:]...)
	e.state.PreservedPartials = updated
	if err := e.saveLocked(); err != nil {
		e.persistenceErr = err
		return fmt.Errorf("%w: preserved list change could not be confirmed", ErrQueueStateNotPersisted)
	}
	return nil
}
func (e *nativeEngine) Cancel(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	r, i := e.findLocked(id)
	if r == nil {
		return errors.New("transfer not found")
	}
	if r.Cancel != nil {
		r.Cancel()
	}
	e.state.Jobs = append(e.state.Jobs[:i], e.state.Jobs[i+1:]...)
	if err := e.saveLocked(); err != nil {
		e.persistenceErr = err
		return fmt.Errorf("%w: native queue cancellation: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}
func (e *nativeEngine) SaveSession(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.saveLocked()
}
func (e *nativeEngine) Shutdown(ctx context.Context) error { return e.stop(ctx) }
func (e *nativeEngine) stop(ctx context.Context) error {
	e.stopOnce.Do(func() {
		e.mu.Lock()
		e.stopping = true
		for _, r := range e.state.Jobs {
			if r.Job.Status == JobDownloading {
				r.Job.Status = JobPaused
			}
			if r.Cancel != nil {
				r.Cancel()
			}
		}
		e.mu.Unlock()
		go func() {
			e.wg.Wait()
			e.mu.Lock()
			e.persistenceErr = e.saveLocked()
			e.mu.Unlock()
			close(e.done)
		}()
	})
	select {
	case <-e.done:
		return e.SaveSession(context.Background())
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (e *nativeEngine) scheduleLocked() {
	if e.stopping {
		return
	}
	active := 0
	for _, r := range e.state.Jobs {
		if r.Running {
			active++
		}
	}
	for _, r := range e.state.Jobs {
		if active >= e.config.MaxActiveJobs {
			break
		}
		if r.Job.Status != JobQueued || r.Running {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		r.Cancel = cancel
		r.Running = true
		r.Job.Status = JobDownloading
		active++
		e.wg.Add(1)
		go e.run(ctx, r)
	}
}

func (e *nativeEngine) run(ctx context.Context, r *nativeRecord) {
	defer e.wg.Done()
	err := e.download(ctx, r)
	e.mu.Lock()
	defer e.mu.Unlock()
	r.Running = false
	r.Cancel = nil
	current, _ := e.findLocked(r.Job.ID)
	if current != r {
		e.scheduleLocked()
		return
	}
	if r.Job.Status == JobDownloading {
		if err != nil {
			r.Job.Status = JobFailed
			r.Job.ErrorMessage = err.Error()
			r.Job.BytesPerSecond = 0
		} else {
			r.Job.Status = JobCompleted
			r.Job.ProgressPercent = 100
			r.Job.BytesPerSecond = 0
			r.Request.Headers = nil
			r.Request.Sources = []string{r.Job.Source}
			r.SourceIndex = 0
			r.EffectiveURLSHA256 = ""
		}
	}
	if err := e.saveLocked(); err != nil {
		e.persistenceErr = err
	}
	e.scheduleLocked()
}

func (e *nativeEngine) download(ctx context.Context, r *nativeRecord) error {
	part := nativePart(r)
	info, err := os.Lstat(part)
	var f *os.File
	var offset int64
	if errors.Is(err, os.ErrNotExist) {
		f, err = os.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	} else if err == nil && info.Mode().IsRegular() {
		f, err = os.OpenFile(part, os.O_WRONLY|os.O_APPEND, 0600)
		if err == nil {
			actual, statErr := f.Stat()
			if statErr != nil || !os.SameFile(info, actual) {
				_ = f.Close()
				return errors.New("partial file changed while opening")
			}
			offset = actual.Size()
		}
	} else if err == nil {
		return errors.New("partial download is not a regular file")
	}
	if err != nil {
		return errors.New("could not open the owned partial file")
	}
	defer f.Close()
	e.mu.Lock()
	validator := r.Validator
	request := cloneAddRequest(r.Request)
	sourceIndex := r.SourceIndex
	effectiveURLSHA256 := r.EffectiveURLSHA256
	e.mu.Unlock()
	if offset > 0 && (validator == "" || effectiveURLSHA256 == "") {
		return errors.New("server did not provide a safe resume validator; partial file was preserved")
	}
	var response *http.Response
	selectedSource := 0
	for index, source := range request.Sources {
		if offset > 0 && index != sourceIndex {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
		if err != nil {
			continue
		}
		for _, h := range request.Headers {
			req.Header.Set(h.Name, h.Value)
		}
		agent := request.UserAgent
		if agent == "" {
			agent = e.config.UserAgent
		}
		req.Header.Set("User-Agent", agent)
		req.Header.Set("Accept-Encoding", "identity")
		if offset > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
			req.Header.Set("If-Range", validator)
		}
		response, err = e.client.Do(req)
		if err == nil && ((offset == 0 && response.StatusCode == http.StatusOK) || (offset > 0 && (response.StatusCode == http.StatusPartialContent || response.StatusCode == http.StatusRequestedRangeNotSatisfiable))) {
			selectedSource = index
			break
		}
		if response != nil {
			response.Body.Close()
			response = nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	if response == nil {
		return errors.New("server did not accept the download or safe resume request")
	}
	defer response.Body.Close()
	if response.Request == nil || response.Request.URL == nil {
		return errors.New("download response has no effective URL")
	}
	effectiveSum := sha256.Sum256([]byte(response.Request.URL.String()))
	responseIdentity := hex.EncodeToString(effectiveSum[:])
	if offset > 0 && responseIdentity != effectiveURLSHA256 {
		return errors.New("download redirect target changed; partial file was preserved")
	}
	if response.Header.Get("Content-Encoding") != "" && !strings.EqualFold(response.Header.Get("Content-Encoding"), "identity") {
		return errors.New("server returned an encoded response that cannot be resumed safely")
	}
	// A Last-Modified timestamp has only one-second precision and may not be
	// a strong validator. Never join partial bytes without a strong ETag.
	v := strongNativeETag(response.Header.Get("ETag"))
	total := response.ContentLength
	if offset > 0 {
		if v != validator {
			return errors.New("server changed the download validator; partial file was preserved")
		}
		rawRange := response.Header.Get("Content-Range")
		if response.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			// A crash can occur after the last byte but before the checkpoint.
			// Only recover if the origin explicitly confirms the exact size
			// and the same strong validator; never append an error body.
			if rawRange != fmt.Sprintf("bytes */%d", offset) {
				return errors.New("server returned an invalid completed range")
			}
			total = offset
			_ = response.Body.Close()
			response.Body = io.NopCloser(strings.NewReader(""))
		} else {
			var first, last, size int64
			if _, err := fmt.Sscanf(rawRange, "bytes %d-%d/%d", &first, &last, &size); err != nil || rawRange != fmt.Sprintf("bytes %d-%d/%d", first, last, size) || first != offset || last < first || size <= last || (response.ContentLength >= 0 && response.ContentLength != last-first+1) {
				return errors.New("server returned an invalid resume range")
			}
			total = size
		}
	}
	e.mu.Lock()
	r.Validator = v
	r.SourceIndex = selectedSource
	r.EffectiveURLSHA256 = responseIdentity
	r.Job.TotalBytes = max(total, 0)
	r.Job.CompletedBytes = offset
	err = e.saveLocked()
	e.mu.Unlock()
	if err != nil {
		return errors.New("could not persist safe resume metadata")
	}
	buf := make([]byte, 64<<10)
	start := time.Now()
	written := offset
	for {
		n, readErr := response.Body.Read(buf)
		if n > 0 {
			if e.limiter != nil {
				if err := e.limiter.WaitN(ctx, n); err != nil {
					return err
				}
			}
			m, writeErr := f.Write(buf[:n])
			written += int64(m)
			e.mu.Lock()
			r.Job.CompletedBytes = written
			r.Job.Connections = 1
			if total > 0 {
				r.Job.ProgressPercent = float64(written) * 100 / float64(total)
			}
			if elapsed := time.Since(start).Seconds(); elapsed > 0 {
				r.Job.BytesPerSecond = int64(float64(written-offset) / elapsed)
			}
			e.mu.Unlock()
			if writeErr != nil || m != n {
				return errors.New("could not write partial download")
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				return errors.New("download interrupted; partial file was preserved")
			}
			break
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if total >= 0 && written != total {
		return errors.New("download length did not match the server response")
	}
	if err := f.Sync(); err != nil {
		return errors.New("could not sync downloaded data")
	}
	if err := f.Close(); err != nil {
		return errors.New("could not close downloaded data")
	}
	sum, err := hashNativeFile(ctx, part)
	if err != nil {
		return errors.New("could not verify partial download")
	}
	if request.SHA256 != "" {
		if sum != request.SHA256 {
			e.mu.Lock()
			r.Job.Verification = "failed"
			r.Job.VerifyMessage = "SHA-256 did not match."
			e.mu.Unlock()
			return errors.New("SHA-256 did not match; partial file was preserved")
		}
		e.mu.Lock()
		r.Job.Verification = "verified"
		r.Job.ActualSHA256 = request.SHA256
		r.Job.VerifiedBytes = written
		e.mu.Unlock()
	}
	// Promotion and the completion transition share the engine mutex with
	// Pause and Cancel, so a successful pause/cancel cannot race promotion.
	e.mu.Lock()
	defer e.mu.Unlock()
	current, _ := e.findLocked(r.Job.ID)
	if ctx.Err() != nil || current != r || r.Job.Status != JobDownloading {
		return context.Canceled
	}
	r.CommitSHA256 = sum
	if err := e.saveLocked(); err != nil {
		r.CommitSHA256 = ""
		return errors.New("could not persist the download promotion checkpoint")
	}
	if err := e.promote(part, r.Job.OutputPath); err != nil {
		r.CommitSHA256 = ""
		return errors.New("could not safely promote download; destination may already exist")
	}
	if err := e.syncDir(filepath.Dir(r.Job.OutputPath)); err != nil {
		// Keep the durable checkpoint for recovery; do not report completion.
		return errors.New("could not sync the download destination; restart to recover")
	}
	r.Job.Status = JobCompleted
	r.Job.ProgressPercent = 100
	r.Job.BytesPerSecond = 0
	r.Request.Headers = nil
	r.Request.Sources = []string{r.Job.Source}
	r.SourceIndex = 0
	r.EffectiveURLSHA256 = ""
	r.CommitSHA256 = ""
	if err := e.saveLocked(); err != nil {
		e.persistenceErr = err
	}
	return nil
}

// strongNativeETag accepts only bounded, syntactically valid strong entity
// tags. Weak or oversized tags cannot safely resume and are never persisted.
func strongNativeETag(value string) string {
	if len(value) < 2 || len(value) > 2048 || value[0] != '"' || value[len(value)-1] != '"' {
		return ""
	}
	for i := 1; i < len(value)-1; i++ {
		c := value[i]
		if c != 0x21 && (c < 0x23 || c == 0x7f) {
			return ""
		}
	}
	return value
}
