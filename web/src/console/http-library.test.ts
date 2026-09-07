import { afterEach, expect, it, vi } from 'vitest';
import { emptyHTTPDraft } from './http-draft-store';
import {
  deleteHTTPRecipe,
  exportHTTPLibrary,
  httpLibraryKey,
  readHTTPLibrary,
  resetHTTPLibrary,
  saveHTTPRecipe,
} from './http-library';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('persists named requests while removing credentials and excluding bodies by default', () => {
  const draft = {
    ...emptyHTTPDraft(),
    url: 'https://user:password@example.com/health?token=secret&format=json',
    headers: [
      { name: 'Authorization', value: 'Bearer header-secret' },
      { name: 'Accept', value: 'application/json' },
    ],
    bodyMode: 'json' as const,
    body: '{"private":"body-secret"}',
  };
  saveHTTPRecipe('Health', draft);
  const encoded = localStorage.getItem(httpLibraryKey) ?? '';
  for (const secret of ['password', 'header-secret', 'body-secret', 'token=secret'])
    expect(encoded).not.toContain(secret);
  const loaded = readHTTPLibrary();
  expect(loaded.error).toBe('');
  expect(loaded.requests[0].draft.url).toBe('https://example.com/health?token=&format=json');
  expect(loaded.requests[0].draft.body).toBe('');
  expect(loaded.requests[0].draft.headers.find((item) => item.name === 'Accept')?.value).toBe(
    'application/json'
  );
});

it('updates one identity, restores explicitly included bodies, exports and deletes', () => {
  const first = saveHTTPRecipe('Initial', emptyHTTPDraft())[0];
  saveHTTPRecipe(
    'Renamed',
    {
      ...emptyHTTPDraft(),
      method: 'POST',
      bodyMode: 'json',
      body: '{"name":"fixture"}',
      rememberBody: true,
    },
    first.id
  );
  const loaded = readHTTPLibrary().requests;
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({
    id: first.id,
    name: 'Renamed',
    draft: { method: 'POST', body: '{"name":"fixture"}' },
  });
  expect(exportHTTPLibrary()).toContain('Renamed');
  expect(deleteHTTPRecipe(first.id)).toEqual([]);
  expect(readHTTPLibrary().requests).toEqual([]);
  expect(() => saveHTTPRecipe('Stale', emptyHTTPDraft(), first.id)).toThrow(
    /removed in another tab/
  );
});

it('enforces collection and body bounds without replacing good storage', () => {
  for (let i = 0; i < 50; i++) saveHTTPRecipe(`Request ${i}`, emptyHTTPDraft());
  const previous = localStorage.getItem(httpLibraryKey);
  expect(() => saveHTTPRecipe('Overflow', emptyHTTPDraft())).toThrow(/full/);
  expect(localStorage.getItem(httpLibraryKey)).toBe(previous);
  expect(() =>
    saveHTTPRecipe('Large', { ...emptyHTTPDraft(), rememberBody: true, body: 'x'.repeat(65537) })
  ).toThrow(/64 KiB/);
  expect(() => saveHTTPRecipe('Bad', { ...emptyHTTPDraft(), url: 'javascript:bad' })).toThrow(
    /URL/
  );
});

it('preserves the last good library when storage is unavailable', () => {
  saveHTTPRecipe('Kept', emptyHTTPDraft());
  const previous = localStorage.getItem(httpLibraryKey);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage full');
  });
  expect(() => saveHTTPRecipe('Rejected', emptyHTTPDraft())).toThrow('Storage full');
  expect(localStorage.getItem(httpLibraryKey)).toBe(previous);
});

it('does not overwrite a corrupt library until it is explicitly reset', () => {
  localStorage.setItem(httpLibraryKey, 'broken');
  expect(readHTTPLibrary().error).not.toBe('');
  expect(() => saveHTTPRecipe('New', emptyHTTPDraft())).toThrow(/Reset/);
  expect(localStorage.getItem(httpLibraryKey)).toBe('broken');
  resetHTTPLibrary();
  expect(saveHTTPRecipe('New', emptyHTTPDraft())).toHaveLength(1);
});
