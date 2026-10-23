package cli

import (
	"errors"
	"sync"

	"github.com/shreyam1008/ProtoPeek/internal/media"
)

// One owner is shared by every HTTP handler in this process. Construction and
// Close are quiet until an admitted local media request asks for the service.
type mediaServiceOwner struct {
	mu      sync.Mutex
	enabled bool
	closed  bool
	create  func() (*media.Service, error)
	service *media.Service
}

func (owner *mediaServiceOwner) Get() (*media.Service, error) {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.closed {
		return nil, errors.New("media downloader is shutting down")
	}
	if !owner.enabled {
		return nil, errors.New("media downloads are disabled for this host; use the safe local ProtoPeek launcher")
	}
	if owner.service == nil {
		service, err := owner.create()
		if err != nil {
			return nil, err // A later explicit request may retry a busy queue.
		}
		if service == nil {
			return nil, errors.New("media downloader could not be initialized")
		}
		owner.service = service
	}
	return owner.service, nil
}

func (owner *mediaServiceOwner) Close() {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.closed {
		return
	}
	owner.closed = true
	if owner.service != nil {
		owner.service.Close()
	}
}
