package cli

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/media"
	"github.com/shreyam1008/ProtoPeek/standalone"
)

func TestMediaOwnerIsQuietUntilUsedAndCloseDoesNotInitialize(t *testing.T) {
	root := filepath.Join(t.TempDir(), "unused-media")
	var calls atomic.Int32
	owner := &mediaServiceOwner{enabled: true, create: func() (*media.Service, error) {
		calls.Add(1)
		return media.NewAt(root)
	}}
	owner.Close()
	owner.Close()
	if _, err := owner.Get(); err == nil || !strings.Contains(err.Error(), "shutting down") {
		t.Fatalf("request after Close: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatal("shutdown initialized the media service")
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unused media created state: %v", err)
	}
}

func TestMediaOwnerDisabledNeverInitializes(t *testing.T) {
	owner := &mediaServiceOwner{create: func() (*media.Service, error) {
		t.Fatal("remote mode initialized a media queue")
		return nil, nil
	}}
	defer owner.Close()
	if service, err := owner.Get(); service != nil || err == nil || !strings.Contains(err.Error(), "disabled for this host") {
		t.Fatalf("disabled result: %v, %v", service, err)
	}
}

func TestMediaOwnerConcurrentFirstUseSharesQueueAndReleasesIt(t *testing.T) {
	root := t.TempDir()
	var calls atomic.Int32
	owner := &mediaServiceOwner{enabled: true, create: func() (*media.Service, error) {
		calls.Add(1)
		return media.NewAt(root)
	}}
	t.Cleanup(owner.Close)
	const requestCount = 16
	results := make(chan *media.Service, requestCount)
	errorsFound := make(chan error, requestCount)
	var requests sync.WaitGroup
	for range requestCount {
		requests.Go(func() {
			service, err := owner.Get()
			results <- service
			errorsFound <- err
		})
	}
	requests.Wait()
	close(results)
	close(errorsFound)
	var first *media.Service
	for service := range results {
		if first == nil {
			first = service
		}
		if service == nil || service != first {
			t.Fatal("concurrent requests received different queues")
		}
	}
	for err := range errorsFound {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("initialized %d times", calls.Load())
	}
	if other, err := media.NewAt(root); err == nil {
		other.Close()
		t.Fatal("queue lock was not owned")
	}
	owner.Close()
	other, err := media.NewAt(root)
	if err != nil {
		t.Fatalf("Close did not release the queue: %v", err)
	}
	other.Close()
}

func TestMediaOwnerRetriesInitializationAfterQueueBecomesAvailable(t *testing.T) {
	root := t.TempDir()
	busy, err := media.NewAt(root)
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	owner := &mediaServiceOwner{enabled: true, create: func() (*media.Service, error) { return media.NewAt(root) }}
	defer owner.Close()
	if service, err := owner.Get(); service != nil || err == nil || !strings.Contains(err.Error(), "media queue is in use") {
		t.Fatalf("busy queue result: %v, %v", service, err)
	}
	busy.Close()
	if service, err := owner.Get(); service == nil || err != nil {
		t.Fatalf("available queue did not recover: %v, %v", service, err)
	}
}

func TestMediaOwnerCloseWaitsForInitializationAndPreventsRestart(t *testing.T) {
	root := t.TempDir()
	started, release := make(chan struct{}), make(chan struct{})
	owner := &mediaServiceOwner{enabled: true, create: func() (*media.Service, error) {
		close(started)
		<-release
		return media.NewAt(root)
	}}
	initialized := make(chan error, 1)
	go func() { _, err := owner.Get(); initialized <- err }()
	<-started
	closed := make(chan struct{})
	go func() { owner.Close(); close(closed) }()
	close(release)
	if err := <-initialized; err != nil {
		t.Fatal(err)
	}
	<-closed
	if service, err := owner.Get(); service != nil || err == nil {
		t.Fatalf("closed owner restarted: %v, %v", service, err)
	}
	other, err := media.NewAt(root)
	if err != nil {
		t.Fatalf("initialization racing Close leaked its lock: %v", err)
	}
	other.Close()
}

func TestMediaFactoryRunsAfterConsoleHostAndOriginPolicy(t *testing.T) {
	var calls atomic.Int32
	owner := &mediaServiceOwner{enabled: true, create: func() (*media.Service, error) {
		calls.Add(1)
		return nil, errors.New("fixture media queue is in use")
	}}
	defer owner.Close()
	handler := localAccessHandler(standalone.Handler(nil, "", nil, nil,
		standalone.WithMediaServiceFactory(owner.Get)), false)
	for _, input := range []struct{ host, origin string }{
		{"untrusted.example", ""},
		{"127.0.0.1", "https://untrusted.example"},
	} {
		request := httptest.NewRequest(http.MethodGet, "http://"+input.host+"/api/media/snapshot", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set("Origin", input.origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || calls.Load() != 0 {
			t.Fatalf("untrusted request reached factory: %d, %d", response.Code, calls.Load())
		}
	}
}
