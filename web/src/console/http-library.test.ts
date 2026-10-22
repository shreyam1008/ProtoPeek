import { afterEach, expect, it, vi } from 'vitest';
import { emptyHTTPDraft } from './http-draft-store';
import {
  deleteHTTPRecipe,
  exportHTTPLibrary,
  httpLibraryKey,
  importHTTPLibrary,
  previewHTTPLibraryImport,
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

it('exports and atomically restores template requests with merge conflicts previewed', () => {
  const first = saveHTTPRecipe('Template', {
    ...emptyHTTPDraft(),
    url: '{{base_url}}/health?q={{query}}',
    headers: [{ name: 'X-Secret', value: '{{credential}}' }],
    rememberBody: true,
    bodyMode: 'text',
    body: '{{query}}',
  })[0];
  const portable = exportHTTPLibrary();
  resetHTTPLibrary();
  saveHTTPRecipe('Kept', emptyHTTPDraft());
  const preview = previewHTTPLibraryImport(portable);
  expect(readHTTPLibrary().requests[0].name).toBe('Kept');
  expect(importHTTPLibrary(preview, 'merge')).toHaveLength(2);
  expect(readHTTPLibrary().requests.find((item) => item.id === first.id)?.draft).toMatchObject({
    url: '{{base_url}}/health?q={{query}}',
    headers: [{ value: '{{credential}}' }],
    body: '{{query}}',
  });
  const updated = JSON.parse(portable);
  updated.requests[0].name = 'Updated';
  const conflict = previewHTTPLibraryImport(JSON.stringify(updated));
  expect(conflict.conflicts).toBe(1);
  expect(importHTTPLibrary(conflict, 'merge')).toHaveLength(2);
  expect(readHTTPLibrary().requests[0].name).toBe('Updated');
  expect(importHTTPLibrary(previewHTTPLibraryImport(portable), 'replace')).toHaveLength(1);
});

it('rejects stale previews, malformed present fields and oversized imported bodies without replacing storage', () => {
  saveHTTPRecipe('Kept', emptyHTTPDraft());
  const portable = exportHTTPLibrary();
  const preview = previewHTTPLibraryImport(portable);
  saveHTTPRecipe('Newer', emptyHTTPDraft());
  const previous = localStorage.getItem(httpLibraryKey);
  expect(() => importHTTPLibrary(preview, 'replace')).toThrow(/changed after preview/);
  const invalid = JSON.parse(portable);
  invalid.requests[0].savedAt = 123;
  expect(() => previewHTTPLibraryImport(JSON.stringify(invalid))).toThrow(/invalid/);
  const large = JSON.parse(portable);
  large.requests[0].draft = JSON.stringify({
    ...JSON.parse(large.requests[0].draft),
    body: 'x'.repeat(65537),
    rememberBody: true,
  });
  expect(() => previewHTTPLibraryImport(JSON.stringify(large))).toThrow(/64 KiB/);
  expect(localStorage.getItem(httpLibraryKey)).toBe(previous);
});

it('re-sanitizes untrusted imported credentials and preserves good data on quota/merge-limit failure', () => {
  const portable = {
    version: 1,
    requests: [
      {
        id: 'imported',
        name: 'Imported',
        savedAt: new Date().toISOString(),
        draft: JSON.stringify({
          version: 1,
          ...emptyHTTPDraft(),
          url: 'https://user:sentinel@example.test/?token=sentinel',
          headers: [{ name: 'Authorization', value: 'Bearer sentinel' }],
        }),
      },
    ],
  };
  importHTTPLibrary(previewHTTPLibraryImport(JSON.stringify(portable)), 'merge');
  expect(localStorage.getItem(httpLibraryKey)).not.toContain('sentinel');
  for (let i = 0; i < 49; i++) saveHTTPRecipe(`Kept ${i}`, emptyHTTPDraft());
  portable.requests[0].id = 'another';
  const preview = previewHTTPLibraryImport(JSON.stringify(portable));
  const previous = localStorage.getItem(httpLibraryKey);
  expect(() => importHTTPLibrary(preview, 'merge')).toThrow(/invalid/);
  expect(localStorage.getItem(httpLibraryKey)).toBe(previous);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage full');
  });
  expect(() => importHTTPLibrary(preview, 'replace')).toThrow('Storage full');
  expect(localStorage.getItem(httpLibraryKey)).toBe(previous);
});
