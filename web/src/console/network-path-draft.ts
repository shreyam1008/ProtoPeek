import {
  type ConsumedHandoffFor,
  consumePendingHandoff,
  createHandoffEnvelope,
  storePendingHandoff,
} from './app/handoff-store';
import type { HandoffProvenance } from './app/handoff-types';

const key = 'protopeek.network.path-target.v1';
let legacyRead = false;

// A one-use target draft never grants permission to send a trace.
export function preparePathTarget(input: string, provenance?: HandoffProvenance) {
  const target = normalizePathDestination(input);
  const result = storePendingHandoff({
    provenance: provenance ?? {
      source: 'path-target',
      quality: 'manual',
      observedAt: new Date().toISOString(),
    },
    draft: { kind: 'path-target-draft', target: { kind: 'next-hop-target', target } },
  });
  if (result.ok) retireLegacyPath();
  return result.ok;
}

export function takePathTarget(): string {
  return takePathHandoff()?.draft.target.target ?? '';
}

export function takePathHandoff(): ConsumedHandoffFor<'path-target-draft'> | null {
  const pending = consumePendingHandoff('path-target-draft');
  if (pending) {
    retireLegacyPath();
    return pending;
  }
  if (legacyRead) return null;
  legacyRead = true;
  try {
    const target = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!target || target.length > 253) return null;
    const created = createHandoffEnvelope({
      provenance: {
        source: 'legacy-path-handoff',
        quality: 'manual',
        observedAt: new Date().toISOString(),
      },
      draft: {
        kind: 'path-target-draft',
        target: { kind: 'next-hop-target', target: normalizePathDestination(target) },
      },
    });
    return created.ok
      ? {
          ...created.value,
          draft: created.value.draft as ConsumedHandoffFor<'path-target-draft'>['draft'],
          storage: 'session',
        }
      : null;
  } catch {
    return null;
  }
}

function retireLegacyPath() {
  legacyRead = true;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* A superseded legacy key never regains authority. */
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
