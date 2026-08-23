import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchDomainCandidates,
  fetchWebsiteObservation,
  normalizeDomainCandidatesResult,
  normalizeDomainHost,
  normalizeWebsiteObservationResult,
  normalizeWebsiteURL,
  SecurityAPIError,
} from './security-api';

const validResult = {
  apex: 'example.com',
  source: 'https://crt.name/v1/search?apex=example.com',
  observedAt: '2026-08-23T09:00:00Z',
  candidates: [
    { name: 'www.example.com', wildcard: false },
    { name: '*.api.example.com', wildcard: true },
    { name: 'www.example.com', wildcard: false },
  ],
  discarded: 2,
  truncated: false,
  cached: false,
};

const validWebsiteResult = {
  observedAt: '2026-08-23T12:00:00Z',
  url: 'https://example.com/health',
  method: 'HEAD',
  dns: {
    hostname: 'example.com',
    pinnedAddresses: ['2001:db8::20', '203.0.113.20'],
    resolutionMs: 4.25,
  },
  http: {
    statusCode: 204,
    status: '204 No Content',
    protocol: 'HTTP/2.0',
    headers: {
      'Content-Security-Policy': ["default-src 'none'"],
      Server: ['example-edge'],
    },
    redirectLocation: '',
  },
  tls: {
    version: 'TLS 1.3',
    cipherSuite: 'TLS_AES_128_GCM_SHA256',
    negotiatedProtocol: 'h2',
    serverName: 'example.com',
    subject: 'CN=example.com',
    issuer: 'CN=Example CA',
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    dnsNames: ['example.com', 'www.example.com'],
    verifiedChains: 1,
  },
  timings: {
    connectMs: 8.2,
    tlsHandshakeMs: 12.4,
    firstByteMs: 24.7,
    totalMs: 25.1,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('security domain-candidate API', () => {
  it('normalizes IDNA hosts and rejects URLs, ports, IPs, and single-label names', () => {
    expect(normalizeDomainHost('  WWW.BÜCHER.example.  ')).toBe('www.xn--bcher-kva.example');

    for (const invalid of [
      'https://example.com',
      'example.com/path',
      'user@example.com',
      'example.com:443',
      '127.0.0.1',
      '[2001:db8::1]',
      'localhost',
    ]) {
      expect(() => normalizeDomainHost(invalid)).toThrow();
    }
  });

  it('normalizes complete website URLs without accepting credentials, fragments, or other schemes', () => {
    expect(normalizeWebsiteURL(' HTTPS://BÜCHER.example/a ')).toBe(
      'https://xn--bcher-kva.example/a'
    );
    for (const invalid of [
      'example.com',
      'ftp://example.com/file',
      'https://user:secret@example.com/',
      'https://example.com/?token=secret',
      'https://example.com/#client-only',
    ]) {
      expect(() => normalizeWebsiteURL(invalid)).toThrow();
    }
  });

  it('posts one normalized host with explicit acknowledgement and bounded normalized results', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=security-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(validResult)
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDomainCandidates(' WWW.Example.com. ');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(input)).pathname).toBe('/api/domain/candidates');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('x-protopeek-csrf-token')).toBe('security-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      host: 'www.example.com',
      acknowledgeThirdParty: true,
    });
    expect(result.candidates).toEqual([
      { name: '*.api.example.com', wildcard: true },
      { name: 'www.example.com', wildcard: false },
    ]);
    expect(result.observedAt).toBe('2026-08-23T09:00:00.000Z');
  });

  it('rejects malformed, inconsistent, or out-of-scope provider evidence', () => {
    expect(() =>
      normalizeDomainCandidatesResult({
        ...validResult,
        candidates: [{ name: '*.api.example.com', wildcard: false }],
      })
    ).toThrow('inconsistent wildcard');
    expect(() =>
      normalizeDomainCandidatesResult({
        ...validResult,
        candidates: [{ name: 'other.test', wildcard: false }],
      })
    ).toThrow('out-of-scope');
    expect(() =>
      normalizeDomainCandidatesResult({
        ...validResult,
        source: 'https://crt.name/v1/search?apex=other.test',
      })
    ).toThrow('unexpected source');
  });

  it('bounds provider error bodies and preserves the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(9_000), { status: 502 }))
    );

    const failure = await fetchDomainCandidates('example.com').catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(SecurityAPIError);
    expect((failure as SecurityAPIError).status).toBe(502);
    expect((failure as Error).message.endsWith('…')).toBe(true);
    expect((failure as Error).message.length).toBeLessThanOrEqual(8 * 1024 + 1);
  });

  it('forwards cancellation to the request without replacing the abort error', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = fetchDomainCandidates('example.com', controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });

  it('posts one explicit website observation and normalizes bounded evidence', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=website-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(validWebsiteResult)
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebsiteObservation(' HTTPS://EXAMPLE.com/health ');

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(input)).pathname).toBe('/api/security/web');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('x-protopeek-csrf-token')).toBe('website-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://example.com/health',
      acknowledgePublicRequest: true,
    });
    expect(result.method).toBe('HEAD');
    expect(result.dns.pinnedAddresses).toEqual(['2001:db8::20', '203.0.113.20']);
    expect(result.http.headers).toEqual(validWebsiteResult.http.headers);
    expect(result.tls?.verifiedChains).toBe(1);
  });

  it('rejects inconsistent or unbounded website evidence', () => {
    expect(() =>
      normalizeWebsiteObservationResult({
        ...validWebsiteResult,
        dns: { ...validWebsiteResult.dns, hostname: 'other.test' },
      })
    ).toThrow('inconsistent DNS');
    expect(() =>
      normalizeWebsiteObservationResult({
        ...validWebsiteResult,
        http: {
          ...validWebsiteResult.http,
          headers: { 'Set-Cookie': ['secret=not-retained'] },
        },
      })
    ).toThrow('malformed selected headers');
    expect(() =>
      normalizeWebsiteObservationResult({
        ...validWebsiteResult,
        dns: { ...validWebsiteResult.dns, pinnedAddresses: [':::'] },
      })
    ).toThrow('malformed pinned address');
  });
});
