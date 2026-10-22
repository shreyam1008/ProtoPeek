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
  it('restores successful HTTP evidence with the optional fields omitted by Go JSON encoding', () => {
    const sparse = {
      address: '127.0.0.1:43111',
      alive: true,
      tcp: true,
      grpc: false,
      http: true,
      protocols: ['tcp', 'http'],
      reflection: 'not-checked',
      transport: 'plaintext',
      httpTransport: 'plaintext',
      httpProtocol: 'HTTP/1.1',
      httpStatus: '200 OK',
      httpStatusCode: 200,
      httpProtocolTruncated: false,
      httpStatusTruncated: false,
      httpServerTruncated: false,
      servicesTruncated: false,
      detailsTruncated: false,
      errorTruncated: false,
      details: ['http plaintext: HTTP/1.1 200 OK'],
      latencyMs: 2401,
      discoveredAt: '2026-10-18T11:51:39.000Z',
    };
    expect(normalizeRecentDiscoveries([sparse])).toEqual([
      {
        ...sparse,
        services: [],
        httpServer: '',
        failure: '',
        error: null,
      },
    ]);
  });

  it('restores successful gRPC evidence without inventing omitted HTTP observations', () => {
    const sparse = {
      address: '127.0.0.1:18086',
      alive: true,
      tcp: true,
      grpc: true,
      http: false,
      protocols: ['tcp', 'grpc'],
      reflection: 'available',
      transport: 'plaintext',
      services: ['grpc.health.v1.Health'],
      servicesTruncated: false,
      httpProtocolTruncated: false,
      httpStatusTruncated: false,
      httpServerTruncated: false,
      detailsTruncated: false,
      errorTruncated: false,
      latencyMs: 5,
      discoveredAt: '2026-10-18T11:51:39.000Z',
    };
    expect(normalizeRecentDiscoveries([sparse])).toEqual([
      {
        ...sparse,
        httpTransport: '',
        httpProtocol: '',
        httpStatus: '',
        httpStatusCode: 0,
        httpServer: '',
        failure: '',
        error: null,
        details: [],
      },
    ]);
  });

  it.each([
    ['transport', ['plaintext']],
    ['httpTransport', ['tls']],
    ['failure', ['']],
    ['reflection', ['not-checked']],
    ['httpProtocol', 7],
    ['httpStatus', {}],
    ['httpServer', null],
    ['services', 'demo.Service'],
    ['services', [7]],
    ['details', {}],
    ['error', false],
    ['httpStatusCode', '200'],
    ['httpStatusCode', -1],
    ['httpStatusCode', 1000],
    ['servicesTruncated', 'false'],
    ['detailsTruncated', null],
  ])('rejects malformed supplied %s instead of replacing it with an omitted-field default', (key, value) => {
    expect(
      normalizeRecentDiscoveries([{ ...discovery('localhost:8080'), [key as string]: value }])
    ).toEqual([]);
  });

  it.each([
    ['httpProtocol', 'x'.repeat(65)],
    ['httpStatus', 'x'.repeat(513)],
    ['httpServer', 'x'.repeat(257)],
    ['error', 'x'.repeat(2049)],
    ['services', Array.from({ length: 65 }, () => 'demo.Service')],
    ['services', ['x'.repeat(1025)]],
    ['details', ['x'.repeat(2049)]],
  ])('keeps the existing bound for %s', (key, value) => {
    expect(
      normalizeRecentDiscoveries([{ ...discovery('localhost:8080'), [key as string]: value }])
    ).toEqual([]);
  });

  it.each([
    'address',
    'discoveredAt',
    'alive',
    'tcp',
    'grpc',
    'http',
    'protocols',
    'reflection',
    'latencyMs',
  ])('still requires %s', (key) => {
    const candidate: Record<string, unknown> = { ...discovery('localhost:8080') };
    delete candidate[key];
    expect(normalizeRecentDiscoveries([candidate])).toEqual([]);
  });

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
