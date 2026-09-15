package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const maxPageBytes = 4 << 20

type MediaItem struct {
	URL  string `json:"url"`
	Kind string `json:"kind"`
}
type Preview struct {
	URL       string      `json:"url"`
	Title     string      `json:"title"`
	Items     []MediaItem `json:"items"`
	IsPage    bool        `json:"isPage"`
	Truncated bool        `json:"truncated"`
}

func validURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && len(raw) <= 8192 && u.Hostname() != "" && u.User == nil && (u.Scheme == "http" || u.Scheme == "https") && !strings.ContainsAny(raw, "\x00\r\n")
}

func mediaHTTP() *http.Client {
	return &http.Client{Timeout: 30 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 || !validURL(req.URL.String()) {
			return errors.New("invalid or excessive redirects")
		}
		return nil
	}}
}

func nativeGet(ctx context.Context, raw, referer string) (*http.Response, error) {
	if !validURL(raw) {
		return nil, errors.New("enter an HTTP or HTTPS URL without credentials")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ProtoPeek/1.0 (local media downloader)")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := mediaHTTP().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("source returned HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

// Inspect reads at most 4 MiB of HTML and never executes scripts. Direct files
// are identified from response headers without downloading their bodies.
func (s *Service) Inspect(ctx context.Context, raw string) (Preview, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	resp, err := nativeGet(ctx, raw, "")
	if err != nil {
		return Preview{}, err
	}
	defer resp.Body.Close()
	return inspectResponse(resp)
}

func inspectResponse(resp *http.Response) (Preview, error) {
	base := resp.Request.URL
	p := Preview{URL: base.String(), Title: path.Base(base.Path), Items: []MediaItem{}}
	contentType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if contentType != "text/html" && contentType != "application/xhtml+xml" {
		kind := "file"
		for _, candidate := range []string{"video", "audio", "image"} {
			if strings.HasPrefix(contentType, candidate+"/") {
				kind = candidate
			}
		}
		p.Items = append(p.Items, MediaItem{URL: p.URL, Kind: kind})
		return p, nil
	}
	p.IsPage = true
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxPageBytes+1))
	if err != nil {
		return p, err
	}
	if len(data) > maxPageBytes {
		return p, errors.New("page exceeds the 4 MiB inspection limit")
	}
	seen := map[string]bool{}
	add := func(raw, kind string) {
		u, err := base.Parse(strings.TrimSpace(raw))
		if err != nil || raw == "" {
			return
		}
		u.Fragment = ""
		if !validURL(u.String()) || seen[u.String()] {
			return
		}
		if len(p.Items) >= 100 {
			p.Truncated = true
			return
		}
		seen[u.String()] = true
		p.Items = append(p.Items, MediaItem{URL: u.String(), Kind: kind})
	}
	z := html.NewTokenizer(strings.NewReader(string(data)))
	inTitle := false
	for {
		t := z.Next()
		if t == html.ErrorToken {
			break
		}
		if t == html.TextToken && inTitle {
			p.Title = strings.TrimSpace(string(z.Text()))
			continue
		}
		if t == html.EndTagToken {
			if name, _ := z.TagName(); string(name) == "title" {
				inTitle = false
			}
			continue
		}
		if t != html.StartTagToken && t != html.SelfClosingTagToken {
			continue
		}
		token := z.Token()
		attrs := map[string]string{}
		for _, a := range token.Attr {
			attrs[a.Key] = a.Val
		}
		switch token.Data {
		case "title":
			inTitle = true
		case "base":
			if u, err := base.Parse(attrs["href"]); err == nil && validURL(u.String()) {
				base = u
			}
		case "img":
			add(attrs["src"], "image")
			add(attrs["data-src"], "image")
		case "video", "audio":
			add(attrs["src"], token.Data)
		case "source":
			kind := "video"
			if strings.HasPrefix(attrs["type"], "audio/") {
				kind = "audio"
			}
			add(attrs["src"], kind)
		case "meta":
			key := attrs["property"]
			if key == "" {
				key = attrs["name"]
			}
			if key == "og:title" {
				p.Title = attrs["content"]
			}
			for _, kind := range []string{"image", "video", "audio"} {
				if key == "og:"+kind || key == "og:"+kind+":url" || key == "og:"+kind+":secure_url" || key == "twitter:"+kind {
					add(attrs["content"], kind)
				}
			}
		case "a":
			u, err := base.Parse(attrs["href"])
			if err != nil {
				continue
			}
			ext := strings.ToLower(path.Ext(u.Path))
			kind := ""
			switch ext {
			case ".mp4", ".webm", ".mov":
				kind = "video"
			case ".mp3", ".m4a", ".ogg", ".wav", ".flac":
				kind = "audio"
			case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif":
				kind = "image"
			}
			if kind != "" {
				add(attrs["href"], kind)
			}
		}
	}
	if len(p.Title) > 500 {
		p.Title = p.Title[:500]
	}
	return p, nil
}

func (s *Service) nativeDownload(ctx context.Context, j Job) error {
	if j.Request.Format == "page" {
		// Raw HTML preserves source evidence. It is not presented as an offline,
		// browser-rendered ArchiveBox capture; linked resources remain external.
		if err := s.nativeFile(ctx, j, j.Request.URL, "", "page.html"); err != nil {
			return err
		}
		manifest, _ := json.MarshalIndent(map[string]any{"url": j.Request.URL, "savedAt": time.Now().UTC(), "format": "original response; linked assets are not bundled"}, "", "  ")
		return os.WriteFile(filepath.Join(j.Directory, "source.json"), manifest, 0600)
	}
	p, err := s.Inspect(ctx, j.Request.URL)
	if err != nil {
		return err
	}
	items := []MediaItem{}
	for _, item := range p.Items {
		if !p.IsPage || j.Request.Format == "auto" || (j.Request.Format == "images" && item.Kind == "image") || item.Kind == j.Request.Format {
			items = append(items, item)
		}
	}
	if j.Request.Start > len(items) {
		return errors.New("no matching downloadable media at this position; script-generated or protected sources may need an optional site engine")
	}
	end := min(j.Request.End, len(items))
	for i := j.Request.Start - 1; i < end; i++ {
		item := items[i]
		u, _ := url.Parse(item.URL)
		ext := strings.ToLower(path.Ext(u.Path))
		if len(ext) > 10 || strings.ContainsAny(ext, "% ?\\:") {
			ext = ""
		}
		if ext == "" {
			switch item.Kind {
			case "image":
				ext = ".img"
			case "video":
				ext = ".video"
			case "audio":
				ext = ".audio"
			default:
				ext = ".bin"
			}
		}
		if err := s.nativeFile(ctx, j, item.URL, p.URL, fmt.Sprintf("%03d%s", i+1, ext)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) nativeFile(ctx context.Context, j Job, raw, referer, name string) error {
	resp, err := nativeGet(ctx, raw, referer)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// A page that replaces a media URL (login, challenge, expiry) is not media.
	if name != "page.html" && strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
		return errors.New("media URL returned a webpage; the source may require authentication or a site-specific extractor")
	}
	dest := filepath.Join(j.Directory, name)
	if info, err := os.Stat(dest); err == nil && info.Mode().IsRegular() {
		return nil
	}
	f, err := os.OpenFile(dest+".part", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	started, last := time.Now(), time.Now()
	var downloaded int64
	buf := make([]byte, 128<<10)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err = f.Write(buf[:n]); err != nil {
				break
			}
			downloaded += int64(n)
			if time.Since(last) >= 250*time.Millisecond || readErr == io.EOF {
				s.mu.Lock()
				for _, job := range s.jobs {
					if job.ID == j.ID {
						job.Bytes = float64(downloaded)
						job.Total = float64(max(0, resp.ContentLength))
						job.Speed = float64(downloaded) / time.Since(started).Seconds()
						if job.Total > job.Bytes {
							job.ETA = (job.Total - job.Bytes) / job.Speed
						}
					}
				}
				s.mu.Unlock()
				last = time.Now()
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				err = readErr
			}
			break
		}
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = os.Rename(dest+".part", dest); err != nil {
		return err
	}
	s.mu.Lock()
	for _, job := range s.jobs {
		if job.ID == j.ID {
			job.Files++
			job.Bytes = float64(downloaded)
			job.Total = float64(max(0, resp.ContentLength))
		}
	}
	s.mu.Unlock()
	return nil
}
