export const appStorageKeys = {
  assertions: 'protopeek.assertions.v1',
  collections: 'protopeek.collections.v1',
  environments: 'protopeek.environments.v1',
  history: 'protopeek.history.v1',
  httpHistory: 'protopeek.httpHistory.v1',
  methodFilter: 'protopeek.methodFilter.v1',
  selectedMethod: 'protopeek.selectedMethod.v1',
  targets: 'protopeek.targets.v1',
  activeTargetId: 'protopeek.activeTargetId.v1',
  discoveries: 'protopeek.discoveries.v1',
  pendingGRPCTarget: 'protopeek.pendingGRPCTarget.v1',
  pendingHTTPURL: 'protopeek.pendingHTTPURL.v1',
} as const;

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function modifierKeyLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘' : 'Ctrl';
}

export function loadStoredValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export type StorageWriteResult = { ok: true } | { ok: false; error: string };

export function storageErrorMessage(error: unknown) {
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return message || 'Browser storage write failed.';
}

export function storeValue(key: string, value: unknown): StorageWriteResult {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Browser storage is unavailable.' };
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: storageErrorMessage(error) };
  }
}

export function storeValuesAtomically(entries: Array<[string, unknown]>): StorageWriteResult {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Browser storage is unavailable.' };
  }

  const previous = new Map<string, string | null>();
  try {
    for (const [key] of entries) previous.set(key, window.localStorage.getItem(key));
    for (const [key, value] of entries) window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    let rollbackFailed = false;
    for (const [key, value] of previous) {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        rollbackFailed = true;
      }
    }
    return {
      ok: false,
      error: `${storageErrorMessage(error)}${rollbackFailed ? ' Previous workspace values could not be fully restored.' : ''}`,
    };
  }
}

export function removeStoredValue(key: string) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Keep the live session usable when browser storage is unavailable.
  }
}

export function compactDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  try {
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return 'Unknown date';
  }
}

export function displayBuildVersion(version: string) {
  const value = version.trim();
  if (!value || value.includes('<no version set>')) return 'development';
  return value;
}
