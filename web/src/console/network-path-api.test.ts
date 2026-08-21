import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPathCapabilities, traceNetworkPath } from './network-path-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('network path API', () => {
  it('keeps capability checks read-only and sends exact consented trace JSON with CSRF', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=path-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      return Response.json(
        path.endsWith('/capabilities')
          ? {
              perspective: 'protopeek-process',
              os: 'linux',
              capabilities: [],
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
              warnings: [],
            }
          : {
              perspective: 'protopeek-process',
              observedAt: '2026-08-21T12:00:00.000Z',
              status: 'partial',
              termination: 'hop-limit',
              reached: false,
              resolution: {
                input: '1.1.1.1',
                source: 'literal',
                network: 'ipv4',
                durationMs: 0,
                answers: [{ address: '1.1.1.1', family: 'ipv4' }],
                pinnedAddress: '1.1.1.1',
                pinnedFamily: 'ipv4',
              },
              route: {
                destination: '1.1.1.1',
                family: 'ipv4',
                status: 'unsupported',
                sourceIp: '',
                interfaceIndex: 0,
                interfaceName: '',
                nextHop: '',
                onLink: false,
                local: false,
                prefix: null,
                routeMetric: null,
                table: null,
                backend: 'fixture',
                notes: [],
                error: 'unsupported',
              },
              backend: 'fixture',
              method: 'udp',
              parameters: {
                family: 'ipv4',
                method: 'udp',
                destinationPort: 33434,
                maxHops: 24,
                probesPerHop: 3,
                perProbeTimeoutMs: 750,
                wallTimeoutMs: 20000,
              },
              hops: [],
              warnings: [],
              durationMs: 1,
            }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchPathCapabilities();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });

    const request = {
      destination: '1.1.1.1',
      family: 'auto' as const,
      method: 'auto' as const,
      destinationPort: 33434,
      maxHops: 24,
      probesPerHop: 3,
      perProbeTimeoutMs: 750,
      wallTimeoutMs: 20000,
      consent: { activeProbe: true as const, publicTarget: true },
    };
    await traceNetworkPath(request);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(request),
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-protopeek-csrf-token': 'path-token',
      }),
    });
  });

  it('bounds relay errors and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response('x'.repeat(20_000), { status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      traceNetworkPath(
        {
          destination: 'example.test',
          family: 'auto',
          method: 'auto',
          destinationPort: 33434,
          maxHops: 24,
          probesPerHop: 3,
          perProbeTimeoutMs: 750,
          wallTimeoutMs: 20000,
          consent: { activeProbe: true, publicTarget: true },
        },
        controller.signal
      )
    ).rejects.toThrow(/^x{100,8192}…$/);
  });
});
