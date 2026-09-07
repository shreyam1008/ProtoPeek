import { decodeHTTPDraft, encodeHTTPDraft, type HTTPDraft } from './http-draft-store';
import { normalizeHTTPDraftURL } from './http-request-draft';

export const httpLibraryKey = 'protopeek.httpLibrary.v1';
const maxBytes = 512 * 1024;
export type HTTPRecipe = { id: string; name: string; savedAt: string; draft: HTTPDraft };
type StoredRecipe = Omit<HTTPRecipe, 'draft'> & { draft: string };

function parse(raw: string): HTTPRecipe[] {
  if (raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes)
    throw new Error('Saved request library exceeds 512 KiB.');
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !Array.isArray(value.requests) || value.requests.length > 50)
    throw new Error('Saved request library is invalid.');
  const ids = new Set<string>();
  return value.requests.map((item: StoredRecipe) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 80 ||
      typeof item.savedAt !== 'string' ||
      item.savedAt.length > 40 ||
      !Number.isFinite(Date.parse(item.savedAt)) ||
      typeof item.draft !== 'string'
    )
      throw new Error('Saved request record is invalid.');
    ids.add(item.id);
    const draft = decodeHTTPDraft(item.draft);
    if (!draft) throw new Error('A saved request cannot be read.');
    return { id: item.id, name: item.name, savedAt: item.savedAt, draft };
  });
}

export function readHTTPLibrary(): { requests: HTTPRecipe[]; error: string } {
  try {
    const raw = localStorage.getItem(httpLibraryKey);
    return { requests: raw === null ? [] : parse(raw), error: '' };
  } catch (cause) {
    return {
      requests: [],
      error: cause instanceof Error ? cause.message : 'Saved request storage is unavailable.',
    };
  }
}

function encode(requests: HTTPRecipe[]) {
  const raw = JSON.stringify({
    version: 1,
    requests: requests.map((item) => ({ ...item, draft: encodeHTTPDraft(item.draft) })),
  });
  parse(raw); // Validate before replacing the last good stored library.
  return raw;
}

export function saveHTTPRecipe(name: string, draft: HTTPDraft, replaceID?: string): HTTPRecipe[] {
  name = name.trim();
  if (!name || name.length > 80) throw new Error('Give this request a name up to 80 characters.');
  if (!normalizeHTTPDraftURL(draft.url).ok)
    throw new Error('Enter a valid HTTP(S) URL before saving.');
  if (draft.rememberBody && new TextEncoder().encode(draft.body).length > 64 * 1024)
    throw new Error('Saved request bodies are limited to 64 KiB.');
  const loaded = readHTTPLibrary();
  if (loaded.error)
    throw new Error(`${loaded.error} Reset the library in this panel before saving.`);
  const encoded = encodeHTTPDraft(draft);
  const clean = encoded && decodeHTTPDraft(encoded);
  if (!clean) throw new Error('This request exceeds the saved request limits.');
  const index = replaceID ? loaded.requests.findIndex((item) => item.id === replaceID) : -1;
  if (replaceID && index < 0)
    throw new Error('This saved request was removed in another tab. Save a new copy.');
  if (!replaceID && loaded.requests.length >= 50)
    throw new Error(
      'The library is full (50 requests). Remove a request or update an existing one.'
    );
  const recipe: HTTPRecipe = {
    id: replaceID || crypto.randomUUID(),
    name,
    savedAt: new Date().toISOString(),
    draft: clean,
  };
  const requests = replaceID
    ? loaded.requests.map((item) => (item.id === replaceID ? recipe : item))
    : [recipe, ...loaded.requests];
  localStorage.setItem(httpLibraryKey, encode(requests));
  return requests;
}

export function deleteHTTPRecipe(id: string): HTTPRecipe[] {
  const loaded = readHTTPLibrary();
  if (loaded.error) throw new Error(loaded.error);
  const requests = loaded.requests.filter((item) => item.id !== id);
  localStorage.setItem(httpLibraryKey, encode(requests));
  return requests;
}

export function exportHTTPLibrary(): string {
  const loaded = readHTTPLibrary();
  if (loaded.error) throw new Error(loaded.error);
  return encode(loaded.requests);
}

export function resetHTTPLibrary() {
  localStorage.removeItem(httpLibraryKey);
}
