package media

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/shreyam1008/ProtoPeek/internal/transfer"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Request struct {
	URL       string `json:"url"`
	Engine    string `json:"engine"`
	Format    string `json:"format"`
	Directory string `json:"directory"`
	Start     int    `json:"start"`
	End       int    `json:"end"`
}

type Job struct {
	ID        string    `json:"id"`
	Request   Request   `json:"request"`
	Status    string    `json:"status"`
	Message   string    `json:"message"`
	Directory string    `json:"directory"`
	Bytes     float64   `json:"bytes"`
	Total     float64   `json:"total"`
	Speed     float64   `json:"speed"`
	ETA       float64   `json:"eta"`
	Files     int       `json:"files"`
	Created   time.Time `json:"created"`
}

type Snapshot struct {
	Tools     []Tool `json:"tools"`
	Jobs      []Job  `json:"jobs"`
	Directory string `json:"directory"`
}

type Service struct {
	lease     transfer.Lock
	mu        sync.Mutex
	installMu sync.Mutex
	root      string
	jobs      []*Job
	cancels   map[string]context.CancelFunc
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	wake      chan struct{}
}

func New() (*Service, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return NewAt(filepath.Join(root, "protopeek", "media"))
}

func NewAt(root string) (*Service, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	lease, err := (transfer.FileLocker{}).TryLock(filepath.Join(root, "queue.lock"))
	if err != nil {
		return nil, fmt.Errorf("media queue is in use: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{lease: lease, root: root, ctx: ctx, cancel: cancel, cancels: make(map[string]context.CancelFunc), wake: make(chan struct{}, 1)}
	// History is deliberately bounded. Interrupted work requires explicit retry.
	if f, err := os.Open(filepath.Join(root, "jobs.json")); err == nil {
		defer f.Close()
		if info, err := f.Stat(); err == nil && info.Size() <= 2<<20 {
			_ = json.NewDecoder(f).Decode(&s.jobs)
		}
	}
	validJobs := s.jobs[:0]
	for _, j := range s.jobs {
		if j != nil {
			validJobs = append(validJobs, j)
		}
	}
	s.jobs = validJobs
	if len(s.jobs) > 128 {
		s.jobs = s.jobs[len(s.jobs)-128:]
	}
	for _, j := range s.jobs {
		if j != nil && (j.Status == "queued" || j.Status == "downloading" || j.Status == "processing" || j.Status == "cancelling") {
			j.Status, j.Message = "cancelled", "Interrupted when ProtoPeek stopped. Retry to restart unfinished work."
		}
	}
	s.wg.Add(2)
	for range 2 {
		go s.worker()
	}
	return s, nil
}

func (s *Service) Close() { s.cancel(); s.wg.Wait(); _ = s.lease.Release() }

func (s *Service) Snapshot() Snapshot {
	home, _ := os.UserHomeDir()
	result := Snapshot{Jobs: []Job{}, Directory: filepath.Join(home, "Downloads")}
	for _, name := range []string{"native-go", "yt-dlp", "gallery-dl", "archivebox", "ffmpeg", "deno", "node"} {
		result.Tools = append(result.Tools, s.tool(name))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.jobs) - 1; i >= 0; i-- {
		if s.jobs[i] != nil {
			result.Jobs = append(result.Jobs, *s.jobs[i])
		}
	}
	return result
}

func validateRequest(r *Request) error {
	r.URL = strings.TrimSpace(r.URL)
	u, err := url.Parse(r.URL)
	if err != nil || len(r.URL) > 8192 || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || strings.ContainsAny(r.URL, "\r\n\x00") {
		return errors.New("enter one HTTP or HTTPS URL without embedded credentials")
	}
	if r.Engine != "native-go" && r.Engine != "yt-dlp" && r.Engine != "gallery-dl" && r.Engine != "archivebox" {
		return errors.New("select a supported download engine")
	}
	if r.Format != "video" && r.Format != "720" && r.Format != "audio" && r.Format != "auto" && r.Format != "images" && r.Format != "page" {
		return errors.New("unknown media format")
	}
	if r.Start < 1 || r.End < r.Start || r.End-r.Start >= 100 || r.End > 10000 {
		return errors.New("select a range of 1–100 items, between positions 1 and 10000")
	}
	if !filepath.IsAbs(r.Directory) || strings.ContainsRune(r.Directory, 0) {
		return errors.New("choose an absolute destination directory")
	}
	info, err := os.Stat(r.Directory)
	if err != nil || !info.IsDir() {
		return errors.New("destination directory does not exist")
	}
	return nil
}

func (s *Service) Add(r Request) (Job, error) {
	if err := validateRequest(&r); err != nil {
		return Job{}, err
	}
	if s.tool(r.Engine).Path == "" {
		return Job{}, fmt.Errorf("install %s first", r.Engine)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return Job{}, errors.New("downloader is shutting down")
	}
	if len(s.jobs) >= 128 {
		return Job{}, errors.New("queue history is full; clear finished jobs first")
	}
	var id [12]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Job{}, err
	}
	j := &Job{ID: hex.EncodeToString(id[:]), Request: r, Status: "queued", Created: time.Now().UTC()}
	j.Directory = filepath.Join(r.Directory, "ProtoPeek-"+j.ID)
	s.jobs = append(s.jobs, j)
	if err := s.saveLocked(); err != nil {
		s.jobs = s.jobs[:len(s.jobs)-1]
		return Job{}, err
	}
	s.signal()
	return *j, nil
}

func (s *Service) Action(id, action string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, j := range s.jobs {
		if j == nil || j.ID != id {
			continue
		}
		switch action {
		case "cancel":
			if j.Status != "queued" && j.Status != "downloading" && j.Status != "processing" {
				return errors.New("job is already stopped")
			}
			if cancel := s.cancels[id]; cancel != nil {
				cancel()
			}
			j.Status, j.Message = "cancelled", "Cancelled; partial files are kept for retry."
			if s.cancels[id] != nil {
				j.Status = "cancelling"
			}
		case "retry":
			if _, running := s.cancels[id]; running {
				return errors.New("wait for the previous process to stop")
			}
			if j.Status != "failed" && j.Status != "cancelled" {
				return errors.New("only stopped jobs can be retried")
			}
			j.Status, j.Message, j.Speed, j.ETA = "queued", "", 0, 0
			s.signal()
		case "forget":
			if _, running := s.cancels[id]; running || j.Status == "queued" {
				return errors.New("stop the job before removing history")
			}
			s.jobs = append(s.jobs[:i], s.jobs[i+1:]...)
		default:
			return errors.New("unknown action")
		}
		return s.saveLocked()
	}
	return errors.New("job not found")
}

func (s *Service) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Service) saveLocked() error {
	f, err := os.CreateTemp(s.root, ".jobs-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	err = json.NewEncoder(f).Encode(s.jobs)
	if e := f.Close(); err == nil {
		err = e
	}
	if err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(s.root, "jobs.json"))
}

func (s *Service) worker() {
	defer s.wg.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-s.wake:
		}
		for s.ctx.Err() == nil {
			s.mu.Lock()
			var job *Job
			for _, j := range s.jobs {
				if j != nil && j.Status == "queued" {
					job = j
					break
				}
			}
			if job == nil {
				s.mu.Unlock()
				break
			}
			ctx, cancel := context.WithTimeout(s.ctx, 12*time.Hour)
			s.cancels[job.ID] = cancel
			job.Status = "downloading"
			copyJob := *job
			s.mu.Unlock()
			s.signal()
			err := s.download(ctx, copyJob)
			s.mu.Lock()
			delete(s.cancels, job.ID)
			if ctx.Err() != nil {
				job.Status, job.Message = "cancelled", "Stopped; partial files are kept for retry."
			} else if err != nil {
				job.Status, job.Message = "failed", err.Error()
			} else {
				job.Status, job.Message = "completed", "Saved to the destination folder."
				if job.Request.Engine == "archivebox" {
					job.Message = "ArchiveBox finished. Open index.html in the destination folder to inspect which formats succeeded."
				}
			}
			job.Speed, job.ETA = 0, 0
			if err := s.saveLocked(); err != nil {
				job.Message += " History could not be saved: " + err.Error()
			}
			s.mu.Unlock()
			cancel()
		}
	}
}

func (s *Service) args(j Job) []string {
	r := j.Request
	if r.Engine == "gallery-dl" {
		return []string{"--config-ignore", "--no-input", "--no-postprocessors", "--no-colors", "--windows-filenames", "--retries", "3", "--http-timeout", "20", "--range", fmt.Sprintf("%d-%d", r.Start, r.End), "--directory", j.Directory, "--", r.URL}
	}
	args := []string{"--ignore-config", "--no-plugin-dirs", "--no-remote-components", "--no-js-runtimes", "--newline", "--no-colors", "--no-overwrites", "--windows-filenames", "--trim-filenames", "180", "--socket-timeout", "20", "--retries", "3", "--fragment-retries", "3", "--concurrent-fragments", "4", "--playlist-start", strconv.Itoa(r.Start), "--playlist-end", strconv.Itoa(r.End), "--progress", "--progress-delta", "0.5", "--progress-template", "download:PP_PROGRESS:%(progress)j", "--print", "after_move:PP_FILE:%(filepath)j", "--paths", j.Directory, "--output", "%(title).120B [%(id)s].%(ext)s"}
	for _, runtime := range []string{"deno", "node"} {
		if p := s.tool(runtime).Path; p != "" {
			args = append(args, "--js-runtimes", runtime+":"+p)
			break
		}
	}
	format := "best[acodec!=none][vcodec!=none]"
	if ffmpeg := s.tool("ffmpeg").Path; ffmpeg != "" {
		args = append(args, "--ffmpeg-location", filepath.Dir(ffmpeg))
		format = "bestvideo+bestaudio/best"
		if r.Format == "720" {
			format = "bestvideo[height<=720]+bestaudio/best[height<=720]"
		}
	} else if r.Format == "720" {
		format += "[height<=720]"
	}
	if r.Format == "audio" {
		format = "bestaudio"
	}
	return append(args, "--format", format, "--", r.URL)
}

func (s *Service) download(ctx context.Context, j Job) error {
	if err := os.MkdirAll(j.Directory, 0700); err != nil {
		return err
	}
	if j.Request.Engine == "native-go" {
		return s.nativeDownload(ctx, j)
	}
	if j.Request.Engine == "archivebox" {
		return s.archive(ctx, j)
	}
	cmd := exec.CommandContext(ctx, s.tool(j.Request.Engine).Path, s.args(j)...)
	configureProcess(cmd)
	cmd.Dir = j.Directory
	cmd.WaitDelay = 3 * time.Second
	var logs tailBuffer
	cmd.Stderr = &logs
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 8192), 512<<10)
	for scanner.Scan() {
		s.progress(j.ID, scanner.Text())
	}
	if scanner.Err() != nil {
		_ = cmd.Cancel()
	}
	err = cmd.Wait()
	if err != nil {
		return fmt.Errorf("%s: %s", j.Request.Engine, strings.TrimSpace(logs.String()+" "+err.Error()))
	}
	if scanner.Err() != nil {
		return scanner.Err()
	}
	// A successful extractor exit may still mean no matching media was found.
	count := 0
	_ = filepath.WalkDir(j.Directory, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && d.Type().IsRegular() && !strings.HasSuffix(p, ".part") && !strings.HasSuffix(p, ".ytdl") {
			count++
		}
		if count > 10000 {
			return filepath.SkipAll
		}
		return nil
	})
	s.mu.Lock()
	for _, job := range s.jobs {
		if job.ID == j.ID {
			job.Files = count
		}
	}
	s.mu.Unlock()
	if count == 0 {
		return errors.New("the engine finished without saving any media; check the URL and selected item range")
	}
	return nil
}

func (s *Service) progress(id, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j == nil || j.ID != id || j.Status == "cancelled" || j.Status == "cancelling" {
			continue
		}
		if strings.HasPrefix(line, "PP_FILE:") {
			j.Files++
			j.Bytes, j.Total = 0, 0
			return
		}
		if !strings.HasPrefix(line, "PP_PROGRESS:") {
			return
		}
		var p struct {
			Status   string  `json:"status"`
			Bytes    float64 `json:"downloaded_bytes"`
			Total    float64 `json:"total_bytes"`
			Estimate float64 `json:"total_bytes_estimate"`
			Speed    float64 `json:"speed"`
			ETA      float64 `json:"eta"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "PP_PROGRESS:")), &p) != nil {
			return
		}
		j.Bytes, j.Total, j.Speed, j.ETA = p.Bytes, p.Total, p.Speed, p.ETA
		if j.Total == 0 {
			j.Total = p.Estimate
		}
		j.Status = "downloading"
		if p.Status == "finished" {
			j.Status = "processing"
		}
		return
	}
}

type tailBuffer struct{ data []byte }

func (b *tailBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if n >= 4096 {
		b.data = append(b.data[:0], p[n-4096:]...)
	} else {
		b.data = append(b.data, p...)
		if len(b.data) > 4096 {
			b.data = b.data[len(b.data)-4096:]
		}
	}
	return n, nil
}
func (b *tailBuffer) String() string { return string(b.data) }
