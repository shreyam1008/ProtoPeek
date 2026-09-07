import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeHTTPDraft,
  emptyHTTPDraft,
  encodeHTTPDraft,
  httpDraftStorageKey,
  readHTTPDraft,
  writeHTTPDraft,
} from './http-draft-store';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('HTTP draft persistence', () => {
  it('restores a useful unsent request without retaining credentials or an unapproved body', () => {
    const draft = {
      ...emptyHTTPDraft(),
      method: 'POST',
      url: 'https://user:password@example.test/echo?token=secret&limit=5#secret',
      params: [
        { name: 'code', value: 'secret-code' },
        { name: 'page', value: '2' },
      ],
      headers: [
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Custom-Credential', value: 'private' },
      ],
      bodyMode: 'json' as const,
      body: '{"password":"body-secret"}',
    };
    const encoded = encodeHTTPDraft(draft);
    if (!encoded) throw new Error('Expected a saved draft');
    for (const secret of ['password', 'secret-code', 'Bearer secret', 'body-secret', 'private'])
      expect(encoded).not.toContain(secret);
    const restored = decodeHTTPDraft(encoded);
    if (!restored) throw new Error('Expected a restored draft');
    expect(restored.method).toBe('POST');
    expect(restored.url).toBe('https://example.test/echo?token=&limit=5');
    expect(restored.params).toEqual([
      { name: 'code', value: '' },
      { name: 'page', value: '2' },
    ]);
    expect(restored.headers[0].value).toBe('');
    expect(restored.headers[1].value).toBe('application/json');
    expect(restored.body).toBe('');
  });
  it('persists the body only with explicit opt-in and removes it when disabled', () => {
    const draft = {
      ...emptyHTTPDraft(),
      bodyMode: 'json' as const,
      body: '{"message":"hello"}',
      rememberBody: true,
    };
    expect(writeHTTPDraft(draft)).toBeNull();
    expect(readHTTPDraft().draft.body).toBe(draft.body);
    writeHTTPDraft({ ...draft, rememberBody: false });
    expect(readHTTPDraft().draft.body).toBe('');
  });
  it('rejects malformed, future, oversized and invalid stored inputs', () => {
    for (const raw of [
      'null',
      '{',
      'x'.repeat(270_000),
      '{"version":99}',
      JSON.stringify({ version: 1, ...emptyHTTPDraft(), params: [null] }),
      JSON.stringify({ version: 1, ...emptyHTTPDraft(), timeoutSeconds: -1 }),
    ])
      expect(decodeHTTPDraft(raw)).toBeNull();
    writeHTTPDraft(emptyHTTPDraft());
    expect(writeHTTPDraft({ ...emptyHTTPDraft(), body: 'x'.repeat(270_000) })).toContain('limit');
    expect(localStorage.getItem(httpDraftStorageKey)).toBeNull();
  });
  it('does not persist an incomplete authority and reports storage denial', () => {
    expect(encodeHTTPDraft({ ...emptyHTTPDraft(), url: 'https://user:password@' })).not.toContain(
      'password'
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(writeHTTPDraft(emptyHTTPDraft())).toContain('could not be saved');
  });
});
