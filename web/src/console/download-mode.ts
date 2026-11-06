import { useSyncExternalStore } from 'react';

type DownloadMode = 'files' | 'media';
let mode: DownloadMode = 'files';
const listeners = new Set<() => void>();

export function publishDownloadMode(next: DownloadMode) {
  if (mode === next) return;
  mode = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDownloadMode() {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => 'files'
  );
}
