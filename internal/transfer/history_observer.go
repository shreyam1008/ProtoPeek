package transfer

import (
	"context"
	"time"
)

func (service *Service) wakeHistoryObserver() {
	service.mu.RLock()
	runtime := service.runtime
	service.mu.RUnlock()
	if runtime == nil || !runtime.observeCompletions {
		return
	}
	select {
	case runtime.observationWake <- struct{}{}:
	default:
	}
}

// The host must preserve completions even after every browser closes. Observe
// the already-running local engine while jobs move; keep no timer for a paused
// or idle queue. New work and Resume wake it. This sends no Internet requests.
func (service *Service) observeCompletedHistory(runtime *Runtime) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	var tick <-chan time.Time = timer.C
	for {
		select {
		case <-runtime.Done:
			service.finishRuntime(runtime, false)
			return
		case <-runtime.observationWake:
			if tick == nil {
				timer.Reset(0)
				tick = timer.C
			}
		case <-tick:
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			snapshot, err := service.Snapshot(ctx)
			cancel()
			tick = nil
			moving := snapshot.Metrics.ActiveCount > 0 || snapshot.Metrics.QueuedCount > 0
			if moving || err != nil || snapshot.PersistenceWarning != "" {
				delay := 5 * time.Second
				if !moving {
					delay = 30 * time.Second
				}
				timer.Reset(delay)
				tick = timer.C
			}
		}
	}
}
