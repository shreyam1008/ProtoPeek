import { describe, expect, it } from 'vitest';

import type { RecentDiscovery } from './ProtocolShellContext';
import { normalizeRecentDiscoveries } from './recent-discovery';

function discovery(address: string): RecentDiscovery {
  return {
    address,
    alive: true,
    tcp: true,
    grpc: false,
    http: true,
    protocols: ['tcp', 'http'],
    reflection: 'not-checked',
    transport: 'plaintext',
    services: [],
    servicesTruncated: false,
    httpTransport: 'plaintext',
    httpProtocol: 'HTTP/1.1',
    httpProtocolTruncated: false,
    httpStatus: '204 No Content',
    httpStatusTruncated: false,
    httpStatusCode: 204,
    httpServer: '',
    httpServerTruncated: false,
    failure: '',
    error: null,
    errorTruncated: false,
    details: [],
    detailsTruncated: false,
    latencyMs: 2,
    discoveredAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('normalizeRecentDiscoveries', () => {
  it('rejects malformed storage shapes without throwing', () => {
    expect(normalizeRecentDiscoveries({ address: 'localhost:8080' })).toEqual([]);
    expect(normalizeRecentDiscoveries([null, {}, { address: 7 }])).toEqual([]);
  });

  it('retains at most the twelve newest valid discoveries', () => {
    const stored = Array.from({ length: 14 }, (_, index) => discovery(`127.0.0.1:${8000 + index}`));

    expect(normalizeRecentDiscoveries(stored).map((entry) => entry.address)).toEqual(
      stored.slice(0, 12).map((entry) => entry.address)
    );
  });
});
