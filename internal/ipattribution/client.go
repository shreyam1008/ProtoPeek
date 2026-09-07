// Package ipattribution adds explicitly requested third-party labels to numeric
// public addresses. It never probes those addresses or infers a physical route.
package ipattribution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

const Source = "https://ipwhois.io/documentation"
const MaxAddresses = 32

var ErrInvalid = errors.New("attribution requires one to 32 numeric IP addresses")

type Entry struct {
	IP           string    `json:"ip"`
	Status       string    `json:"status"`
	Country      string    `json:"country,omitempty"`
	Region       string    `json:"region,omitempty"`
	City         string    `json:"city,omitempty"`
	ASN          uint32    `json:"asn,omitempty"`
	Organization string    `json:"organization,omitempty"`
	ISP          string    `json:"isp,omitempty"`
	ObservedAt   time.Time `json:"observedAt"`
	Cached       bool      `json:"cached"`
	Note         string    `json:"note,omitempty"`
}

type Result struct {
	Source  string  `json:"source"`
	Entries []Entry `json:"entries"`
}

type Client struct {
	lookup func(context.Context, netip.Addr) (Entry, error)
	mu     sync.Mutex
	cache  map[netip.Addr]Entry
}

func New() (*Client, error) {
	guard, err := targetguard.New(targetguard.Config{Policy: targetguard.PublicOnly})
	if err != nil {
		return nil, err
	}
	return &Client{lookup: func(ctx context.Context, address netip.Addr) (Entry, error) {
		return queryProvider(ctx, guard, address)
	}, cache: make(map[netip.Addr]Entry)}, nil
}

// Enrich caps both input and parallel work, returns an outcome for each unique
// address, and keeps non-public addresses entirely on the ProtoPeek host.
func (client *Client) Enrich(parent context.Context, raw []string) (Result, error) {
	if len(raw) == 0 || len(raw) > MaxAddresses {
		return Result{}, ErrInvalid
	}
	addresses := make([]netip.Addr, 0, len(raw))
	seen := make(map[netip.Addr]bool)
	for _, value := range raw {
		address, err := netip.ParseAddr(value)
		if err != nil || address.Zone() != "" && !address.IsLinkLocalUnicast() {
			return Result{}, ErrInvalid
		}
		address = address.Unmap()
		if !seen[address] {
			seen[address] = true
			addresses = append(addresses, address)
		}
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	result := Result{Source: Source, Entries: make([]Entry, len(addresses))}
	jobs := make(chan int, len(addresses))
	for i := range addresses {
		jobs <- i
	}
	close(jobs)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			for i := range jobs {
				address := addresses[i]
				entry := Entry{IP: address.String(), Status: "skipped", ObservedAt: time.Now().UTC()}
				if class := targetguard.ClassifyAddress(address); class != targetguard.AddressPublic {
					entry.Note = string(class) + " address; not sent to the provider"
				} else if ctx.Err() != nil {
					entry.Status = "failed"
					entry.Note = "Not completed before cancellation or deadline"
				} else if cached, ok := client.cached(address); ok {
					entry = cached
				} else {
					observed, err := client.lookup(ctx, address)
					if err != nil {
						entry.Status = "failed"
						entry.Note = "Provider unavailable, timed out, or returned invalid evidence"
						if errors.Is(err, errRateLimited) {
							entry.Note = "Provider rate limit reached; try later"
						}
					} else {
						entry = observed
						entry.IP = address.String()
						entry.Status = "observed"
						entry.ObservedAt = time.Now().UTC()
						client.store(address, entry)
					}
				}
				result.Entries[i] = entry
			}
		})
	}
	workers.Wait()
	return result, nil
}

func (client *Client) cached(address netip.Addr) (Entry, bool) {
	client.mu.Lock()
	defer client.mu.Unlock()
	entry, ok := client.cache[address]
	if !ok || time.Since(entry.ObservedAt) >= 15*time.Minute {
		delete(client.cache, address)
		return Entry{}, false
	}
	entry.Cached = true
	return entry, true
}

func (client *Client) store(address netip.Addr, entry Entry) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.cache) >= 128 {
		var oldest netip.Addr
		var observed time.Time
		for key, value := range client.cache {
			if !oldest.IsValid() || value.ObservedAt.Before(observed) {
				oldest, observed = key, value.ObservedAt
			}
		}
		delete(client.cache, oldest)
	}
	client.cache[address] = entry
}

var errRateLimited = errors.New("provider rate limit")

func queryProvider(parent context.Context, guard *targetguard.Guard, address netip.Addr) (Entry, error) {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	endpoint := "https://ipwho.is/" + address.String() + "?fields=ip,success,country,region,city,connection.asn,connection.org,connection.isp"
	session, err := guard.NewSession(ctx, endpoint, targetguard.SessionConfig{Redirect: targetguard.RedirectPolicy{MaxRedirects: 0}})
	if err != nil {
		return Entry{}, err
	}
	defer session.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, session.InitialURL().String(), nil)
	if err != nil {
		return Entry{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ProtoPeek optional IP attribution")
	response, err := session.Client().Do(request)
	if err != nil {
		return Entry{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == 429 {
		return Entry{}, errRateLimited
	}
	if response.StatusCode != 200 || response.ContentLength > 64<<10 {
		return Entry{}, errors.New("provider response unavailable or oversized")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		return Entry{}, err
	}
	if len(data) > 64<<10 {
		return Entry{}, errors.New("provider response oversized")
	}
	return decodeProvider(data, address)
}

func decodeProvider(data []byte, address netip.Addr) (Entry, error) {
	var value struct {
		IP         string `json:"ip"`
		Success    bool   `json:"success"`
		Country    string `json:"country"`
		Region     string `json:"region"`
		City       string `json:"city"`
		Connection struct {
			ASN uint32 `json:"asn"`
			Org string `json:"org"`
			ISP string `json:"isp"`
		} `json:"connection"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return Entry{}, err
	}
	returned, err := netip.ParseAddr(value.IP)
	if err != nil || returned.Unmap() != address || !value.Success {
		return Entry{}, fmt.Errorf("provider response does not match address")
	}
	return Entry{Country: bounded(value.Country, 128), Region: bounded(value.Region, 128), City: bounded(value.City, 128), ASN: value.Connection.ASN, Organization: bounded(value.Connection.Org, 256), ISP: bounded(value.Connection.ISP, 256)}, nil
}

func bounded(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	if len(value) > limit {
		value = value[:limit]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}
