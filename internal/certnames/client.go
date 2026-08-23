// Package certnames provides an explicit, bounded adapter for historical
// certificate-name candidates. It returns names only and never resolves,
// connects to, or probes any returned candidate.
package certnames

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
	"golang.org/x/net/publicsuffix"
)

const SourceEndpoint = "https://crt.name/v1/search"

const (
	defaultTimeout         = 8 * time.Second
	defaultCacheTTL        = 15 * time.Minute
	defaultMaxBodyBytes    = 256 << 10
	defaultMaxCandidates   = 256
	defaultMaxCacheEntries = 32
	defaultMaxConcurrent   = 2
	hardMaxBodyBytes       = 1 << 20
	hardMaxCandidates      = 1000
	hardMaxCacheEntries    = 128
	hardMaxConcurrent      = 4
)

var (
	ErrInvalidApex      = errors.New("invalid certificate-name apex")
	ErrResponseTooLarge = errors.New("certificate-name response is too large")
	ErrProviderBusy     = errors.New("certificate-name provider capacity is busy")
)

type Options struct {
	Timeout         time.Duration
	CacheTTL        time.Duration
	MaxBodyBytes    int64
	MaxCandidates   int
	MaxCacheEntries int
	MaxConcurrent   int
	Resolver        targetguard.Resolver
}

type Candidate struct {
	Name     string `json:"name"`
	Wildcard bool   `json:"wildcard"`
}

type Result struct {
	Apex       string      `json:"apex"`
	Source     string      `json:"source"`
	ObservedAt time.Time   `json:"observedAt"`
	Candidates []Candidate `json:"candidates"`
	Discarded  int         `json:"discarded"`
	Truncated  bool        `json:"truncated"`
	Cached     bool        `json:"cached"`
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type cacheEntry struct {
	result    Result
	expiresAt time.Time
}

// Client has no background work. Search is the only method that performs an
// upstream request, making third-party disclosure an explicit caller action.
type Client struct {
	doer            httpDoer
	timeout         time.Duration
	cacheTTL        time.Duration
	maxBodyBytes    int64
	maxCandidates   int
	maxCacheEntries int
	now             func() time.Time
	slots           chan struct{}
	cacheMu         sync.Mutex
	cache           map[string]cacheEntry
}

// NewClient constructs the fixed crt.name adapter without network I/O.
func NewClient(options Options) (*Client, error) {
	guard, err := targetguard.New(targetguard.Config{
		Policy:   targetguard.PublicOnly,
		Resolver: options.Resolver,
	})
	if err != nil {
		return nil, err
	}
	return newClient(options, &safeProviderDoer{guard: guard}, time.Now)
}

func newClient(options Options, doer httpDoer, now func() time.Time) (*Client, error) {
	if options.Timeout == 0 {
		options.Timeout = defaultTimeout
	}
	if options.CacheTTL == 0 {
		options.CacheTTL = defaultCacheTTL
	}
	if options.MaxBodyBytes == 0 {
		options.MaxBodyBytes = defaultMaxBodyBytes
	}
	if options.MaxCandidates == 0 {
		options.MaxCandidates = defaultMaxCandidates
	}
	if options.MaxCacheEntries == 0 {
		options.MaxCacheEntries = defaultMaxCacheEntries
	}
	if options.MaxConcurrent == 0 {
		options.MaxConcurrent = defaultMaxConcurrent
	}
	if options.Timeout < time.Millisecond || options.Timeout > 30*time.Second ||
		options.CacheTTL < time.Second || options.CacheTTL > 24*time.Hour ||
		options.MaxBodyBytes < 1 || options.MaxBodyBytes > hardMaxBodyBytes ||
		options.MaxCandidates < 1 || options.MaxCandidates > hardMaxCandidates ||
		options.MaxCacheEntries < 1 || options.MaxCacheEntries > hardMaxCacheEntries ||
		options.MaxConcurrent < 1 || options.MaxConcurrent > hardMaxConcurrent {
		return nil, fmt.Errorf("invalid certificate-name client bounds")
	}
	if doer == nil || now == nil {
		return nil, fmt.Errorf("certificate-name client dependencies are required")
	}
	return &Client{
		doer:            doer,
		timeout:         options.Timeout,
		cacheTTL:        options.CacheTTL,
		maxBodyBytes:    options.MaxBodyBytes,
		maxCandidates:   options.MaxCandidates,
		maxCacheEntries: options.MaxCacheEntries,
		now:             now,
		slots:           make(chan struct{}, options.MaxConcurrent),
		cache:           make(map[string]cacheEntry),
	}, nil
}

// NormalizeApex converts a host to its registrable IDNA ASCII apex. Broad
// public suffixes and IP literals are rejected.
func NormalizeApex(input string) (string, error) {
	hostname, err := targetguard.NormalizeHostname(input)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidApex, err)
	}
	if _, err := netip.ParseAddr(hostname); err == nil {
		return "", fmt.Errorf("%w: IP literals have no certificate-name apex", ErrInvalidApex)
	}
	apex, err := publicsuffix.EffectiveTLDPlusOne(hostname)
	if err != nil || apex == "" || !strings.Contains(apex, ".") {
		return "", fmt.Errorf("%w: hostname has no registrable apex", ErrInvalidApex)
	}
	return apex, nil
}

// Search explicitly sends the normalized apex to crt.name. Returned names are
// historical candidates only; this method performs no candidate DNS lookup or
// network probe.
func (client *Client) Search(parent context.Context, input string) (Result, error) {
	apex, err := NormalizeApex(input)
	if err != nil {
		return Result{}, err
	}
	now := client.now().UTC()
	if result, ok := client.cached(apex, now); ok {
		return result, nil
	}
	select {
	case client.slots <- struct{}{}:
		defer func() { <-client.slots }()
	default:
		return Result{}, ErrProviderBusy
	}

	ctx, cancel := context.WithTimeout(parent, client.timeout)
	defer cancel()
	endpoint, _ := url.Parse(SourceEndpoint)
	query := endpoint.Query()
	query.Set("apex", apex)
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Result{}, fmt.Errorf("create certificate-name request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ProtoPeek certificate-name lookup")
	response, err := client.doer.Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("query crt.name: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("crt.name returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > client.maxBodyBytes {
		return Result{}, ErrResponseTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, client.maxBodyBytes+1))
	if err != nil {
		return Result{}, fmt.Errorf("read crt.name response: %w", err)
	}
	if int64(len(body)) > client.maxBodyBytes {
		return Result{}, ErrResponseTooLarge
	}
	var records []struct {
		Sub string `json:"sub"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&records); err != nil {
		return Result{}, fmt.Errorf("decode crt.name response: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return Result{}, err
	}

	seen := make(map[string]struct{}, len(records))
	candidates := make([]Candidate, 0, min(len(records), client.maxCandidates))
	discarded := 0
	for _, record := range records {
		candidate, valid := normalizeCandidate(record.Sub, apex)
		if !valid {
			discarded++
			continue
		}
		if _, exists := seen[candidate.Name]; exists {
			continue
		}
		seen[candidate.Name] = struct{}{}
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(left, right int) bool {
		return candidates[left].Name < candidates[right].Name
	})
	truncated := len(candidates) > client.maxCandidates
	if truncated {
		candidates = candidates[:client.maxCandidates]
	}
	result := Result{
		Apex:       apex,
		Source:     endpoint.String(),
		ObservedAt: now,
		Candidates: candidates,
		Discarded:  discarded,
		Truncated:  truncated,
	}
	client.store(result)
	return cloneResult(result), nil
}

func normalizeCandidate(input, apex string) (Candidate, bool) {
	value := strings.TrimSpace(input)
	wildcard := strings.HasPrefix(value, "*.")
	if wildcard {
		value = strings.TrimPrefix(value, "*.")
	}
	if strings.Contains(value, "*") {
		return Candidate{}, false
	}
	hostname, err := targetguard.NormalizeHostname(value)
	if err != nil || hostname != apex && !strings.HasSuffix(hostname, "."+apex) {
		return Candidate{}, false
	}
	name := hostname
	if wildcard {
		name = "*." + hostname
	}
	return Candidate{Name: name, Wildcard: wildcard}, true
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return fmt.Errorf("decode crt.name response trailer: %w", err)
	}
	return fmt.Errorf("decode crt.name response: multiple JSON values")
}

func (client *Client) cached(apex string, now time.Time) (Result, bool) {
	client.cacheMu.Lock()
	defer client.cacheMu.Unlock()
	entry, exists := client.cache[apex]
	if !exists {
		return Result{}, false
	}
	if !now.Before(entry.expiresAt) {
		delete(client.cache, apex)
		return Result{}, false
	}
	result := cloneResult(entry.result)
	result.Cached = true
	return result, true
}

func (client *Client) store(result Result) {
	client.cacheMu.Lock()
	defer client.cacheMu.Unlock()
	if len(client.cache) >= client.maxCacheEntries {
		var oldestKey string
		var oldest time.Time
		for key, entry := range client.cache {
			if oldestKey == "" || entry.result.ObservedAt.Before(oldest) {
				oldestKey = key
				oldest = entry.result.ObservedAt
			}
		}
		delete(client.cache, oldestKey)
	}
	client.cache[result.Apex] = cacheEntry{result: cloneResult(result), expiresAt: result.ObservedAt.Add(client.cacheTTL)}
}

func cloneResult(result Result) Result {
	result.Candidates = append([]Candidate(nil), result.Candidates...)
	return result
}

type safeProviderDoer struct {
	guard *targetguard.Guard
}

func (doer *safeProviderDoer) Do(request *http.Request) (*http.Response, error) {
	session, err := doer.guard.NewSession(request.Context(), request.URL.String(), targetguard.SessionConfig{
		Redirect: targetguard.RedirectPolicy{MaxRedirects: 1},
	})
	if err != nil {
		return nil, err
	}
	clone := request.Clone(request.Context())
	clone.URL = session.InitialURL()
	response, err := session.Client().Do(clone)
	if err != nil {
		session.CloseIdleConnections()
		return nil, err
	}
	response.Body = &sessionBody{ReadCloser: response.Body, closeSession: session.CloseIdleConnections}
	return response, nil
}

type sessionBody struct {
	io.ReadCloser
	closeSession func()
}

func (body *sessionBody) Close() error {
	err := body.ReadCloser.Close()
	body.closeSession()
	return err
}
