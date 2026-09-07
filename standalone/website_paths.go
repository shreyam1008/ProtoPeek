package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// This is a small, fixed metadata plan. It never guesses administrative paths,
// reads documents, follows redirects, or treats a 200 response as proof of a file.
var websiteCheckPaths = [...]string{
	"/robots.txt", "/sitemap.xml", "/.well-known/security.txt", "/security.txt",
	"/.__protopeek_missing_resource__",
}

type websitePathEvidence struct {
	Path             string  `json:"path"`
	StatusCode       int     `json:"statusCode,omitempty"`
	ContentType      string  `json:"contentType,omitempty"`
	ContentLength    string  `json:"contentLength,omitempty"`
	RedirectLocation string  `json:"redirectLocation,omitempty"`
	TotalMS          float64 `json:"totalMs"`
	Error            string  `json:"error,omitempty"`
}

type websitePathResult struct {
	Origin     string                `json:"origin"`
	ObservedAt time.Time             `json:"observedAt"`
	Paths      []websitePathEvidence `json:"paths"`
	Partial    bool                  `json:"partial"`
}

// WebsitePathsOperationHandler runs behind the same POST/CSRF and admission
// boundary as a single website observation. The observer retains address policy.
func WebsitePathsOperationHandler(observer WebsiteObserver) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setWebsiteObservationHeaders(w)
		if observer == nil {
			http.Error(w, "Website observation is unavailable", http.StatusServiceUnavailable)
			return
		}
		var input WebsiteObservationRequest
		if !decodeStrictTransferJSON(w, r, maxWebsiteObservationBodyBytes, &input) {
			return
		}
		if !input.AcknowledgePublicRequest {
			http.Error(w, "acknowledgePublicRequest must be true for this five-request HEAD plan", 400)
			return
		}
		u, err := url.Parse(strings.TrimSpace(input.URL))
		if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || len(input.URL) > maxWebsiteObservationURLBytes {
			http.Error(w, "Enter an absolute HTTP(S) URL without credentials, query, or fragment", 400)
			return
		}
		u.Path, u.RawPath = "", ""
		origin := u.String()
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		result := websitePathResult{Origin: origin, Paths: make([]websitePathEvidence, len(websiteCheckPaths))}
		jobs := make(chan int, len(websiteCheckPaths))
		for i := range websiteCheckPaths {
			jobs <- i
		}
		close(jobs)
		var workers sync.WaitGroup
		for range 2 {
			workers.Go(func() {
				for i := range jobs {
					entry := websitePathEvidence{Path: websiteCheckPaths[i]}
					if ctx.Err() != nil {
						entry.Error = "Not completed before cancellation or deadline"
						result.Paths[i] = entry
						continue
					}
					observation, observeErr := observer.Observe(ctx, origin+entry.Path)
					if observeErr != nil {
						switch {
						case errors.Is(observeErr, context.DeadlineExceeded), errors.Is(observeErr, context.Canceled):
							entry.Error = "Request cancelled or timed out"
						default:
							entry.Error = "No HEAD response; DNS, connection, TLS, or address policy prevented observation"
							if failure := certificateFailure(observeErr); failure != nil {
								entry.Error = failure.Reason
							}
						}
					} else {
						entry.StatusCode = observation.HTTP.StatusCode
						entry.ContentType = http.Header(observation.HTTP.Headers).Get("Content-Type")
						entry.ContentLength = http.Header(observation.HTTP.Headers).Get("Content-Length")
						entry.RedirectLocation = observation.HTTP.RedirectLocation
						entry.TotalMS = observation.Timings.TotalMS
					}
					result.Paths[i] = entry
				}
			})
		}
		workers.Wait()
		result.ObservedAt = time.Now().UTC()
		for _, entry := range result.Paths {
			if entry.Error != "" {
				result.Partial = true
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(result)
	})
}
