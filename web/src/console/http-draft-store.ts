import type { MetadataEntry } from '@/shared/types';
import {
  prepareMetadataForReplay,
  prepareURLForReplay,
  sanitizeHTTPHeadersForPersistence,
  sanitizeURLForPersistence,
} from '@/shared/utils';
import { normalizeHTTPDraftURL } from './http-request-draft';

export const httpDraftStorageKey = 'protopeek.httpDraft.v1';
const maxDraftSize = 256 * 1024;
export const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type HTTPDraft = {
  method: string;
  url: string;
  params: MetadataEntry[];
  headers: MetadataEntry[];
  bodyMode: 'none' | 'json' | 'text';
  body: string;
  rememberBody: boolean;
  timeoutSeconds: number;
  followRedirects: boolean;
};

export function emptyHTTPDraft(): HTTPDraft {
  return {
    method: 'GET',
    url: 'http://localhost:8080/',
    params: [],
    headers: [],
    bodyMode: 'none',
    body: '',
    rememberBody: false,
    timeoutSeconds: 30,
    followRedirects: false,
  };
}

function entries(value: unknown): value is MetadataEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        entry.name.length <= 1024 &&
        typeof entry.value === 'string' &&
        entry.value.length <= 8192
    )
  );
}

// Query parameter names use the same redaction rules as URLs, including names such as "code".
function safeParams(params: MetadataEntry[]) {
  return params.map(({ name, value }) => {
    const url = new URL('https://draft.invalid/');
    url.searchParams.set(name, value);
    return {
      name,
      value: new URL(sanitizeURLForPersistence(url.href)).searchParams.get(name) ?? '',
    };
  });
}

export function encodeHTTPDraft(draft: HTTPDraft): string | null {
  if (
    !entries(draft.params) ||
    !entries(draft.headers) ||
    draft.url.length > 8192 ||
    draft.body.length > maxDraftSize
  )
    return null;
  const normalizedURL = normalizeHTTPDraftURL(draft.url);
  const value = JSON.stringify({
    version: 1,
    method: draft.method,
    // Do not persist an unparseable authority: it can contain unfinished credentials.
    url: normalizedURL.ok ? sanitizeURLForPersistence(normalizedURL.url) : '',
    params: safeParams(draft.params),
    headers: sanitizeHTTPHeadersForPersistence(draft.headers),
    bodyMode: draft.bodyMode,
    body: draft.rememberBody ? draft.body : '',
    rememberBody: draft.rememberBody,
    timeoutSeconds: draft.timeoutSeconds,
    followRedirects: draft.followRedirects,
  });
  return new TextEncoder().encode(value).byteLength <= maxDraftSize ? value : null;
}

export function decodeHTTPDraft(raw: string): HTTPDraft | null {
  if (raw.length > maxDraftSize || new TextEncoder().encode(raw).byteLength > maxDraftSize)
    return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      value.version !== 1 ||
      !httpMethods.includes(value.method) ||
      typeof value.url !== 'string' ||
      value.url.length > 8192 ||
      !entries(value.params) ||
      !entries(value.headers) ||
      !['none', 'json', 'text'].includes(value.bodyMode) ||
      typeof value.body !== 'string' ||
      typeof value.rememberBody !== 'boolean' ||
      typeof value.followRedirects !== 'boolean' ||
      !Number.isFinite(value.timeoutSeconds) ||
      value.timeoutSeconds < 0.1 ||
      value.timeoutSeconds > 120
    )
      return null;
    const normalizedURL = normalizeHTTPDraftURL(value.url);
    return {
      method: value.method,
      url: normalizedURL.ok
        ? prepareURLForReplay(sanitizeURLForPersistence(normalizedURL.url)).url
        : '',
      params: prepareMetadataForReplay(safeParams(value.params)).metadata,
      headers: prepareMetadataForReplay(sanitizeHTTPHeadersForPersistence(value.headers)).metadata,
      bodyMode: value.bodyMode,
      body: value.rememberBody ? value.body : '',
      rememberBody: value.rememberBody,
      timeoutSeconds: value.timeoutSeconds,
      followRedirects: value.followRedirects,
    };
  } catch {
    return null;
  }
}

export function readHTTPDraft(): { draft: HTTPDraft; notice: string | null } {
  try {
    const raw = localStorage.getItem(httpDraftStorageKey);
    if (raw === null) return { draft: emptyHTTPDraft(), notice: null };
    const draft = decodeHTTPDraft(raw);
    return draft
      ? { draft, notice: 'Draft restored. Re-enter credentials before sending.' }
      : {
          draft: emptyHTTPDraft(),
          notice: 'The saved draft could not be read. A new request is ready.',
        };
  } catch {
    return {
      draft: emptyHTTPDraft(),
      notice: 'Browser storage is unavailable. This draft cannot be saved.',
    };
  }
}

export function writeHTTPDraft(draft: HTTPDraft): string | null {
  try {
    const encoded = encodeHTTPDraft(draft);
    if (encoded === null) {
      // Avoid restoring an older request after reporting that this one could not be saved.
      localStorage.removeItem(httpDraftStorageKey);
      return 'Draft exceeds the local save limit (256 KiB or 64 fields). Keep this editor open.';
    }
    localStorage.setItem(httpDraftStorageKey, encoded);
    return null;
  } catch {
    return 'Draft could not be saved. Browser storage is unavailable or full.';
  }
}
