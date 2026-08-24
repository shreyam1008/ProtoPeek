import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchThisPCCapabilities,
  fetchThisPCPublicIdentity,
  fetchThisPCSnapshot,
  inspectThisPCActivity,
  normalizeThisPCActivity,
  normalizeThisPCCapabilities,
  normalizeThisPCPublicIdentity,
  normalizeThisPCSnapshot,
  normalizeThisPCTrafficSample,
  sampleThisPCTraffic,
  ThisPCAPIError,
} from './this-pc-api';

const capabilities = {
  schemaVersion: 1,
  scope: 'process-network-namespace',
  scopeNotice: 'Visible to this ProtoPeek process/network namespace.',
  snapshot: { supported: true },
  activity: { supported: true, requiresAcknowledgement: true },
  trafficSample: { supported: true, durationsMs: [500, 1000, 2000] },
  publicIdentity: {
    supported: true,
    requiresAcknowledgement: true,
    provider: 'ipify',
    bgpOriginProvider: 'Team Cymru',
    dnsResolverDisclosure: 'The configured DNS resolver may see the lookup.',
  },
};

const counters = {
  receivedBytes: '18446744073709551615',
  receivedPackets: '42',
  receivedErrors: '0',
  receivedDropped: '1',
  transmittedBytes: '9007199254740993',
  transmittedPackets: '24',
  transmittedErrors: '0',
  transmittedDropped: '0',
};

const snapshot = {
  schemaVersion: 1,
  status: 'ok',
  scope: 'process-network-namespace',
  scopeNotice: 'Visible to this ProtoPeek process/network namespace.',
  observedAt: '2026-08-24T03:30:00Z',
  hostname: 'workstation',
  os: 'linux',
  arch: 'amd64',
  logicalCpus: 8,
  interfaces: [
    {
      index: 2,
      name: 'eth0',
      mtu: 1500,
      flags: ['up', 'broadcast'],
      addresses: [
        { address: '192.168.1.5', prefix: 24, family: 'ipv4', scope: 'private' },
        { address: '2001:db8::5', prefix: 64, family: 'ipv6', scope: 'global-unicast' },
      ],
      traffic: counters,
    },
  ],
  linuxSystem: {
    kernelRelease: '6.8.0-test',
    uptimeSeconds: '12345',
    totalMemoryBytes: '17179869184',
    availableMemoryBytes: '8589934592',
  },
  notes: [],
};

const socket = {
  protocol: 'tcp4',
  state: 'LISTEN',
  local: { address: '0.0.0.0', port: 8080, wildcard: true },
  remote: { address: '', port: 0, wildcard: true },
  exposure: 'all-interfaces',
  ownerStatus: 'observed',
  processes: [
    { pid: 12, comm: 'first' },
    { pid: 20, comm: 'second' },
  ],
  ownersTruncated: false,
};

const activity = {
  schemaVersion: 1,
  status: 'partial',
  scope: 'process-network-namespace',
  scopeNotice: 'Visible to this ProtoPeek process/network namespace.',
  observedAt: '2026-08-24T03:30:01Z',
  listeners: [socket],
  connections: [],
  truncated: false,
  limits: {
    maxSockets: 4096,
    maxProcesses: 512,
    maxFileDescriptors: 16384,
    wallTimeMs: 2000,
  },
  notes: [],
};

const traffic = {
  schemaVersion: 1,
  scope: 'process-network-namespace',
  scopeNotice: 'Visible to this ProtoPeek process/network namespace.',
  startedAt: '2026-08-24T03:30:01Z',
  finishedAt: '2026-08-24T03:30:02Z',
  durationMs: 1000,
  interfaces: [{ name: 'eth0', status: 'ok', ...counters }],
  notes: [],
};

const publicIdentity = {
  schemaVersion: 1,
  observedAt: '2026-08-24T03:30:03Z',
  provider: 'ipify',
  externalRequestDisclosure: 'One request was made for each selected family.',
  dnsResolverDisclosure: 'The configured DNS resolver may see the lookup.',
  families: [
    {
      family: 'ipv4',
      status: 'ok',
      address: '203.0.113.8',
      bgpOriginStatus: 'ambiguous',
      bgpOriginError: 'Multiple origin records were returned.',
    },
    {
      family: 'ipv6',
      status: 'unavailable',
      error: 'IPv6 request was unavailable.',
      bgpOriginStatus: 'not-attempted',
    },
  ],
};

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function exactLengthJSON(base: Record<string, unknown>, bytes: number) {
  const initial = JSON.stringify({ ...base, padding: '' });
  const fill = bytes - new TextEncoder().encode(initial).length;
  if (fill < 0) throw new Error('Fixture exceeds requested length.');
  const value = JSON.stringify({ ...base, padding: 'x'.repeat(fill) });
  expect(new TextEncoder().encode(value)).toHaveLength(bytes);
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('This PC response normalization', () => {
  it('requires schemaVersion 1 on every successful response type', () => {
    const cases = [
      [normalizeThisPCCapabilities, capabilities],
      [normalizeThisPCSnapshot, snapshot],
      [normalizeThisPCActivity, activity],
      [normalizeThisPCTrafficSample, traffic],
      [normalizeThisPCPublicIdentity, publicIdentity],
    ] as const;

    for (const [normalize, fixture] of cases) {
      expect(() => normalize({ ...fixture, schemaVersion: undefined })).toThrow(/schema version/i);
      expect(() => normalize({ ...fixture, schemaVersion: 2 })).toThrow(/schema version/i);
      expect(normalize(fixture)).toMatchObject({ schemaVersion: 1 });
    }
  });

  it('preserves exact decimal counters and rejects fractions, unsafe numbers, and overflow', () => {
    const normalized = normalizeThisPCSnapshot(snapshot);

    expect(normalized.interfaces[0]?.traffic?.receivedBytes).toBe('18446744073709551615');
    expect(normalized.interfaces[0]?.addresses[1]).toEqual({
      address: '2001:db8::5',
      prefix: 64,
      family: 'ipv6',
      scope: 'global-unicast',
    });
    expect(normalized.linuxSystem?.uptimeSeconds).toBe('12345');
    expect(() =>
      normalizeThisPCSnapshot({
        ...snapshot,
        linuxSystem: { ...snapshot.linuxSystem, uptimeSeconds: '123.45' },
      })
    ).toThrow(/Linux uptime/i);
    expect(() =>
      normalizeThisPCSnapshot({
        ...snapshot,
        interfaces: [
          {
            ...snapshot.interfaces[0],
            traffic: { ...counters, receivedBytes: Number.MAX_SAFE_INTEGER + 1 },
          },
        ],
      })
    ).toThrow(/received bytes/i);
    expect(() =>
      normalizeThisPCSnapshot({
        ...snapshot,
        interfaces: [
          {
            ...snapshot.interfaces[0],
            traffic: { ...counters, receivedBytes: '18446744073709551616' },
          },
        ],
      })
    ).toThrow(/received bytes/i);
  });

  it('preserves multiple owners and authoritative exposure without inferring reachability', () => {
    const normalized = normalizeThisPCActivity(activity);
    expect(normalized.listeners[0]).toMatchObject({
      exposure: 'all-interfaces',
      ownerStatus: 'observed',
      processes: [
        { pid: 12, comm: 'first' },
        { pid: 20, comm: 'second' },
      ],
    });
    expect(() =>
      normalizeThisPCActivity({
        ...activity,
        listeners: [{ ...socket, ownerStatus: 'restricted', processes: socket.processes }],
      })
    ).toThrow(/inconsistent socket owner/i);
  });

  it('enforces the combined advertised socket limit', () => {
    const emptyOwnerSocket = {
      ...socket,
      ownerStatus: 'not-found',
      processes: [],
    };
    expect(() =>
      normalizeThisPCActivity({
        ...activity,
        listeners: Array.from({ length: 4096 }, () => emptyOwnerSocket),
        connections: [emptyOwnerSocket],
      })
    ).toThrow(/advertised limit/i);
    expect(() =>
      normalizeThisPCActivity({
        ...activity,
        listeners: [emptyOwnerSocket, emptyOwnerSocket],
        limits: { ...activity.limits, maxSockets: 1 },
      })
    ).toThrow(/advertised limit/i);
  });

  it('preserves IPv4 when IPv6 fails and preserves an ambiguous BGP origin', () => {
    const normalized = normalizeThisPCPublicIdentity(publicIdentity);

    expect(normalized.families[0]).toEqual({
      family: 'ipv4',
      status: 'ok',
      address: '203.0.113.8',
      bgpOriginStatus: 'ambiguous',
      bgpOriginError: 'Multiple origin records were returned.',
    });
    expect(normalized.families[1]).toMatchObject({
      family: 'ipv6',
      status: 'unavailable',
      error: 'IPv6 request was unavailable.',
    });
  });
});

describe('This PC API requests', () => {
  it('mount reads use only local GETs without CSRF mutation headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).includes('capabilities') ? json(capabilities) : json(snapshot)
    );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([fetchThisPCCapabilities(), fetchThisPCSnapshot()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new URL(String(input)).pathname).toMatch(
        /^\/api\/this-pc\/(?:capabilities|snapshot)$/
      );
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).has('x-protopeek-csrf-token')).toBe(false);
    }
  });

  it('sends exact acknowledgement bodies and CSRF protection for every mutation', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=this-pc-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/activity')) return json(activity);
      if (path.endsWith('/traffic/sample')) return json(traffic);
      return json(publicIdentity);
    });
    vi.stubGlobal('fetch', fetchMock);

    await inspectThisPCActivity();
    await sampleThisPCTraffic(1000);
    await fetchThisPCPublicIdentity(['ipv4', 'ipv6']);

    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { acknowledgeLocalInspection: true },
      { durationMs: 1000 },
      { acknowledgeExternalRequest: true, families: ['ipv4', 'ipv6'] },
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('x-protopeek-csrf-token')).toBe('this-pc-token');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    }
  });

  it('accepts an exact 1 MiB response and rejects one byte more', async () => {
    const exact = exactLengthJSON(capabilities, 1024 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(exact))
    );
    await expect(fetchThisPCCapabilities()).resolves.toMatchObject({ schemaVersion: 1 });

    const oversized = exactLengthJSON(capabilities, 1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(oversized))
    );
    await expect(fetchThisPCCapabilities()).rejects.toThrow(/oversized/i);
  });

  it('accepts an exact 4 MiB activity response and rejects one byte more', async () => {
    const exact = exactLengthJSON(activity, 4 * 1024 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(exact))
    );
    await expect(inspectThisPCActivity()).resolves.toMatchObject({ schemaVersion: 1 });

    const oversized = exactLengthJSON(activity, 4 * 1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(oversized))
    );
    await expect(inspectThisPCActivity()).rejects.toThrow(/oversized/i);
  });

  it('parses the versioned error envelope without exposing raw JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ schemaVersion: 1, error: 'Local inspection is restricted.' }, { status: 403 })
      )
    );

    const failure = await fetchThisPCSnapshot().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ThisPCAPIError);
    expect(failure).toMatchObject({ status: 403, message: 'Local inspection is restricted.' });
    expect((failure as Error).message).not.toContain('{');
  });
});
