import { useEffect } from 'react';

// Observe only active work in the visible Files workspace. This never starts,
// pauses or stops the host engine; browser lifetime does not own a download.
export function useTransferProgress(
  enabled: boolean,
  refresh: (signal?: AbortSignal) => Promise<void>
) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: AbortController | undefined;
    function schedule(delay = 1500) {
      if (disposed || document.visibilityState === 'hidden') return;
      timer = setTimeout(async () => {
        const controller = new AbortController();
        pending = controller;
        await refresh(controller.signal);
        if (pending === controller) pending = undefined;
        if (!controller.signal.aborted) schedule();
      }, delay);
    }
    function visibilityChanged() {
      clearTimeout(timer);
      pending?.abort();
      pending = undefined;
      schedule(0);
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [enabled, refresh]);
}
