import { describe, expect, it } from 'vitest';
import { serializeNetworkWorkspace, validateNetworkWorkspaceImport } from './network-model';
import { normalizePathTrace } from './network-path';
import { pathTraceToNetworkWorkspace } from './path-to-network';

const trace = normalizePathTrace({
  perspective: 'protopeek-process',
  observedAt: '2026-08-21T12:00:00.000Z',
  status: 'complete',
  termination: 'reached',
  reached: true,
  resolution: {
    input: 'edge.example.test',
    source: 'system-dns',
    network: 'ip',
    durationMs: 3,
    answers: [{ address: '203.0.113.20', family: 'ipv4' }],
    pinnedAddress: '203.0.113.20',
    pinnedFamily: 'ipv4',
  },
  route: {
    destination: '203.0.113.20',
    family: 'ipv4',
    status: 'ok',
    sourceIp: '192.168.1.9',
    interfaceIndex: 2,
    interfaceName: 'en0',
    nextHop: '192.168.1.1',
    onLink: false,
    local: false,
    prefix: 24,
    routeMetric: null,
    table: null,
    backend: 'fixture-route',
    notes: [],
    error: '',
  },
  backend: 'fixture-path',
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
      responders: ['192.168.1.1'],
      samples: [{ sequence: 1, status: 'reply', responder: '192.168.1.1', rttMs: 1 }],
    },
    {
      ttl: 2,
      responders: [],
      samples: [{ sequence: 1, status: 'timeout', rttMs: null }],
    },
    {
      ttl: 3,
      responders: ['203.0.113.20', '203.0.113.21'],
      samples: [
        { sequence: 1, status: 'reply', responder: '203.0.113.20', rttMs: 22 },
        { sequence: 2, status: 'reply', responder: '203.0.113.21', rttMs: 24 },
      ],
    },
  ],
  warnings: ['RTT is not per-link latency.'],
  durationMs: 2200,
});

describe('path trace topology conversion', () => {
  it('preserves source, silent TTL, ECMP responders, destination, provenance, and immutable snapshot', () => {
    const workspace = pathTraceToNetworkWorkspace(trace, {
      id: 'path-edge-example',
      name: 'Edge path',
      tags: ['production'],
      notes: 'Morning baseline',
    });

    expect(validateNetworkWorkspaceImport(workspace).error).toBeNull();
    expect(workspace.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source',
          label: 'This ProtoPeek process',
          deviceType: 'process',
        }),
        expect.objectContaining({ id: 'hop-02-unknown', label: 'Unknown hop 2' }),
        expect.objectContaining({ id: 'hop-03-1', label: 'Destination · 203.0.113.20' }),
        expect.objectContaining({ id: 'hop-03-2', label: 'Responder · 203.0.113.21' }),
      ])
    );
    expect(
      workspace.nodes.find((node) => node.id === 'hop-02-unknown')?.provenance[0]
    ).toMatchObject({
      kind: 'inferred',
      source: 'path-trace',
      detail: expect.stringMatching(/no matching reply.*TTL 2/i),
    });
    expect(workspace.nodes.find((node) => node.id === 'hop-01-1')?.provenance[0]).toMatchObject({
      kind: 'observed',
      source: 'path-trace',
    });
    expect(workspace.edges.every((edge) => edge.provenance[0]?.kind === 'inferred')).toBe(true);
    expect(workspace.edges.every((edge) => edge.notes.includes('not a physical link'))).toBe(true);
    expect(workspace.snapshots).toHaveLength(1);
    expect(workspace.snapshots[0]?.nodes).not.toBe(workspace.nodes);
    expect(serializeNetworkWorkspace(workspace)).toContain('protopeek-network');
  });

  it('uses a deterministic bounded identity when metadata is omitted', () => {
    const first = pathTraceToNetworkWorkspace(trace);
    const second = pathTraceToNetworkWorkspace(trace);

    expect(first.id).toBe(second.id);
    expect(first.name).toBe('Path to edge.example.test');
    expect(serializeNetworkWorkspace(first)).toBe(serializeNetworkWorkspace(second));
  });

  it('marks an unreached synthetic destination and its logical edge as inferred', () => {
    const unreachedTrace = normalizePathTrace({
      ...trace,
      status: 'partial',
      termination: 'max-hops',
      reached: false,
      resolution: {
        ...trace.resolution,
        answers: [{ address: '203.0.113.30', family: 'ipv4' }],
        pinnedAddress: '203.0.113.30',
      },
      route: { ...trace.route, destination: '203.0.113.30' },
      hops: trace.hops.slice(0, 2),
    });

    const workspace = pathTraceToNetworkWorkspace(unreachedTrace);

    expect(workspace.nodes.find((node) => node.id === 'hop-01-1')?.provenance[0]?.kind).toBe(
      'observed'
    );
    expect(workspace.nodes.find((node) => node.id === 'hop-02-unknown')?.provenance[0]?.kind).toBe(
      'inferred'
    );
    expect(workspace.nodes.find((node) => node.id === 'destination')).toMatchObject({
      label: 'Destination · not confirmed · 203.0.113.30',
      provenance: [expect.objectContaining({ kind: 'inferred', source: 'path-trace' })],
    });
    expect(workspace.edges.at(-1)).toMatchObject({
      target: 'destination',
      provenance: [expect.objectContaining({ kind: 'inferred', source: 'path-trace' })],
    });
  });

  it('saves observed link-local IPv6 responders with bounded interface zones', () => {
    const scopedTrace = normalizePathTrace({
      ...trace,
      resolution: {
        ...trace.resolution,
        answers: [{ address: 'fe80::2%eth0', family: 'ipv6' }],
        pinnedAddress: 'fe80::2%eth0',
        pinnedFamily: 'ipv6',
      },
      route: {
        ...trace.route,
        destination: 'fe80::2%eth0',
        family: 'ipv6',
        sourceIp: 'fe80::1%eth0',
        nextHop: 'fe80::2%eth0',
        prefix: 64,
      },
      parameters: { ...trace.parameters, family: 'ipv6', maxHops: 1 },
      hops: [
        {
          ttl: 1,
          responders: ['fe80::2%eth0'],
          samples: [{ sequence: 1, status: 'reply', responder: 'fe80::2%eth0', rttMs: 0.8 }],
        },
      ],
    });

    const workspace = pathTraceToNetworkWorkspace(scopedTrace);

    expect(validateNetworkWorkspaceImport(workspace).error).toBeNull();
    expect(workspace.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source',
          identities: [expect.objectContaining({ kind: 'ipv6', value: 'fe80::1%eth0' })],
        }),
        expect.objectContaining({
          id: 'hop-01-1',
          identities: [expect.objectContaining({ kind: 'ipv6', value: 'fe80::2%eth0' })],
          provenance: [expect.objectContaining({ kind: 'observed' })],
        }),
      ])
    );
  });
});
