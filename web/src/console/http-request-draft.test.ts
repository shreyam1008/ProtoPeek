import { describe, expect, it } from 'vitest';

import { httpRequestDraftLimits, prepareHTTPRequestDraft } from './http-request-draft';

const baseDraft = {
  method: 'GET',
  url: 'https://example.test/',
  headers: [],
  body: null,
  timeoutMs: 30_000,
  followRedirects: false,
};

describe('prepareHTTPRequestDraft', () => {
  it('normalizes the same method, URL, header, fragment, and active-empty body sent to the relay', () => {
    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        method: ' post ',
        url: 'https://example.test/items?token=%5Bredacted%5D#not-sent',
        headers: [
          { name: ' X-Trace ', value: 'one' },
          { name: ' ', value: 'ignored' },
        ],
        body: '',
      })
    ).toEqual({
      ok: true,
      input: {
        method: 'POST',
        url: 'https://example.test/items?token=',
        headers: [{ name: 'X-Trace', value: 'one' }],
        body: '',
        timeoutMs: 30_000,
        followRedirects: false,
      },
      bodyActive: true,
      redactedQueryCount: 1,
    });
    expect(prepareHTTPRequestDraft(baseDraft)).toMatchObject({ ok: true, bodyActive: false });
  });

  it('accepts exact timeout boundaries and rejects invalid or out-of-range values', () => {
    expect(prepareHTTPRequestDraft({ ...baseDraft, timeoutMs: 100 }).ok).toBe(true);
    expect(prepareHTTPRequestDraft({ ...baseDraft, timeoutMs: 120_000 }).ok).toBe(true);
    for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, 99, 120_001, 100.5]) {
      expect(prepareHTTPRequestDraft({ ...baseDraft, timeoutMs })).toEqual({
        ok: false,
        error: 'Set the timeout between 0.1 and 120 seconds.',
      });
    }
  });

  it('enforces relay header count, name, value, and control-character boundaries', () => {
    const exactHeaders = Array.from({ length: httpRequestDraftLimits.headers }, (_, index) => ({
      name: `X-Trace-${index}`,
      value: String(index),
    }));
    expect(prepareHTTPRequestDraft({ ...baseDraft, headers: exactHeaders }).ok).toBe(true);
    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [...exactHeaders, { name: 'X-Overflow', value: 'yes' }],
      })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/at most 128 headers/i) });

    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [{ name: 'x'.repeat(httpRequestDraftLimits.headerNameBytes), value: '' }],
      }).ok
    ).toBe(true);
    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [{ name: 'x'.repeat(httpRequestDraftLimits.headerNameBytes + 1), value: '' }],
      })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/header name.*256 bytes/i) });

    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [{ name: 'X-Large', value: 'x'.repeat(httpRequestDraftLimits.headerValueBytes) }],
      }).ok
    ).toBe(true);
    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [
          { name: 'X-Large', value: 'x'.repeat(httpRequestDraftLimits.headerValueBytes + 1) },
        ],
      })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/header value.*16 KiB/i) });

    for (const header of [
      { name: 'Bad Header', value: 'x' },
      { name: 'X-Test', value: 'safe\r\nX-Injected: yes' },
      { name: 'X-Test', value: 'bad\u0001value' },
      { name: 'X-Test', value: 'bad\u007fvalue' },
    ]) {
      expect(prepareHTTPRequestDraft({ ...baseDraft, headers: [header] })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/invalid HTTP header/i),
      });
    }

    expect(
      prepareHTTPRequestDraft({
        ...baseDraft,
        headers: [{ name: ' Host ', value: ' example.test:8443 ' }],
      })
    ).toMatchObject({
      ok: true,
      input: { headers: [{ name: 'Host', value: 'example.test:8443' }] },
    });
    for (const value of ['', 'bad host', 'example.test/path', 'café.test']) {
      expect(prepareHTTPRequestDraft({ ...baseDraft, headers: [{ name: 'Host', value }] })).toEqual(
        { ok: false, error: 'Invalid HTTP Host header.' }
      );
    }
  });

  it('enforces the relay body byte boundary with UTF-8 bytes', () => {
    const exact = 'é'.repeat(httpRequestDraftLimits.bodyBytes / 2);
    expect(prepareHTTPRequestDraft({ ...baseDraft, body: exact }).ok).toBe(true);
    expect(prepareHTTPRequestDraft({ ...baseDraft, body: `${exact}x` })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/body exceeds 1 MiB/i),
    });
  });

  it('rejects request methods and URL credentials the relay cannot send', () => {
    expect(prepareHTTPRequestDraft({ ...baseDraft, method: 'GET\nDELETE' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/valid HTTP method/i),
    });
    expect(
      prepareHTTPRequestDraft({ ...baseDraft, url: 'https://user:secret@example.test/' })
    ).toEqual({
      ok: false,
      error: 'Credentials are not allowed in URLs; use the Auth or Headers tab.',
    });
  });
});
