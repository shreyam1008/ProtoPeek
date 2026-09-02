package cloudflared

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	latestReleaseAPI = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest"
	ReleasesURL      = "https://github.com/cloudflare/cloudflared/releases"
	DownloadsURL     = "https://developers.cloudflare.com/tunnel/downloads/"
	ServiceDocsURL   = "https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/"
	maxReleaseBytes  = 256 << 10
	releaseTimeout   = 20 * time.Second
)

type githubLatestRelease struct {
	TagName     string    `json:"tag_name"`
	PublishedAt time.Time `json:"published_at"`
	HTMLURL     string    `json:"html_url"`
}

func safeReleaseClient(client *http.Client) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	copy := *client
	copy.Timeout = releaseTimeout
	copy.Jar = nil
	copy.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 3 || request.URL.Scheme != "https" || !strings.EqualFold(request.URL.Hostname(), "api.github.com") || request.URL.User != nil {
			return http.ErrUseLastResponse
		}
		return nil
	}
	return &copy
}

// LatestRelease performs one explicit unauthenticated request to the fixed
// cloudflared GitHub endpoint. It never sends Cloudflare or GitHub credentials.
func (inspector *Inspector) LatestRelease(ctx context.Context, installed ToolObservation) (ReleaseObservation, error) {
	now := time.Now
	client := safeReleaseClient(http.DefaultClient)
	if inspector != nil {
		if inspector.now != nil {
			now = inspector.now
		}
		if inspector.releaseClient != nil {
			client = inspector.releaseClient
		}
	}
	result := ReleaseObservation{
		CheckedAt:     now().UTC(),
		Status:        "unknown",
		SupportStatus: "unknown",
		DownloadsURL:  DownloadsURL,
		ReleaseURL:    ReleasesURL + "/latest",
	}
	installedVersion, installedParts, installedOK := parseCloudflaredVersion(installed.Version)
	if installed.Found {
		result.InstalledVersion = installedVersion
	} else {
		result.Status = "not-installed"
		result.SupportStatus = "not-installed"
	}

	requestCtx, cancel := context.WithTimeout(ctx, releaseTimeout)
	defer cancel()
	request, err := newLatestReleaseRequest(requestCtx)
	if err != nil {
		return result, err
	}
	response, err := client.Do(request)
	if err != nil {
		if requestCtx.Err() != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			result.Note = "The latest cloudflared release check timed out after 20 seconds."
			return result, nil
		}
		result.Note = "The latest cloudflared release could not be checked."
		return result, nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		result.Note = fmt.Sprintf("GitHub's release endpoint returned HTTP %d.", response.StatusCode)
		return result, nil
	}
	if response.ContentLength > maxReleaseBytes {
		result.Note = "GitHub's release response exceeded ProtoPeek's 256 KiB safety limit."
		return result, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxReleaseBytes+1))
	if err != nil {
		result.Note = "GitHub's release response could not be read."
		return result, nil
	}
	if len(body) > maxReleaseBytes {
		result.Note = "GitHub's release response exceeded ProtoPeek's 256 KiB safety limit."
		return result, nil
	}
	var release githubLatestRelease
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&release); err != nil {
		result.Note = "GitHub's release response was not valid JSON."
		return result, nil
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		result.Note = "GitHub's release response contained multiple JSON values."
		return result, nil
	}
	latestVersion, latestParts, latestOK := parseCloudflaredVersion(release.TagName)
	if !latestOK {
		result.Note = "The latest GitHub tag was not a recognized cloudflared version."
		return result, nil
	}
	result.LatestVersion = latestVersion
	result.PublishedAt = release.PublishedAt.UTC()
	if safeGitHubReleaseURL(release.HTMLURL) {
		result.ReleaseURL = release.HTMLURL
	}
	if !installed.Found {
		result.Note = "cloudflared is not installed; use an official download or package-manager command."
		return result, nil
	}
	if !installedOK {
		result.Note = "The installed cloudflared version could not be parsed, so freshness and support are unknown."
		return result, nil
	}
	result.Status = cloudflaredFreshnessStatus(installedParts, latestParts)
	result.SupportStatus = cloudflaredSupportStatus(installedParts, latestParts)
	if result.SupportStatus == "unknown" {
		result.Note = "Freshness was compared, but support is unknown because the versions are not valid calendar-style cloudflared releases."
	} else if result.SupportStatus == "out-of-support" {
		result.Note = "The installed release is more than one calendar year behind the latest release."
	}
	return result, nil
}

func newLatestReleaseRequest(ctx context.Context) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseAPI, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "ProtoPeek-cloudflared-release-check")
	return request, nil
}

func parseCloudflaredVersion(value string) (string, []int, bool) {
	value = firstLine(value)
	fields := strings.Fields(value)
	candidate := ""
	for _, field := range fields {
		field = strings.Trim(strings.TrimSpace(field), "vV,;()[]")
		if parts, ok := numericVersionParts(field); ok {
			candidate = field
			return candidate, parts, true
		}
	}
	return "", nil, false
}

func numericVersionParts(value string) ([]int, bool) {
	segments := strings.Split(value, ".")
	if len(segments) < 2 || len(segments) > 4 {
		return nil, false
	}
	parts := make([]int, len(segments))
	for index, segment := range segments {
		if segment == "" {
			return nil, false
		}
		number, err := strconv.Atoi(segment)
		if err != nil || number < 0 {
			return nil, false
		}
		parts[index] = number
	}
	return parts, true
}

func compareVersionParts(left, right []int) int {
	length := len(left)
	if len(right) > length {
		length = len(right)
	}
	for index := 0; index < length; index++ {
		leftValue, rightValue := 0, 0
		if index < len(left) {
			leftValue = left[index]
		}
		if index < len(right) {
			rightValue = right[index]
		}
		if leftValue < rightValue {
			return -1
		}
		if leftValue > rightValue {
			return 1
		}
	}
	return 0
}

func cloudflaredFreshnessStatus(installed, latest []int) string {
	switch compareVersionParts(installed, latest) {
	case -1:
		return "update-available"
	case 0:
		return "current"
	case 1:
		return "newer"
	default:
		return "unknown"
	}
}

func cloudflaredSupportStatus(installed, latest []int) string {
	installedDate, installedOK := calendarVersionDate(installed)
	latestDate, latestOK := calendarVersionDate(latest)
	if !installedOK || !latestOK {
		return "unknown"
	}
	if installedDate.Before(latestDate.AddDate(-1, 0, 0)) {
		return "out-of-support"
	}
	return "supported"
}

func calendarVersionDate(parts []int) (time.Time, bool) {
	if len(parts) < 2 || parts[0] < 2000 || parts[0] > 9999 || parts[1] < 1 || parts[1] > 12 {
		return time.Time{}, false
	}
	return time.Date(parts[0], time.Month(parts[1]), 1, 0, 0, 0, 0, time.UTC), true
}

func safeGitHubReleaseURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "github.com") || parsed.User != nil || parsed.RawQuery != "" {
		return false
	}
	return strings.HasPrefix(parsed.EscapedPath(), "/cloudflare/cloudflared/releases/")
}
