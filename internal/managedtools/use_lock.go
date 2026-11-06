package managedtools

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type sharedLease struct {
	file *os.File
	once sync.Once
	err  error
}

func (l *sharedLease) Release() error {
	l.once.Do(func() { l.err = errors.Join(unlockShared(l.file), l.file.Close()) })
	return l.err
}

func (m *Manager) shared(a asset) (transfer.Lock, error) {
	if err := m.dirs(true, a); err != nil {
		return nil, err
	}
	path := filepath.Join(m.root, "cloudflared", "operation.lock")
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return nil, ErrInvalid
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, ErrInvalid
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, ErrInvalid
	}
	if err = lockShared(f); err != nil {
		f.Close()
		if sharedBusy(err) {
			return nil, ErrBusy
		}
		return nil, ErrInvalid
	}
	return &sharedLease{file: f}, nil
}
