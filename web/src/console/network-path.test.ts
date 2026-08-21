import { describe, expect, it } from 'vitest';

import {
  buildHopRows,
  normalizePathCapabilities,
  normalizePathTrace,
  pathRegionDictionary,
  summarizePathTrace,
} from './network-path';

const traceFixture = {
  perspective: 'protopeek-process',
  observedAt: '2026-08-21T12:00:00.000Z',
  status: 'partial',
  termination: 'hop-limit',
  reached: false,
  resolution: {
    input: 'edge.example.test',
    source: 'system-resolver',
    network: 'ip',
    durationMs: 3.25,
    answers: [
      { address: '203.0.113.10', family: 'ipv4' },
      { address: '2001:db8::10', family: 'ipv6' },
    ],
    pinnedAddress: '203.0.113.10',
    pinnedFamily: 'ipv4',
  },
  route: {
    destination: '203.0.113.10',
    family: 'ipv4',
    status: 'ok',
    sourceIp: '192.0.2.20',
    interfaceIndex: 7,
    interfaceName: 'en0',
    nextHop: '192.0.2.1',
    onLink: false,
    local: false,
    prefix: 24,
    routeMetric: 10,
    table: 254,
    backend: 'fixture-route',
    notes: [],
    error: '',
  },
  backend: 'linux-udp-error-queue',
  method: 'udp',
  parameters: {
    family: 'ipv4',
    method: 'udp',
    destinationPort: 33434,
    maxHops: 3,
    probesPerHop: 3,
    perProbeTimeoutMs: 750,
    wallTimeoutMs: 20000,
  },
  hops: [
    {
      ttl: 1,
      responders: ['192.0.2.1'],
      samples: [
        { sequence: 1, status: 'reply', responder: '192.0.2.1', rttMs: 1.25 },
        { sequence: 2, status: 'reply', responder: '192.0.2.1', rttMs: 1.5 },
        { sequence: 3, status: 'reply', responder: '192.0.2.1', rttMs: 1.75 },
      ],
    },
    {
      ttl: 2,
      responders: [],
      samples: [
        { sequence: 1, status: 'timeout', rttMs: null },
        { sequence: 2, status: 'timeout', rttMs: null },
        { sequence: 3, status: 'timeout', rttMs: null },
      ],
    },
    {
      ttl: 3,
      responders: ['198.51.100.1', '198.51.100.2'],
      samples: [
        { sequence: 1, status: 'reply', responder: '198.51.100.1', rttMs: 9 },
        { sequence: 2, status: 'timeout', rttMs: null },
        { sequence: 3, status: 'reply', responder: '198.51.100.2', rttMs: 12 },
      ],
    },
  ],
  warnings: [
    'Hop RTT is round trip from the ProtoPeek process, not per-link latency.',
    'A silent hop may still forward traffic.',
  ],
  durationMs: 1024.5,
};

describe('network path evidence', () => {
  it('normalizes bounded DNS, kernel-route, timeout, and ECMP evidence without inventing hops', () => {
    const trace = normalizePathTrace(traceFixture);

    expect(trace.resolution.pinnedAddress).toBe('203.0.113.10');
    expect(trace.hops).toHaveLength(3);
    expect(trace.hops[1]).toMatchObject({ ttl: 2, responders: [] });
    expect(trace.hops[2]?.responders).toEqual(['198.51.100.1', '198.51.100.2']);
    expect(trace.warnings[0]).toMatch(/not per-link latency/i);
  });

  it('summarizes cumulative RTT samples and preserves silent and multi-responder states', () => {
    const trace = normalizePathTrace(traceFixture);
    const rows = buildHopRows(trace);

    expect(rows).toEqual([
      expect.objectContaining({
        ttl: 1,
        state: 'responded',
        rtt: { min: 1.25, median: 1.5, max: 1.75 },
        responderRTTs: [
          {
            responder: '192.0.2.1',
            rtt: { min: 1.25, median: 1.5, max: 1.75 },
          },
        ],
      }),
      expect.objectContaining({ ttl: 2, state: 'silent', rtt: null, responderRTTs: [] }),
      expect.objectContaining({
        ttl: 3,
        state: 'mixed',
        responders: ['198.51.100.1', '198.51.100.2'],
        rtt: null,
        responderRTTs: [
          { responder: '198.51.100.1', rtt: { min: 9, median: 9, max: 9 } },
          { responder: '198.51.100.2', rtt: { min: 12, median: 12, max: 12 } },
        ],
      }),
    ]);
    expect(summarizePathTrace(trace)).toEqual({
      hopSlots: 3,
      respondingHopSlots: 2,
      silentHopSlots: 1,
      responderCount: 3,
      destinationRTT: null,
      reached: false,
      status: 'partial',
    });
  });

  it('computes destination RTT only from replies by the pinned destination', () => {
    const trace = normalizePathTrace({
      ...traceFixture,
      status: 'complete',
      termination: 'reached',
      reached: true,
      resolution: {
        ...traceFixture.resolution,
        pinnedAddress: '198.51.100.1',
        answers: [{ address: '198.51.100.1', family: 'ipv4' }],
      },
      route: { ...traceFixture.route, destination: '198.51.100.1' },
    });

    expect(summarizePathTrace(trace).destinationRTT).toBe(9);
  });

  it('fails closed on malformed, oversized, duplicate, or impossible evidence', () => {
    for (const input of [
      null,
      { ...traceFixture, perspective: 'browser' },
      {
        ...traceFixture,
        hops: Array.from({ length: 33 }, (_, index) => ({
          ttl: index + 1,
          responders: [],
          samples: [],
        })),
      },
      { ...traceFixture, hops: [traceFixture.hops[0], traceFixture.hops[0]] },
      {
        ...traceFixture,
        hops: [
          {
            ttl: 1,
            responders: ['192.0.2.1'],
            samples: [{ sequence: 1, status: 'reply', responder: '192.0.2.1', rttMs: -1 }],
          },
        ],
      },
      {
        ...traceFixture,
        resolution: {
          ...traceFixture.resolution,
          answers: Array.from({ length: 9 }, () => traceFixture.resolution.answers[0]),
        },
      },
    ]) {
      expect(() => normalizePathTrace(input)).toThrow();
    }
  });

  it('allows only the bounded resolver return allowance beyond the configured trace wall', () => {
    const maximumWallTrace = {
      ...traceFixture,
      parameters: { ...traceFixture.parameters, wallTimeoutMs: 30000 },
      durationMs: 32000,
    };

    expect(normalizePathTrace(maximumWallTrace).durationMs).toBe(32000);
    expect(() => normalizePathTrace({ ...maximumWallTrace, durationMs: 32000.01 })).toThrow(
      'durationMs'
    );

    expect(
      normalizePathTrace({
        ...traceFixture,
        parameters: { ...traceFixture.parameters, wallTimeoutMs: 1000 },
        durationMs: 3000,
      }).durationMs
    ).toBe(3000);
    expect(() =>
      normalizePathTrace({
        ...traceFixture,
        parameters: { ...traceFixture.parameters, wallTimeoutMs: 1000 },
        durationMs: 3000.01,
      })
    ).toThrow('durationMs');
  });

  it('normalizes no-probe capability truth and keeps installation/elevation boundaries explicit', () => {
    const capabilities = normalizePathCapabilities({
      perspective: 'protopeek-process',
      os: 'linux',
      capabilities: [
        {
          backend: 'linux-udp-error-queue',
          method: 'udp',
          families: ['ipv4', 'ipv6'],
          available: true,
          privilege: 'none',
          install: 'built-in',
          reason: '',
          limitations: ['Active probes may be filtered.'],
        },
      ],
      limits: {
        maxDestinationBytes: 253,
        maxResolvedAddresses: 8,
        defaultMaxHops: 24,
        maxHops: 32,
        defaultProbesPerHop: 3,
        maxProbesPerHop: 4,
        maxTotalProbes: 96,
        defaultProbeTimeoutMs: 750,
        minProbeTimeoutMs: 100,
        maxProbeTimeoutMs: 2000,
        defaultWallTimeoutMs: 20000,
        maxWallTimeoutMs: 30000,
        maxProbesPerSecond: 20,
        defaultUdpPort: 33434,
      },
      warnings: ['Capability checks do not send path probes.'],
    });

    expect(capabilities.capabilities[0]).toMatchObject({
      available: true,
      privilege: 'none',
      install: 'built-in',
    });
    expect(capabilities.warnings[0]).toMatch(/do not send path probes/i);
  });

  it('defines region codes as a reading aid, never automatic datacenter proof', () => {
    expect(pathRegionDictionary.SIN).toMatchObject({ label: 'Singapore', kind: 'metro' });
    expect(pathRegionDictionary.BOM).toMatchObject({ label: 'Mumbai', kind: 'metro' });
    expect(pathRegionDictionary['us-east-1']).toMatchObject({
      provider: 'AWS',
      kind: 'provider-region',
    });
    expect(pathRegionDictionary.SIN.caveat).toMatch(/does not prove/i);
  });
});
