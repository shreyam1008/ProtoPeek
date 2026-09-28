import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildLocalNetworkPlanPreview,
  defaultLocalNetworkInterface,
  discoverLocalNetwork,
  fetchLocalNetworkCapabilities,
  localNetworkDiscoveryToSnapshot,
  normalizeLocalNetworkCapabilities,
  normalizeLocalNetworkDiscovery,
} from './local-network';

const rawCapabilities = {
  perspective: 'protopeek-process',
  activeProbe: false,
  profiles: [
    {
      id: 'quick',
      label: 'Quick services',
      description: 'HTTP, HTTPS, gRPC, and a common local API port.',
      ports: [80, 443, 50051, 8080],
      applicationProbePorts: [80, 443, 50051, 8080],
    },
  ],
  limits: {
    minimumPrefix: 24,
    maxPorts: 18,
    maxAttempts: 4572,
    maxWorkers: 32,
    deadlineMs: 15000,
  },
  interfaces: [
    {
      index: 4,
      name: 'en0',
      address: '192.168.44.19',
      interfaceCidr: '192.168.0.0/16',
      suggestedCidr: '192.168.44.0/24',
    },
  ],
  warnings: ['Loading capabilities does not send network probes.'],
};

const rawDiscovery = {
  perspective: 'protopeek-process',
  observedAt: '2026-08-21T04:30:00Z',
  cidr: '192.168.44.0/30',
  profile: rawCapabilities.profiles[0],
  hostCount: 2,
  attemptsPlanned: 8,
  attemptsCompleted: 8,
  complete: true,
  hosts: [
    {
      address: '192.168.44.1',
      ports: [
        {
          port: 50051,
          state: 'open',
          provenance: 'observed',
          protocols: ['tcp', 'grpc'],
          grpc: true,
          http: false,
          reflection: 'available',
          services: ['catalog.v1.Catalog'],
          httpProtocol: '',
          httpStatus: '',
          httpServer: '',
          probeDurationMs: 3,
          evidenceNotes: ['gRPC reflection listed one service'],
        },
      ],
      hints: [
        {
          label: 'gRPC endpoint',
          confidence: 'low',
          provenance: 'inferred',
          reason: 'gRPC responded on TCP 50051',
        },
      ],
    },
  ],
  warnings: ['An absent host is not evidence that the device is offline.'],
};

describe('local network contracts', () => {
  it('validates cache provenance, known interfaces and a route-selected default', () => {
    const inventory = {
      observedAt: '2026-09-27T12:00:00Z',
      status: 'available',
      source: 'os-neighbor-cache',
      defaultInterfaceIndex: 4,
      defaultGateway: '192.168.44.1',
      warnings: [],
      devices: [
        {
          address: '192.168.44.1',
          interfaceIndex: 4,
          interfaceName: 'en0',
          mac: '52:54:00:12:34:56',
          hostname: '',
          kind: 'neighbor',
          state: 'cached',
          source: 'os-neighbor-cache',
        },
      ],
    };
    const result = normalizeLocalNetworkCapabilities({ ...rawCapabilities, inventory });
    expect(defaultLocalNetworkInterface(result)?.name).toBe('en0');
    expect(result.inventory?.devices[0]?.state).toBe('cached');
    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        inventory: {
          ...inventory,
          devices: [{ ...inventory.devices[0], hostname: 'invented-router' }],
        },
      })
    ).toThrow(/invented hostname/);
    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        inventory: { ...inventory, defaultInterfaceIndex: 99 },
      })
    ).toThrow(/available network/);
    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        inventory: { ...inventory, devices: [{ ...inventory.devices[0], address: '10.10.10.1' }] },
      })
    ).toThrow(/available private network/);
  });

  it('keeps advertised ports unknown in snapshots until a TCP probe establishes they are open', () => {
    const advertisements = {
      status: 'available',
      warnings: [],
      records: [
        {
          address: '192.168.44.2',
          instance: 'Office._ipp._tcp.local',
          serviceType: '_ipp._tcp.local',
          hostname: 'printer.local',
          port: 631,
          txt: ['ty=Office printer'],
          source: 'mdns',
        },
      ],
    };
    const result = normalizeLocalNetworkDiscovery({ ...rawDiscovery, advertisements });
    expect(result.hosts).toHaveLength(1);
    const snapshot = localNetworkDiscoveryToSnapshot(result);
    const printer = snapshot.nodes.find((node) => node.id === 'host:192.168.44.2');
    expect(printer?.ports[0]?.state).toBe('unknown');
    expect(printer?.ports[0]?.services[0]?.transport).toBe('_ipp._tcp.local');
    expect(printer?.provenance[0]?.detail).toContain('does not establish an open port');
    expect(() =>
      normalizeLocalNetworkDiscovery({
        ...rawDiscovery,
        advertisements: {
          ...advertisements,
          records: [{ ...advertisements.records[0], address: '192.168.44.250' }],
        },
      })
    ).toThrow(/requested scope/);
  });

  it('saves maximum advertised metadata within workspace limits and rejects unsafe text', () => {
    const record = {
      address: '192.168.44.2',
      instance: `${'i'.repeat(240)}.local`,
      serviceType: '_ipp._tcp.local',
      hostname: `${'h'.repeat(240)}.local`,
      port: 631,
      txt: Array.from({ length: 8 }, (_, index) => `${index}${'x'.repeat(255)}`),
      source: 'mdns',
    };
    const advertisements = { status: 'available', warnings: [], records: [record] };
    const result = normalizeLocalNetworkDiscovery({ ...rawDiscovery, advertisements });
    const snapshot = localNetworkDiscoveryToSnapshot(result);
    const printer = snapshot.nodes.find((node) => node.id === 'host:192.168.44.2');
    expect(printer?.ports[0]?.state).toBe('unknown');
    expect(
      new TextEncoder().encode(printer?.provenance[0]?.detail ?? '').length
    ).toBeLessThanOrEqual(2048);
    for (const field of ['hostname', 'instance', 'serviceType'] as const) {
      expect(() =>
        normalizeLocalNetworkDiscovery({
          ...rawDiscovery,
          advertisements: {
            ...advertisements,
            records: [{ ...record, [field]: 'invalid\u0001.local' }],
          },
        })
      ).toThrow(/control characters/);
    }
    expect(() =>
      normalizeLocalNetworkDiscovery({
        ...rawDiscovery,
        advertisements: { ...advertisements, records: [{ ...record, txt: ['invalid\u0001'] }] },
      })
    ).toThrow(/control characters/);
  });
  it('normalizes no-probe capabilities and previews the exact server plan', () => {
    const capabilities = normalizeLocalNetworkCapabilities(rawCapabilities);
    const preview = buildLocalNetworkPlanPreview(capabilities, '192.168.44.3/30', 'quick');

    expect(preview).toEqual({
      cidr: '192.168.44.0/30',
      profile: capabilities.profiles[0],
      hostCount: 2,
      portCount: 4,
      ports: [80, 443, 50051, 8080],
      applicationProbePorts: [80, 443, 50051, 8080],
      connectOnlyPorts: [],
      attempts: 8,
      concurrency: 8,
      deadlineMs: 15000,
    });
    expect(() => buildLocalNetworkPlanPreview(capabilities, '8.8.8.0/24', 'quick')).toThrow(
      'private IPv4'
    );
    expect(() => buildLocalNetworkPlanPreview(capabilities, '192.168.0.0/23', 'quick')).toThrow(
      '/24'
    );
  });

  it('loads suggestions without probing and sends one exact consented CSRF request', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=network-token; path=/';
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        new URL(String(input)).pathname.endsWith('/capabilities') ? rawCapabilities : rawDiscovery
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchLocalNetworkCapabilities(controller.signal);
    await discoverLocalNetwork(
      { cidr: '192.168.44.0/30', profile: 'quick', consent: true },
      controller.signal
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({ cidr: '192.168.44.0/30', profile: 'quick', consent: true }),
      headers: {
        'Content-Type': 'application/json',
        'x-protopeek-csrf-token': 'network-token',
      },
    });
  });

  it('rejects a discovery response that does not match the requested scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...rawDiscovery,
          cidr: '192.168.45.0/30',
          hosts: [{ ...rawDiscovery.hosts[0], address: '192.168.45.1' }],
        })
      )
    );

    await expect(
      discoverLocalNetwork({ cidr: '192.168.44.0/30', profile: 'quick', consent: true })
    ).rejects.toThrow('did not match the requested CIDR');
  });

  it('rejects capability arrays and plans that exceed advertised bounds', () => {
    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        profiles: Array.from({ length: 17 }, (_, index) => ({
          id: `profile-${index}`,
          label: 'Profile',
          description: 'Profile description',
          ports: [80],
          applicationProbePorts: [80],
        })),
      })
    ).toThrow('at most 16');

    const capabilities = normalizeLocalNetworkCapabilities({
      ...rawCapabilities,
      limits: { ...rawCapabilities.limits, maxAttempts: 7 },
    });
    expect(() => buildLocalNetworkPlanPreview(capabilities, '192.168.44.0/30', 'quick')).toThrow(
      '7-attempt limit'
    );

    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        limits: { ...rawCapabilities.limits, maxPorts: 19 },
      })
    ).toThrow('through 18');

    expect(() =>
      normalizeLocalNetworkCapabilities({
        ...rawCapabilities,
        profiles: [
          {
            ...rawCapabilities.profiles[0],
            applicationProbePorts: [80, 9100],
          },
        ],
      })
    ).toThrow('subset of ports');
  });

  it('normalizes bounded observed endpoints without promoting inferred device roles', () => {
    const discovery = normalizeLocalNetworkDiscovery(rawDiscovery);

    expect(discovery.observedAt).toBe('2026-08-21T04:30:00.000Z');
    expect(discovery.hosts[0]?.ports[0]).toMatchObject({
      port: 50051,
      state: 'open',
      provenance: 'observed',
      services: ['catalog.v1.Catalog'],
      probeDurationMs: 3,
    });
    expect(discovery.hosts[0]?.hints[0]).toMatchObject({
      label: 'gRPC endpoint',
      provenance: 'inferred',
      confidence: 'low',
    });
    expect(() =>
      normalizeLocalNetworkDiscovery({
        ...rawDiscovery,
        hosts: [
          {
            ...rawDiscovery.hosts[0],
            ports: [{ ...rawDiscovery.hosts[0].ports[0], provenance: 'inferred' }],
          },
        ],
      })
    ).toThrow('provenance');
    expect(() =>
      normalizeLocalNetworkDiscovery({
        ...rawDiscovery,
        hosts: Array.from({ length: 3 }, (_, index) => ({
          ...rawDiscovery.hosts[0],
          address: `192.168.44.${index + 1}`,
        })),
      })
    ).toThrow('hostCount');
    expect(() =>
      normalizeLocalNetworkDiscovery({
        ...rawDiscovery,
        hosts: [
          {
            ...rawDiscovery.hosts[0],
            ports: [
              {
                ...rawDiscovery.hosts[0].ports[0],
                probeDurationMs: undefined,
                latencyMs: 3,
              },
            ],
          },
        ],
      })
    ).toThrow('latencyMs is not supported');
  });

  it('converts annotations and evidence into a bounded immutable network snapshot', () => {
    const discovery = normalizeLocalNetworkDiscovery(rawDiscovery);
    const snapshot = localNetworkDiscoveryToSnapshot(discovery, {
      '192.168.44.1': { label: 'Catalog API', tags: ['grpc', 'lab'] },
    });

    expect(snapshot.label).toContain('192.168.44.0/30');
    expect(snapshot.groups[0]).toMatchObject({
      kind: 'subnet',
      cidr: '192.168.44.0/30',
    });
    expect(snapshot.nodes[0]).toMatchObject({
      label: 'Catalog API',
      tags: ['grpc', 'lab'],
      deviceType: 'gRPC endpoint',
      identities: [
        {
          kind: 'ipv4',
          value: '192.168.44.1',
          provenance: [expect.objectContaining({ kind: 'observed', source: 'protopeek-probe' })],
        },
      ],
      ports: [
        expect.objectContaining({
          number: 50051,
          protocol: 'tcp',
          state: 'open',
          provenance: [expect.objectContaining({ kind: 'observed' })],
        }),
      ],
    });
    expect(snapshot.nodes[0]?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'observed', source: 'protopeek-probe' }),
        expect.objectContaining({
          kind: 'inferred',
          detail: expect.stringContaining('gRPC endpoint'),
        }),
        expect.objectContaining({ kind: 'manual', source: 'manual' }),
      ])
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0]?.ports[0]?.services)).toBe(true);

    expect(() =>
      localNetworkDiscoveryToSnapshot(discovery, {
        '192.168.44.1': { label: 'x'.repeat(513), tags: [] },
      })
    ).toThrow('512 UTF-8 bytes');
    expect(() =>
      localNetworkDiscoveryToSnapshot(discovery, {
        '192.168.44.1': { label: 'Catalog API', tags: 'grpc' as unknown as string[] },
      })
    ).toThrow('array with at most 32 items');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
