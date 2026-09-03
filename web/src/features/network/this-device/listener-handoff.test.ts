import { afterEach, describe, expect, it } from 'vitest';
import { clearPendingHandoff, storePendingHandoff } from '@/console/app/handoff-store';
import type { ThisPCSocket } from '@/console/this-pc-api';

import { createListenerHandoff } from './listener-handoff';

const observedAt = new Date().toISOString();

afterEach(() => {
  clearPendingHandoff();
  window.sessionStorage.clear();
});

function listener(overrides: Partial<ThisPCSocket> = {}): ThisPCSocket {
  return {
    protocol: 'tcp4',
    state: 'LISTEN',
    local: { address: '127.0.0.1', port: 8080, wildcard: false },
    remote: { address: '0.0.0.0', port: 0, wildcard: true },
    exposure: 'loopback-only',
    ownerStatus: 'observed',
    processes: [{ pid: 42, comm: 'service' }],
    ownersTruncated: false,
    ...overrides,
  };
}

describe('listener handoffs', () => {
  it('creates four bounded drafts without carrying process data', () => {
    const socket = listener();

    const drafts = [
      createListenerHandoff(socket, observedAt, 'http-url-draft'),
      createListenerHandoff(socket, observedAt, 'grpc-target-draft'),
      createListenerHandoff(socket, observedAt, 'next-hop-target-draft'),
      createListenerHandoff(socket, observedAt, 'publish-origin-draft'),
    ];

    expect(drafts.every((result) => result.ok)).toBe(true);
    expect(drafts.map((result) => (result.ok ? result.value.draft : null))).toEqual([
      {
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'http://127.0.0.1:8080/' },
      },
      {
        kind: 'grpc-target-draft',
        target: { kind: 'grpc-target', address: '127.0.0.1:8080', plaintext: true },
      },
      {
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: '127.0.0.1' },
      },
      {
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '127.0.0.1', wildcard: false },
          exposure: 'loopback-only',
          protocol: 'tcp',
          host: '127.0.0.1',
          port: 8080,
        },
      },
    ]);
    expect(JSON.stringify(drafts)).not.toContain('processes');
    expect(JSON.stringify(drafts)).not.toContain('ownerStatus');
    expect(JSON.stringify(drafts)).not.toContain('"comm"');
  });

  it('uses a same-family loopback inference while preserving wildcard bind evidence', () => {
    const socket = listener({
      protocol: 'tcp6',
      local: { address: '::', port: 8443, wildcard: true },
      remote: { address: '::', port: 0, wildcard: true },
      exposure: 'all-interfaces',
    });

    const http = createListenerHandoff(socket, observedAt, 'http-url-draft');
    const grpc = createListenerHandoff(socket, observedAt, 'grpc-target-draft');
    const route = createListenerHandoff(socket, observedAt, 'next-hop-target-draft');
    const publish = createListenerHandoff(socket, observedAt, 'publish-origin-draft');

    expect(http).toMatchObject({
      ok: true,
      value: {
        provenance: { quality: 'inferred', observedAt },
        draft: { target: { url: 'https://[::1]:8443/' } },
      },
    });
    expect(grpc).toMatchObject({
      ok: true,
      value: { draft: { target: { address: '[::1]:8443', plaintext: false } } },
    });
    expect(route).toMatchObject({
      ok: true,
      value: { draft: { target: { target: '::1' } } },
    });
    expect(publish).toMatchObject({
      ok: true,
      value: {
        draft: {
          origin: {
            bind: { address: '::', wildcard: true },
            exposure: 'all-interfaces',
            host: '::1',
          },
        },
      },
    });
  });

  it('preserves an unscoped interface bind across all four accepted drafts', () => {
    const socket = listener({
      local: { address: '192.168.1.25', port: 50051, wildcard: false },
      exposure: 'interface-bound',
    });
    const drafts = [
      createListenerHandoff(socket, observedAt, 'http-url-draft'),
      createListenerHandoff(socket, observedAt, 'grpc-target-draft'),
      createListenerHandoff(socket, observedAt, 'next-hop-target-draft'),
      createListenerHandoff(socket, observedAt, 'publish-origin-draft'),
    ];

    expect(drafts.every((result) => result.ok)).toBe(true);
    expect(drafts.map((result) => (result.ok ? result.value.draft : null))).toEqual([
      {
        kind: 'http-url-draft',
        target: { kind: 'http-url', url: 'http://192.168.1.25:50051/' },
      },
      {
        kind: 'grpc-target-draft',
        target: { kind: 'grpc-target', address: '192.168.1.25:50051', plaintext: true },
      },
      {
        kind: 'next-hop-target-draft',
        target: { kind: 'next-hop-target', target: '192.168.1.25' },
      },
      {
        kind: 'publish-origin-draft',
        origin: {
          kind: 'local-service',
          perspective: 'process-network-namespace',
          network: 'tcp',
          bind: { address: '192.168.1.25', wildcard: false },
          exposure: 'interface-bound',
          protocol: 'tcp',
          host: '192.168.1.25',
          port: 50051,
        },
      },
    ]);
    for (const result of drafts) {
      expect(result.ok && storePendingHandoff(result.value).ok).toBe(true);
    }
  });

  it('rejects UDP, missing endpoint evidence, and invalid ports', () => {
    expect(
      createListenerHandoff(listener({ protocol: 'udp4' }), observedAt, 'http-url-draft')
    ).toEqual({
      ok: false,
      error: 'Only observed TCP listeners can become workbench drafts.',
    });
    expect(
      createListenerHandoff(
        listener({ local: { address: '', port: 8080, wildcard: false } }),
        observedAt,
        'grpc-target-draft'
      ).ok
    ).toBe(false);
    expect(
      createListenerHandoff(
        listener({ local: { address: '127.0.0.1', port: 0, wildcard: false } }),
        observedAt,
        'publish-origin-draft'
      ).ok
    ).toBe(false);
  });

  it('keeps scoped IPv6 out of browser URL and publish drafts', () => {
    const socket = listener({
      protocol: 'tcp6',
      local: { address: 'fe80::1234%12', port: 8080, wildcard: false },
      remote: { address: '::', port: 0, wildcard: true },
      exposure: 'interface-bound',
    });

    const http = createListenerHandoff(socket, observedAt, 'http-url-draft');
    const publish = createListenerHandoff(socket, observedAt, 'publish-origin-draft');
    expect(http.ok).toBe(true);
    expect(publish.ok).toBe(true);
    if (!http.ok || !publish.ok) return;
    expect(storePendingHandoff(http.value).ok).toBe(false);
    expect(storePendingHandoff(publish.value).ok).toBe(false);
    expect(createListenerHandoff(socket, observedAt, 'grpc-target-draft')).toMatchObject({
      ok: true,
      value: { draft: { target: { address: '[fe80::1234%12]:8080' } } },
    });
    expect(createListenerHandoff(socket, observedAt, 'next-hop-target-draft')).toMatchObject({
      ok: true,
      value: { draft: { target: { target: 'fe80::1234%12' } } },
    });
  });

  it('refuses link-local IPv6 evidence when the observation has no interface scope', () => {
    const socket = listener({
      protocol: 'tcp6',
      local: { address: 'fe80::1234', port: 8080, wildcard: false },
      remote: { address: '::', port: 0, wildcard: true },
      exposure: 'interface-bound',
    });

    for (const kind of [
      'http-url-draft',
      'grpc-target-draft',
      'next-hop-target-draft',
      'publish-origin-draft',
    ] as const) {
      expect(createListenerHandoff(socket, observedAt, kind)).toEqual({
        ok: false,
        error: 'IPv6 scope missing',
      });
    }
  });

  it('requires a fresh listener observation', () => {
    const now = Date.now();
    const stale = new Date(now - 5 * 60_000 - 1).toISOString();
    const result = createListenerHandoff(listener(), stale, 'grpc-target-draft');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storePendingHandoff(result.value, { now })).toEqual({
      ok: false,
      error: 'The handoff evidence is stale. Inspect again before opening a draft.',
    });
  });
});
