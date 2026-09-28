const key = 'protopeek.network.path-target.v1';
let pendingTarget = '';

// A one-use target draft never grants permission to send a trace.
export function preparePathTarget(input: string) {
  const target = normalizePathDestination(input);
  pendingTarget = target;
  try {
    sessionStorage.setItem(key, target);
    return true;
  } catch {
    // Same-tab navigation still carries the draft when storage is unavailable.
    return true;
  }
}

export function takePathTarget(): string {
  const fallback = pendingTarget;
  pendingTarget = '';
  try {
    const target = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return fallback || (target ? normalizePathDestination(target) : '');
  } catch {
    return fallback;
  }
}

export function normalizePathDestination(input: string): string {
  const value = input.trim();
  if (
    !value ||
    value.length > 8192 ||
    /\s/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error('Enter a hostname, IP address, or website URL.');
  }
  if (value.includes('://')) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Use an HTTP(S) website URL without credentials.');
    }
    return url.hostname.replace(/^\[|\]$/g, '');
  }
  if (value.includes('/') || value.includes('?') || value.includes('#') || value.includes('@')) {
    throw new Error('Enter a hostname or IP, or paste a complete HTTP(S) URL.');
  }
  const unbracketed = value.replace(/^\[|\]$/g, '');
  if (unbracketed.length > 253) throw new Error('The destination is too long.');
  return unbracketed;
}
