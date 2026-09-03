import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const speedtestMock = vi.hoisted(() => {
  const instances: Array<{ config: unknown; pause: ReturnType<typeof vi.fn> }> = [];

  class FakeSpeedTest {
    config: unknown;
    pause = vi.fn();
    play = vi.fn(() => this.onRunningChange(true));
    onRunningChange = (_running: boolean) => {};
    onResultsChange = (_payload: { type: 'download' }) => {};
    onFinish: (results: FakeSpeedTest['results']) => void = () => {};
    onError: (message: string) => void = () => {};
    results = { getSummary: () => ({}) };

    constructor(config: unknown) {
      this.config = config;
      instances.push(this);
    }
  }

  return { FakeSpeedTest, instances };
});

vi.mock('@cloudflare/speedtest', () => ({ default: speedtestMock.FakeSpeedTest }));

import { ThisPC } from './ThisPC';

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
      addresses: [{ address: '192.168.1.5', prefix: 24, family: 'ipv4', scope: 'private' }],
    },
  ],
  notes: [],
};

const counters = {
  receivedBytes: '125000',
  receivedPackets: '42',
  receivedErrors: '0',
  receivedDropped: '0',
  transmittedBytes: '250000',
  transmittedPackets: '24',
  transmittedErrors: '0',
  transmittedDropped: '0',
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
  status: 'ok',
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
      bgpOriginStatus: 'ok',
      bgpOriginNetwork: {
        label: 'BGP origin network',
        evidence: 'provider-reported',
        provider: 'Team Cymru',
        asn: 'AS64496',
        prefix: '203.0.113.0/24',
        name: 'Example registry entry',
      },
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

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type ResponseOverrides = Partial<
  Record<'capabilities' | 'snapshot' | 'activity' | 'traffic' | 'public', unknown | Response>
>;

function installFetch(overrides: ResponseOverrides = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const key = path.endsWith('/capabilities')
      ? 'capabilities'
      : path.endsWith('/snapshot')
        ? 'snapshot'
        : path.endsWith('/activity')
          ? 'activity'
          : path.endsWith('/traffic/sample')
            ? 'traffic'
            : 'public';
    const defaults = { capabilities, snapshot, activity, traffic, public: publicIdentity };
    const value = overrides[key] ?? defaults[key];
    return value instanceof Response ? value : json(value);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function waitForSnapshot() {
  expect(await screen.findByText('workstation')).toBeVisible();
  expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
}

async function inspectListeners() {
  fireEvent.click(screen.getByRole('tab', { name: 'Listeners' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect local listeners' }));
  const dialog = screen.getByRole('dialog', { name: 'Inspect local listeners' });
  const acknowledgement = within(dialog).getByRole('checkbox', {
    name: /I understand this reads a one-time local socket snapshot/i,
  });
  expect(acknowledgement).toHaveFocus();
  fireEvent.click(acknowledgement);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Inspect once' }));
}

beforeEach(() => {
  speedtestMock.instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('This PC workspace', () => {
  it('mounts with only the two local GETs and never writes browser storage', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDBOpen = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDBOpen });
    const fetchMock = installFetch();

    render(<ThisPC />);
    await waitForSnapshot();
    expect(screen.getByRole('heading', { name: 'This Device' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Benchmark' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([input, init]) => [new URL(String(input)).pathname, init?.method])
    ).toEqual([
      ['/api/this-pc/capabilities', 'GET'],
      ['/api/this-pc/snapshot', 'GET'],
    ]);
    expect(speedtestMock.instances).toHaveLength(0);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(indexedDBOpen).not.toHaveBeenCalled();
  });

  it('requires focused acknowledgement before inspecting sockets and preserves bounded evidence', async () => {
    const fetchMock = installFetch();
    render(<ThisPC />);
    await waitForSnapshot();

    await inspectListeners();

    expect(await screen.findByText('first (PID 12), second (PID 20)')).toBeVisible();
    expect(screen.getByText('All interfaces')).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/api/this-pc/activity' }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ acknowledgeLocalInspection: true }),
      })
    );
  });

  it('keeps initial DOM work bounded for a full 4,096-socket response', async () => {
    const emptyOwnerSocket = {
      ...socket,
      ownerStatus: 'not-found',
      processes: [],
    };
    installFetch({
      activity: {
        ...activity,
        status: 'partial',
        listeners: Array.from({ length: 4096 }, () => emptyOwnerSocket),
        truncated: true,
      },
    });
    render(<ThisPC />);
    await waitForSnapshot();
    await inspectListeners();

    expect(await screen.findByText('Showing 50 of 4096')).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText(/Backend result truncated: yes/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show 50 more' })).toBeVisible();
  });

  it('makes public requests only after family selection and explicit consent', async () => {
    const fetchMock = installFetch();
    render(<ThisPC />);
    await waitForSnapshot();

    fireEvent.click(screen.getByRole('button', { name: 'Check public identity' }));
    const dialog = screen.getByRole('dialog', { name: 'Check public IPv4 and IPv6' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /I understand this makes the disclosed external requests once/i,
      })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check selected families' }));

    expect(await screen.findByText('203.0.113.8')).toBeVisible();
    expect(screen.getByText('IPv6 request was unavailable.')).toBeVisible();
    expect(screen.getByText('BGP origin registry name')).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/api/this-pc/public' }),
      expect.objectContaining({
        body: JSON.stringify({
          acknowledgeExternalRequest: true,
          families: ['ipv4', 'ipv6'],
        }),
      })
    );
  });

  it('keeps upload off and shows the exact bounded budget before loading the benchmark engine', async () => {
    installFetch();
    render(<ThisPC />);
    await waitForSnapshot();

    fireEvent.click(screen.getByRole('button', { name: 'Run bounded benchmark' }));
    const dialog = screen.getByRole('dialog', { name: 'Run one bounded Cloudflare benchmark' });
    expect(speedtestMock.instances).toHaveLength(0);
    expect(
      within(dialog).getByRole('checkbox', { name: /Include upload samples/i })
    ).not.toBeChecked();
    expect(within(dialog).getByText('7,200,000 bytes (7.2 MB)')).toBeVisible();
    expect(within(dialog).getByText(/starts with 5 unloaded-latency probes/i)).toBeVisible();
    expect(
      within(dialog).getByText(/ordinary request metadata such as its local origin/i)
    ).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /I understand this sends the selected synthetic traffic/i,
      })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start one run' }));

    await waitFor(() => expect(speedtestMock.instances).toHaveLength(1));
    expect(speedtestMock.instances[0]?.config).toMatchObject({
      autoStart: false,
      includeCredentials: false,
      logMeasurementApiUrl: null,
      logAimApiUrl: null,
      measureUploadLoadedLatency: false,
    });
  });

  it('gates all browser benchmark controls while capabilities load and after a 404', async () => {
    let resolveCapabilities: (response: Response) => void = () => {};
    const pendingCapabilities = new Promise<Response>((resolve) => {
      resolveCapabilities = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        return path.endsWith('/capabilities')
          ? pendingCapabilities
          : Promise.resolve(json(snapshot));
      })
    );

    render(<ThisPC />);
    expect(screen.getByText('Confirming the local capability boundary')).toBeVisible();
    expect(screen.queryByRole('button', { name: /benchmark/i })).not.toBeInTheDocument();

    resolveCapabilities(
      json(
        { schemaVersion: 1, error: 'This PC is disabled for unsafe remote access.' },
        { status: 404 }
      )
    );
    expect(await screen.findByText('This Device is unavailable in this runtime')).toBeVisible();
    expect(screen.getByText(/will not offer a browser-only benchmark/i)).toBeVisible();
    expect(speedtestMock.instances).toHaveLength(0);
  });

  it('reports unsupported and restricted activity without implying missing evidence', async () => {
    installFetch({
      capabilities: {
        ...capabilities,
        activity: {
          supported: false,
          reason: 'Socket ownership is unsupported on this platform.',
          requiresAcknowledgement: true,
        },
      },
    });
    render(<ThisPC />);
    await waitForSnapshot();
    fireEvent.click(screen.getByRole('tab', { name: 'Listeners' }));

    expect(screen.getByRole('button', { name: 'Inspect local listeners' })).toBeDisabled();
    expect(screen.getByText(/Socket ownership is unsupported on this platform/)).toBeVisible();
  });

  it('shows a restricted runtime result after consent and supports arrow-key tab focus', async () => {
    installFetch({
      activity: json({ schemaVersion: 1, error: 'Local activity is restricted.' }, { status: 403 }),
    });
    render(<ThisPC />);
    await waitForSnapshot();

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const listeners = screen.getByRole('tab', { name: 'Listeners' });
    expect(listeners).toHaveFocus();
    expect(listeners).toHaveAttribute('aria-selected', 'true');

    await inspectListeners();
    expect(
      await screen.findByText('This local inspection is restricted by the running build.')
    ).toBeVisible();
  });

  it('renders aggregate interface rates from a one-shot sample without a per-process claim', async () => {
    installFetch();
    render(<ThisPC />);
    await waitForSnapshot();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sample once' }));

    expect(await screen.findByText('1.0 Mbps average')).toBeVisible();
    expect(screen.getByText('2.0 Mbps average')).toBeVisible();
    expect(screen.getByText(/no per-process claim/i)).toBeVisible();
  });

  it('supersedes the shared action owner without stuck loading or stale evidence', async () => {
    const pendingActivity = deferred<Response>();
    const pendingTraffic = deferred<Response>();
    const pendingPublic = deferred<Response>();
    let activitySignal: AbortSignal | null | undefined;
    let trafficSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/capabilities')) return Promise.resolve(json(capabilities));
        if (path.endsWith('/snapshot')) return Promise.resolve(json(snapshot));
        if (path.endsWith('/activity')) {
          activitySignal = init?.signal;
          return pendingActivity.promise;
        }
        if (path.endsWith('/traffic/sample')) {
          trafficSignal = init?.signal;
          return pendingTraffic.promise;
        }
        return pendingPublic.promise;
      })
    );

    render(<ThisPC />);
    await waitForSnapshot();
    await inspectListeners();
    expect(activitySignal).toBeInstanceOf(AbortSignal);
    expect(activitySignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sample once' }));
    expect(activitySignal?.aborted).toBe(true);
    expect(trafficSignal).toBeInstanceOf(AbortSignal);
    expect(trafficSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: 'Listeners' }));
    expect(screen.getByRole('button', { name: 'Inspect local listeners' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check public identity' }));
    const dialog = screen.getByRole('dialog', { name: 'Check public IPv4 and IPv6' });
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /I understand this makes the disclosed external requests once/i,
      })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check selected families' }));
    expect(trafficSignal?.aborted).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByRole('button', { name: 'Sample once' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await act(async () => {
      pendingPublic.resolve(json(publicIdentity));
    });
    expect(await screen.findByText('203.0.113.8')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    await act(async () => {
      pendingActivity.resolve(
        json({
          ...activity,
          listeners: [
            {
              ...socket,
              processes: [{ pid: 77, comm: 'stale-action' }],
            },
          ],
        })
      );
      pendingTraffic.reject(new Error('stale traffic failure'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText('1.0 Mbps average')).not.toBeInTheDocument();
    expect(screen.queryByText('stale traffic failure')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Listeners' }));
    expect(screen.queryByText('stale-action (PID 77)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect local listeners' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText('203.0.113.8')).toBeVisible();
  });

  it('invalidates and aborts the shared activity owner before unmount', async () => {
    const pendingActivity = deferred<Response>();
    let activitySignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/capabilities')) return Promise.resolve(json(capabilities));
        if (path.endsWith('/snapshot')) return Promise.resolve(json(snapshot));
        if (path.endsWith('/activity')) {
          activitySignal = init?.signal;
          return pendingActivity.promise;
        }
        return Promise.resolve(json(publicIdentity));
      })
    );

    const { unmount } = render(<ThisPC />);
    await waitForSnapshot();
    await inspectListeners();
    expect(activitySignal?.aborted).toBe(false);

    unmount();
    expect(activitySignal?.aborted).toBe(true);
    await act(async () => {
      pendingActivity.resolve(json(activity));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
