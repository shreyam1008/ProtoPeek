import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetworkPathPanel } from './NetworkPathPanel';

const capabilities = {
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
      limitations: ['Routers may decline to reply.'],
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
};

const trace = {
  perspective: 'protopeek-process',
  observedAt: '2026-08-21T12:00:00.000Z',
  status: 'complete',
  termination: 'reached',
  reached: true,
  resolution: {
    input: '1.1.1.1',
    source: 'literal',
    network: 'ipv4',
    durationMs: 0.2,
    answers: [{ address: '1.1.1.1', family: 'ipv4' }],
    pinnedAddress: '1.1.1.1',
    pinnedFamily: 'ipv4',
  },
  route: {
    destination: '1.1.1.1',
    family: 'ipv4',
    status: 'ok',
    sourceIp: '192.168.1.20',
    interfaceIndex: 2,
    interfaceName: 'wlan0',
    nextHop: '192.168.1.1',
    onLink: false,
    local: false,
    prefix: 24,
    routeMetric: 600,
    table: 254,
    backend: 'linux-netlink',
    notes: [],
    error: '',
  },
  backend: 'linux-udp-error-queue',
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
  hops: [
    {
      ttl: 1,
      responders: ['192.168.1.1'],
      samples: [
        { sequence: 1, status: 'reply', responder: '192.168.1.1', rttMs: 1.1 },
        { sequence: 2, status: 'reply', responder: '192.168.1.1', rttMs: 1.3 },
        { sequence: 3, status: 'reply', responder: '192.168.1.1', rttMs: 1.2 },
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
      responders: ['1.1.1.1', '1.0.0.1'],
      samples: [
        { sequence: 1, status: 'reply', responder: '1.1.1.1', rttMs: 18 },
        { sequence: 2, status: 'reply', responder: '1.0.0.1', rttMs: 22 },
        { sequence: 3, status: 'timeout', rttMs: null },
      ],
    },
  ],
  warnings: [
    'Each hop RTT is measured from the ProtoPeek process to that responder; it is not per-link latency.',
    'A timeout does not prove that a router or destination is down.',
  ],
  durationMs: 2450,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NetworkPathPanel', () => {
  it('requires explicit probe consent, sends the exact bounded plan, and renders truthful hop evidence', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=trace-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : trace
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSaveTrace = vi.fn();
    render(<NetworkPathPanel onSaveTrace={onSaveTrace} />);

    expect(await screen.findByText('Built in · no elevation')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Trace path' })).toBeDisabled();
    expect(screen.getByText(/24 hops × 3 probes.*72 maximum probes.*20 s wall/i)).toBeVisible();
    expect(screen.getByText(/Anycast.*not a fixed datacenter/i)).toBeVisible();

    fireEvent.click(screen.getByLabelText(/authorize these active UDP path probes/i));
    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      destination: '1.1.1.1',
      family: 'auto',
      method: 'auto',
      destinationPort: 33434,
      maxHops: 24,
      probesPerHop: 3,
      perProbeTimeoutMs: 750,
      wallTimeoutMs: 20000,
      consent: { activeProbe: true, publicTarget: true },
    });

    const spine = await screen.findByRole('region', { name: 'Network evidence spine' });
    expect(within(spine).getByText('DNS resolution')).toBeVisible();
    expect(within(spine).getByText('Kernel route')).toBeVisible();
    expect(within(spine).getByText('Active hop trace')).toBeVisible();
    expect(within(spine).getByText('Destination reached')).toBeVisible();
    expect(screen.getByText('wlan0 · 192.168.1.1')).toBeVisible();
    expect(screen.getByText(/No reply.*may still forward traffic/i)).toBeVisible();
    expect(screen.getAllByText(/1\.1\.1\.1.*1\.0\.0\.1/)[0]).toBeVisible();
    expect(screen.getAllByText(/RTT from this machine/i).length).toBeGreaterThan(0);
    expect(screen.getByText('18.0 ms median RTT')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Hop 3 RTT by responder' })).toBeVisible();
    expect(screen.getAllByText(/not per-link latency/i)[0]).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save trace' }));
    expect(onSaveTrace).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'linux-udp-error-queue' })
    );
  });

  it('shows a truthful unsupported state and never offers silent installation or elevation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...capabilities,
          os: 'darwin',
          capabilities: [
            {
              ...capabilities.capabilities[0],
              backend: 'unsupported',
              available: false,
              install: 'not-offered',
              reason: 'No proven unprivileged native backend is available on this build.',
            },
          ],
        })
      )
    );
    render(<NetworkPathPanel />);

    expect(await screen.findByText(/No proven unprivileged native backend/i)).toBeVisible();
    expect(
      screen.getByText(/ProtoPeek never runs a package manager or asks for root\/admin/i)
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trace path' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
  });

  it('cancels an active trace through AbortSignal and keeps cancellation visible', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith('/capabilities')) {
        return Promise.resolve(Response.json(capabilities));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NetworkPathPanel />);
    await screen.findByText('Built in · no elevation');
    fireEvent.click(screen.getByLabelText(/authorize these active UDP path probes/i));
    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel trace' }));

    expect(await screen.findByText('Path trace cancelled.')).toBeVisible();
  });

  it('blocks a plan that exceeds the backend total-probe limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(capabilities))
    );
    render(<NetworkPathPanel />);

    await screen.findByText('Built in · no elevation');
    fireEvent.change(screen.getByLabelText('Max hops'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Probes / hop'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText(/authorize these active UDP path probes/i));

    expect(screen.getByText(/128-probe plan exceeds the 96-probe backend limit/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trace path' })).toBeDisabled();
  });

  it('binds consent and displayed evidence to one exact editable probe plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : trace
        )
      )
    );
    render(<NetworkPathPanel />);

    await screen.findByText('Built in · no elevation');
    const consent = screen.getByLabelText(/authorize these active UDP path probes/i);
    fireEvent.click(consent);
    expect(consent).toBeChecked();

    fireEvent.change(screen.getByLabelText('Hostname or IP'), {
      target: { value: 'example.test' },
    });
    expect(consent).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Trace path' })).toBeDisabled();

    fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));
    expect(await screen.findByText('Hop evidence from this machine')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Max hops'), { target: { value: '12' } });
    expect(consent).not.toBeChecked();
    expect(screen.queryByText('Hop evidence from this machine')).not.toBeInTheDocument();
  });
});
