package certnames

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type doerFunc func(*http.Request) (*http.Response, error)

func (function doerFunc) Do(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestSearchUsesFixedEndpointAndNormalizesScopedCandidates(t *testing.T) {
	var requested string
	doer := doerFunc(func(request *http.Request) (*http.Response, error) {
		requested = request.URL.String()
		return jsonResponse(`[
            {"sub":"Example.COM"},
            {"sub":"www.EXAMPLE.com"},
            {"sub":"*.Api.Example.com"},
            {"sub":"evil.example.net"},
            {"sub":"bad_name.example.com"},
            {"sub":"www.example.com"}
        ]`), nil
	})
	client := mustClient(t, Options{}, doer)

	result, err := client.Search(context.Background(), "WWW.Example.com")
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if requested != SourceEndpoint+"?apex=example.com" {
		t.Fatalf("requested URL = %q", requested)
	}
	want := []Candidate{
		{Name: "*.api.example.com", Wildcard: true},
		{Name: "example.com"},
		{Name: "www.example.com"},
	}
	if len(result.Candidates) != len(want) {
		t.Fatalf("Candidates = %#v, want %#v", result.Candidates, want)
	}
	for index := range want {
		if result.Candidates[index] != want[index] {
			t.Fatalf("Candidates[%d] = %#v, want %#v", index, result.Candidates[index], want[index])
		}
	}
	if result.Discarded != 2 {
		t.Fatalf("Discarded = %d, want 2", result.Discarded)
	}
	if result.Cached || result.Truncated {
		t.Fatalf("unexpected result flags: %#v", result)
	}
}

func TestSearchCacheAvoidsRepeatedDisclosure(t *testing.T) {
	var calls atomic.Int32
	doer := doerFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return jsonResponse(`[{"sub":"example.com"}]`), nil
	})
	client := mustClient(t, Options{}, doer)

	first, err := client.Search(context.Background(), "example.com")
	if err != nil {
		t.Fatalf("first Search() error = %v", err)
	}
	second, err := client.Search(context.Background(), "example.com")
	if err != nil {
		t.Fatalf("second Search() error = %v", err)
	}
	if first.Cached || !second.Cached || calls.Load() != 1 {
		t.Fatalf("cache flags/calls = %v/%v/%d", first.Cached, second.Cached, calls.Load())
	}
}

func TestSearchBoundsCandidatesAndBody(t *testing.T) {
	doer := doerFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(`[
            {"sub":"a.example.com"},
            {"sub":"b.example.com"},
            {"sub":"c.example.com"}
        ]`), nil
	})
	client := mustClient(t, Options{MaxCandidates: 2}, doer)
	result, err := client.Search(context.Background(), "example.com")
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(result.Candidates) != 2 || !result.Truncated {
		t.Fatalf("bounded result = %#v", result)
	}

	largeDoer := doerFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(`[{"sub":"` + strings.Repeat("a", 200) + `.example.com"}]`), nil
	})
	largeClient := mustClient(t, Options{MaxBodyBytes: 32}, largeDoer)
	_, err = largeClient.Search(context.Background(), "example.com")
	if !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("large Search() error = %v, want ErrResponseTooLarge", err)
	}
}

func TestSearchTimeoutCancelsProvider(t *testing.T) {
	doer := doerFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	client := mustClient(t, Options{Timeout: 5 * time.Millisecond}, doer)
	_, err := client.Search(context.Background(), "example.com")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Search() error = %v, want deadline exceeded", err)
	}
}

func TestNormalizeApexRejectsIPAndPublicSuffix(t *testing.T) {
	for _, input := range []string{"127.0.0.1", "co.uk", "localhost"} {
		if _, err := NormalizeApex(input); !errors.Is(err, ErrInvalidApex) {
			t.Fatalf("NormalizeApex(%q) error = %v", input, err)
		}
	}
	if apex, err := NormalizeApex("shop.bücher.example"); err != nil || apex != "xn--bcher-kva.example" {
		t.Fatalf("NormalizeApex(IDNA) = %q, %v", apex, err)
	}
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode:    http.StatusOK,
		Header:        make(http.Header),
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: -1,
	}
}

func mustClient(t *testing.T, options Options, doer httpDoer) *Client {
	t.Helper()
	client, err := newClient(options, doer, time.Now)
	if err != nil {
		t.Fatalf("newClient() error = %v", err)
	}
	return client
}
