import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appStorageKeys } from '../../shared/runtime';
import {
  clearPendingHandoff,
  consumeLegacyHandoff,
  consumePendingHandoff,
  createHandoffEnvelope,
  handoffClockSkewMilliseconds,
  handoffLimits,
  maximumHandoffTTLMilliseconds,
  normalizeHandoffEnvelope,
  peekPendingHandoff,
  storePendingHandoff,
} from './handoff-store';
import type { HandoffDraft, PendingHandoffInput } from './handoff-types';

const now = Date.parse('2026-09-03T12:00:00.000Z');

function input(draft: HandoffDraft): PendingHandoffInput {
  return {
    provenance: {
      source: 'Network.Route',
      quality: 'observed',
      observedAt: new Date(now - 5_000).toISOString(),
      path: '/network/route',
      evidenceIds: ['trace-1', 'trace-1', 'hop-2'],
    },
    draft,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  clearPendingHandoff();
  window.localStorage.clear();
});

afterEach(() => {
  clearPendingHandoff();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('handoff envelope', () => {
  it.each([
    {
      name: 'HTTP URL',
      draft: {
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: ' HTTPS://Example.COM:443/api?q=one ' },
      },
      expected: {
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'https://example.com/api?q=one' },
      },
    },
    {
      name: 'gRPC target',
      draft: {
        kind: 'grpc-target-draft',
        target: { kind: 'grpc-target', address: ' DNS:///Example.COM:50051 ', plaintext: false },
      },
      expected: {
        kind: 'grpc-target-draft',
        target: { kind: 'grpc-target', address: 'dns:///example.com:50051', plaintext: false },
      },
    },
    {
      name: 'next-hop target',
      draft: {
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: ' Shreyam1008.COM.NP. ' },
      },
      expected: {
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: 'shreyam1008.com.np' },
      },
    },
    {
      name: 'publish origin',
      draft: {
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: ' 0.0.0.0 ', wildcard: true },
          exposure: 'all-interfaces',
          protocol: 'http',
          host: ' LOCALHOST. ',
          port: 8_080,
        },
      },
      expected: {
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '0.0.0.0', wildcard: true },
          exposure: 'all-interfaces',
          protocol: 'http',
          host: 'localhost',
          port: 8_080,
        },
      },
    },
  ] as const)('normalizes a bounded $name draft', ({ draft, expected }) => {
    const result = createHandoffEnvelope(input(draft), { now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft).toEqual(expected);
    expect(result.value.provenance).toEqual({
      source: 'network.route',
      quality: 'observed',
      observedAt: '2026-09-03T11:59:55.000Z',
      path: '/network/route',
      evidenceIds: ['trace-1', 'hop-2'],
    });
  });

  it('generates bounded identity and timestamps when they are omitted', () => {
    const result = createHandoffEnvelope(
      {
        provenance: {
          source: 'this-device',
          quality: 'inferred',
          observedAt: new Date(now - 5_000).toISOString(),
        },
        draft: {
          kind: 'publish-origin-draft',
          origin: {
            kind: 'local-service',
            perspective: 'process-network-namespace',
            network: 'tcp',
            bind: { address: '127.0.0.1', wildcard: false },
            exposure: 'loopback-only',
            protocol: 'https',
            host: '127.0.0.1',
            port: 4_443,
          },
        },
      },
      { now, ttlMilliseconds: 90_000 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toMatch(/^handoff-[a-z0-9-]+$/i);
    expect(result.value.createdAt).toBe('2026-09-03T12:00:00.000Z');
    expect(result.value.expiresAt).toBe('2026-09-03T12:01:30.000Z');
  });

  it('accepts a scoped IPv6 gRPC endpoint as a non-URL transport target', () => {
    const result = createHandoffEnvelope(
      input({
        kind: 'grpc-target-draft',
        target: {
          kind: 'grpc-target',
          address: '[fe80::1234%12]:50051',
          plaintext: true,
        },
      }),
      { now }
    );

    expect(result).toMatchObject({
      ok: true,
      value: { draft: { target: { address: '[fe80::1234%12]:50051' } } },
    });
  });

  it.each([
    {
      name: 'an unknown draft kind',
      value: {
        ...input({
          kind: 'next-hop-target-draft',
          target: { kind: 'next-hop-target', target: 'example.com' },
        }),
        draft: { kind: 'shell-command-draft', rawCommand: 'curl example.com' },
      },
    },
    {
      name: 'a secret-bearing extra field',
      value: {
        ...input({
          kind: 'http-url-draft',
          target: { kind: 'http-url', url: 'https://example.com' },
        }),
        secret: 'do-not-carry-this',
      },
    },
    {
      name: 'URL credentials',
      value: input({
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'https://user:password@example.com' },
      }),
    },
    {
      name: 'an oversized URL',
      value: input({
        kind: 'http-url-draft',
        target: {
          kind: 'http-url',
          url: `https://example.com/${'a'.repeat(handoffLimits.httpURLLength)}`,
        },
      }),
    },
    {
      name: 'too many evidence IDs',
      value: {
        ...input({
          kind: 'next-hop-target-draft',
          target: { kind: 'next-hop-target', target: 'example.com' },
        }),
        provenance: {
          source: 'network-route',
          quality: 'observed',
          observedAt: new Date(now - 5_000).toISOString(),
          evidenceIds: Array.from(
            { length: handoffLimits.evidenceIds + 1 },
            (_, index) => `hop-${index}`
          ),
        },
      },
    },
    {
      name: 'a non-canonical timestamp',
      value: {
        ...input({
          kind: 'next-hop-target-draft',
          target: { kind: 'next-hop-target', target: 'example.com' },
        }),
        provenance: {
          source: 'network-route',
          quality: 'observed',
          observedAt: '2026-09-03T12:00:00Z',
        },
      },
    },
    {
      name: 'a local filesystem provenance path',
      value: {
        ...input({
          kind: 'next-hop-target-draft',
          target: { kind: 'next-hop-target', target: 'example.com' },
        }),
        provenance: {
          source: 'network-route',
          quality: 'observed',
          observedAt: new Date(now - 5_000).toISOString(),
          path: '/C:\\Users\\operator\\token',
        },
      },
    },
    {
      name: 'a malformed IPv6 target',
      value: input({
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: '::::' },
      }),
    },
    {
      name: 'a scoped IPv6 publish origin',
      value: input({
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: 'fe80::1234%12', wildcard: false },
          exposure: 'interface-bound',
          protocol: 'tcp',
          host: 'fe80::1234%12',
          port: 8080,
        },
      }),
    },
    {
      name: 'a contradictory wildcard bind',
      value: input({
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '127.0.0.1', wildcard: true },
          exposure: 'all-interfaces',
          protocol: 'tcp',
          host: '127.0.0.1',
          port: 8080,
        },
      }),
    },
    {
      name: 'a hostname used as observed bind evidence',
      value: input({
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: 'localhost', wildcard: false },
          exposure: 'loopback-only',
          protocol: 'tcp',
          host: 'localhost',
          port: 8080,
        },
      }),
    },
    {
      name: 'a loopback bind claiming interface exposure',
      value: input({
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '127.0.0.2', wildcard: false },
          exposure: 'interface-bound',
          protocol: 'tcp',
          host: '127.0.0.2',
          port: 8080,
        },
      }),
    },
    {
      name: 'a non-loopback bind claiming loopback exposure',
      value: input({
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '192.168.1.25', wildcard: false },
          exposure: 'loopback-only',
          protocol: 'tcp',
          host: '192.168.1.25',
          port: 8080,
        },
      }),
    },
  ])('rejects $name', ({ value }) => {
    expect(createHandoffEnvelope(value as PendingHandoffInput, { now }).ok).toBe(false);
  });

  it('rejects expired, future-invalid, and overlong temporal windows', () => {
    const valid = createHandoffEnvelope(
      input({
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: 'example.com' },
      }),
      { now }
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    expect(
      normalizeHandoffEnvelope(
        {
          ...valid.value,
          createdAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now).toISOString(),
        },
        { now }
      )
    ).toEqual({ ok: false, error: 'The handoff has expired.' });
    expect(
      normalizeHandoffEnvelope(
        {
          ...valid.value,
          createdAt: new Date(now + handoffClockSkewMilliseconds + 1).toISOString(),
          expiresAt: new Date(now + handoffClockSkewMilliseconds + 60_000).toISOString(),
        },
        { now }
      )
    ).toEqual({ ok: false, error: 'The handoff creation time is too far in the future.' });
    expect(
      normalizeHandoffEnvelope(
        {
          ...valid.value,
          expiresAt: new Date(now + maximumHandoffTTLMilliseconds + 1).toISOString(),
        },
        { now }
      )
    ).toEqual({ ok: false, error: 'The handoff lifetime is too long.' });
    expect(
      normalizeHandoffEnvelope(
        {
          ...valid.value,
          provenance: {
            ...valid.value.provenance,
            observedAt: new Date(now + handoffClockSkewMilliseconds + 1).toISOString(),
          },
        },
        { now }
      )
    ).toEqual({ ok: false, error: 'The handoff evidence time is too far in the future.' });
    expect(
      createHandoffEnvelope(
        {
          ...input({
            kind: 'next-hop-target-draft',
            target: { kind: 'next-hop-target', target: 'example.com' },
          }),
          provenance: {
            source: 'network-route',
            quality: 'observed',
            observedAt: new Date(now - 5 * 60_000 - 1).toISOString(),
          },
        },
        { now }
      )
    ).toEqual({
      ok: false,
      error: 'The handoff evidence is stale. Inspect again before opening a draft.',
    });
  });
});

describe('pending handoff broker', () => {
  const grpcInput = input({
    kind: 'grpc-target-draft',
    target: { kind: 'grpc-target', address: 'localhost:50051', plaintext: true },
  });

  it('round-trips one session handoff and consumes it once', () => {
    const stored = storePendingHandoff(grpcInput, { now });

    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.storage).toBe('session');
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).not.toBeNull();
    expect(peekPendingHandoff('grpc-target-draft', { now })?.id).toBe(stored.value.id);
    expect(consumePendingHandoff('grpc-target-draft', { now })).toMatchObject({
      id: stored.value.id,
      storage: 'session',
    });
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();
  });

  it('does not consume another route kind', () => {
    const stored = storePendingHandoff(grpcInput, { now });
    expect(stored.ok).toBe(true);

    expect(consumePendingHandoff('http-url-draft', { now })).toBeNull();
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).not.toBeNull();
    expect(consumePendingHandoff('grpc-target-draft', { now })?.draft.kind).toBe(
      'grpc-target-draft'
    );
  });

  it('keeps only the most recently stored pending envelope', () => {
    expect(storePendingHandoff(grpcInput, { now }).ok).toBe(true);
    const http = storePendingHandoff(
      input({
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'https://example.com/health' },
      }),
      { now }
    );
    expect(http.ok).toBe(true);

    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
    expect(consumePendingHandoff('http-url-draft', { now })?.draft).toEqual({
      kind: 'http-url-draft',
      target: { kind: 'http-url', url: 'https://example.com/health' },
    });
  });

  it('removes an unused envelope at expiry without clearing its replacement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const first = storePendingHandoff(grpcInput, { ttlMilliseconds: 100 });
    expect(first.ok).toBe(true);

    vi.advanceTimersByTime(50);
    const replacement = storePendingHandoff(
      input({
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'https://replacement.example' },
      }),
      { ttlMilliseconds: 200 }
    );
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;

    vi.advanceTimersByTime(51);
    expect(peekPendingHandoff('http-url-draft')?.id).toBe(replacement.value.id);
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).not.toBeNull();

    vi.advanceTimersByTime(150);
    expect(peekPendingHandoff('http-url-draft')).toBeNull();
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();
  });

  it('discards stale or future-invalid persisted envelopes instead of consuming them', () => {
    const stored = createHandoffEnvelope(grpcInput, { now });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    clearPendingHandoff();
    window.sessionStorage.setItem(
      appStorageKeys.pendingHandoff,
      JSON.stringify({ ...stored.value, expiresAt: new Date(now).toISOString() })
    );
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();

    const futureCreatedAt = now + handoffClockSkewMilliseconds + 1;
    clearPendingHandoff();
    window.sessionStorage.setItem(
      appStorageKeys.pendingHandoff,
      JSON.stringify({
        ...stored.value,
        createdAt: new Date(futureCreatedAt).toISOString(),
        expiresAt: new Date(futureCreatedAt + 60_000).toISOString(),
      })
    );
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();
  });

  it('falls back to memory and removes an older mirror when a session write fails', () => {
    expect(storePendingHandoff(grpcInput, { now }).ok).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });

    const stored = storePendingHandoff(
      input({
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'https://replacement.example' },
      }),
      { now }
    );

    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.storage).toBe('memory');
    expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
    expect(consumePendingHandoff('http-url-draft', { now })).toMatchObject({
      id: stored.value.id,
      storage: 'memory',
    });
    expect(consumePendingHandoff('http-url-draft', { now })).toBeNull();
  });

  it('uses the memory mirror when a session read fails', () => {
    const stored = storePendingHandoff(grpcInput, { now });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });

    expect(consumePendingHandoff('grpc-target-draft', { now })?.id).toBe(stored.value.id);
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
  });

  it('keeps consume-once semantics when session removal fails', () => {
    const stored = storePendingHandoff(grpcInput, { now });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });

    expect(consumePendingHandoff('grpc-target-draft', { now })?.id).toBe(stored.value.id);
    expect(consumePendingHandoff('grpc-target-draft', { now })).toBeNull();
  });

  it('reads a legacy handoff at most once when browser removal fails', () => {
    window.localStorage.setItem(
      appStorageKeys.pendingHTTPURL,
      JSON.stringify('https://legacy.example.test')
    );
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });

    expect(consumeLegacyHandoff('http-url-draft')?.draft).toEqual({
      kind: 'http-url-draft',
      target: { kind: 'http-url', url: 'https://legacy.example.test/' },
    });
    expect(consumeLegacyHandoff('http-url-draft')).toBeNull();
    clearPendingHandoff();
    expect(consumeLegacyHandoff('http-url-draft')).toBeNull();
  });
});
