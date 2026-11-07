package transfer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// ForgetPreserved removes a confirmed ledger entry only. The user's retained
// file is never inspected, moved, modified or deleted by this operation.
func (service *Service) ForgetPreserved(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(path) > maxDestinationLength+128 || containsControl(path) {
		return ErrPreservedInvalid
	}
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	service.mu.RLock()
	runtime, config := service.runtime, service.config
	service.mu.RUnlock()
	if runtime != nil && runtime.EngineName == "native" {
		engine, ok := runtime.Engine.(*nativeEngine)
		if !ok {
			return errors.New("built-in downloader is unavailable")
		}
		return engine.forgetPreserved(ctx, path)
	}
	if runtime == nil {
		if err := os.MkdirAll(service.paths.StateDirectory, 0o700); err != nil {
			return err
		}
		lease, err := service.locker.TryLock(service.paths.LockFile)
		if err != nil {
			return err
		}
		if lease == nil {
			return errors.New("transfer locker returned no lease")
		}
		defer lease.Release()
	}
	e := &nativeEngine{path: filepath.Join(service.paths.StateDirectory, "session.native.json"), config: config, state: nativeState{Version: 1}}
	// Do not recover unrelated checkpoints as a side effect of forgetting.
	if err := e.loadState(false); err != nil {
		return err
	}
	return e.forgetPreserved(ctx, path)
}
