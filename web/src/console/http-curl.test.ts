import { describe, expect, it } from 'vitest';

import { buildCurlCommand, curlExportLimits } from './http-curl';

describe('buildCurlCommand', () => {
  it('quotes apostrophes and newlines while preserving Unicode and the active body', () => {
    const result = buildCurlCommand({
      method: 'POST',
      url: 'https://example.test/search?q=caf%C3%A9',
      headers: [
        { name: 'X-Owner', value: "O'Brien ☕" },
        { name: 'X-Empty', value: '' },
      ],
      authHeaderName: null,
      body: "line one\nO'Brien ☕",
      timeoutMs: 7_250,
      followRedirects: false,
    });

    expect(result).toEqual({
      ok: true,
      command:
        "curl \\\n  --request 'POST' \\\n  --url 'https://example.test/search?q=caf%C3%A9' \\\n  --header 'X-Owner: O'\\''Brien ☕' \\\n  --header 'X-Empty;' \\\n  --max-time '7.25' \\\n  --data-raw 'line one\nO'\\''Brien ☕'",
      omittedCredentialCount: 0,
      bodyCopiedVerbatim: true,
    });
  });

  it('empties sensitive query values and omits sensitive and explicit auth headers', () => {
    const result = buildCurlCommand({
      method: 'GET',
      url: 'https://example.test/items?tag=one&token=secret&tag=two&token=second&api_key=key-value',
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'X-API-Key', value: 'key-value' },
        { name: 'X-Project', value: 'auth-from-editor' },
      ],
      authHeaderName: 'X-Project',
      body: null,
      timeoutMs: 30_000,
      followRedirects: false,
    });

    expect(result).toEqual({
      ok: true,
      command:
        "curl \\\n  --request 'GET' \\\n  --url 'https://example.test/items?tag=one&token=&tag=two&token=&api_key=' \\\n  --header 'Accept: application/json' \\\n  --max-time '30'",
      omittedCredentialCount: 6,
      bodyCopiedVerbatim: false,
    });
    expect(result.ok && result.command).not.toContain('[redacted]');
    expect(result.ok && result.command).not.toContain('%5Bredacted%5D');
  });

  it('rejects redirect-enabled drafts because one portable cURL command cannot reproduce relay policy', () => {
    expect(
      buildCurlCommand({
        method: 'GET',
        url: 'https://example.test/',
        headers: [],
        authHeaderName: null,
        body: null,
        timeoutMs: 30_000,
        followRedirects: true,
      })
    ).toEqual({
      ok: false,
      error:
        "Turn off Follow redirects before copying cURL. One portable command cannot reproduce ProtoPeek's bounded redirect, method, header, and HTTPS downgrade policy.",
    });
  });

  it('includes credentials omitted before command construction in its review count', () => {
    expect(
      buildCurlCommand({
        method: 'GET',
        url: 'https://example.test/?token=',
        headers: [],
        authHeaderName: null,
        body: null,
        timeoutMs: 30_000,
        followRedirects: false,
        preOmittedCredentialCount: 2,
      })
    ).toMatchObject({ ok: true, omittedCredentialCount: 2 });
  });

  it('does not claim an already-empty sensitive query value was omitted', () => {
    const result = buildCurlCommand({
      method: 'GET',
      url: 'https://example.test/?token=&key=%5Bredacted%5D&tag=',
      headers: [],
      authHeaderName: null,
      body: null,
      timeoutMs: 30_000,
      followRedirects: false,
    });

    expect(result).toEqual({
      ok: true,
      command:
        "curl \\\n  --request 'GET' \\\n  --url 'https://example.test/?token=&key=&tag=' \\\n  --max-time '30'",
      omittedCredentialCount: 1,
      bodyCopiedVerbatim: false,
    });
  });

  it('rejects malformed and non-HTTP URLs without throwing', () => {
    const input = {
      method: 'GET',
      headers: [],
      authHeaderName: null,
      body: null,
      timeoutMs: 30_000,
      followRedirects: false,
    };

    for (const url of ['not a URL', 'ftp://example.test/archive']) {
      expect(buildCurlCommand({ ...input, url })).toEqual({
        ok: false,
        error: 'Enter an absolute http:// or https:// URL.',
      });
    }
  });

  it('applies the shared URL, header, and body relay boundary defensively', () => {
    const input = {
      method: 'POST',
      url: 'https://example.test/',
      headers: [],
      authHeaderName: null,
      body: null,
      timeoutMs: 30_000,
      followRedirects: false,
    };

    expect(buildCurlCommand({ ...input, url: 'https://user:secret@example.test/' })).toEqual({
      ok: false,
      error: 'Credentials are not allowed in URLs; use the Auth or Headers tab.',
    });
    expect(
      buildCurlCommand({
        ...input,
        headers: [{ name: 'X-Trace', value: 'safe\r\nX-Injected: yes' }],
      })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/invalid HTTP header/i) });
    expect(buildCurlCommand({ ...input, body: 'x'.repeat(1024 * 1024 + 1) })).toEqual({
      ok: false,
      error: 'HTTP request body exceeds 1 MiB.',
    });
  });

  it('rejects timeout values outside the HTTP workbench contract', () => {
    const input = {
      method: 'GET',
      url: 'https://example.test/',
      headers: [],
      authHeaderName: null,
      body: null,
      followRedirects: false,
    };

    for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, 99, 120_001]) {
      expect(buildCurlCommand({ ...input, timeoutMs })).toEqual({
        ok: false,
        error: 'Set the timeout between 0.1 and 120 seconds.',
      });
    }

    expect(buildCurlCommand({ ...input, timeoutMs: 100 }).ok).toBe(true);
    expect(buildCurlCommand({ ...input, timeoutMs: 120_000 }).ok).toBe(true);
  });

  it('allows exactly 64 inspected headers and rejects the 65th', () => {
    const input = {
      method: 'GET',
      url: 'https://example.test/',
      authHeaderName: null,
      body: null,
      timeoutMs: 30_000,
      followRedirects: false,
    };
    const headers = Array.from({ length: 64 }, (_, index) => ({
      name: `X-Trace-${index}`,
      value: String(index),
    }));

    expect(buildCurlCommand({ ...input, headers }).ok).toBe(true);
    expect(
      buildCurlCommand({
        ...input,
        headers: [...headers, { name: 'X-Trace-64', value: '64' }],
      })
    ).toEqual({
      ok: false,
      error: 'cURL export supports at most 64 request headers. Remove a header and try again.',
    });
  });

  it('allows exactly 512 KiB of UTF-8 command output and rejects one byte more', () => {
    const input = {
      method: 'POST',
      url: 'https://example.test/',
      headers: [],
      authHeaderName: null,
      timeoutMs: 30_000,
      followRedirects: false,
    };
    const empty = buildCurlCommand({ ...input, body: '' });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    const encoder = new TextEncoder();
    const fillerBytes = curlExportLimits.commandBytes - encoder.encode(empty.command).length;

    const exact = buildCurlCommand({ ...input, body: 'x'.repeat(fillerBytes) });
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(encoder.encode(exact.command)).toHaveLength(512 * 1024);

    expect(buildCurlCommand({ ...input, body: 'x'.repeat(fillerBytes + 1) })).toEqual({
      ok: false,
      error: 'cURL command exceeds 512 KiB. Shorten the URL, headers, or body and try again.',
    });
  });

  it('rejects NUL bytes that POSIX shell arguments cannot represent', () => {
    expect(
      buildCurlCommand({
        method: 'POST',
        url: 'https://example.test/',
        headers: [],
        authHeaderName: null,
        body: 'before\0after',
        timeoutMs: 30_000,
        followRedirects: false,
      })
    ).toEqual({
      ok: false,
      error:
        'cURL export cannot represent NUL bytes in POSIX shell arguments. Remove the NUL character and try again.',
    });
  });
});
