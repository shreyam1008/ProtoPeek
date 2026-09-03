import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkWorkbench } from './NetworkWorkbench';
import { type NetworkWorkspaceV1, serializeNetworkWorkspace } from './network-model';
import {
  NetworkStore,
  type NetworkStoreConfiguration,
  type NetworkStorePersistence,
  type NetworkStorePersistenceConnection,
} from './network-store';

const observedAt = '2026-08-20T12:00:00.000Z';

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
    maxProbeTimeoutMs: 2_000,
    defaultWallTimeoutMs: 20_000,
    maxWallTimeoutMs: 30_000,
    maxProbesPerSecond: 20,
    defaultUdpPort: 33_434,
  },
  warnings: ['Capability checks do not send path probes.'],
};

const trace = {
  perspective: 'protopeek-process',
  observedAt,
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
    destinationPort: 33_434,
    maxHops: 24,
    probesPerHop: 3,
    perProbeTimeoutMs: 750,
    wallTimeoutMs: 20_000,
  },
  hops: [
    {
      ttl: 1,
      responders: ['1.1.1.1'],
      samples: [
        { sequence: 1, status: 'reply', responder: '1.1.1.1', rttMs: 18 },
        { sequence: 2, status: 'reply', responder: '1.1.1.1', rttMs: 20 },
        { sequence: 3, status: 'reply', responder: '1.1.1.1', rttMs: 19 },
      ],
    },
  ],
  warnings: ['Hop RTT is round trip from this machine, not per-link latency.'],
  durationMs: 20,
};

const localCapabilities = {
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

const localDiscovery = {
  perspective: 'protopeek-process',
  observedAt,
  cidr: '192.168.44.0/24',
  profile: localCapabilities.profiles[0],
  hostCount: 254,
  attemptsPlanned: 1016,
  attemptsCompleted: 1016,
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
      hints: [],
    },
  ],
  warnings: ['An absent host is not evidence that the device is offline.'],
};

function workspace(id: string, name: string, updatedAt: string): NetworkWorkspaceV1 {
  return {
    format: 'protopeek-network',
    version: 1,
    id,
    name,
    tags: ['lab'],
    notes: '',
    createdAt: observedAt,
    updatedAt,
    nodes: [],
    edges: [],
    groups: [],
    snapshots: [],
  };
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function restorableWorkspace(): NetworkWorkspaceV1 {
  const provenance = [
    {
      kind: 'observed' as const,
      source: 'protopeek-probe' as const,
      observedAt,
      detail: 'Bounded local-network observation.',
    },
  ];
  const historicalNode = {
    id: 'host:192.168.1.20',
    label: 'Original observed host',
    tags: [] as string[],
    notes: '',
    deviceType: 'server',
    firstSeen: observedAt,
    lastSeen: observedAt,
    identities: [{ kind: 'ipv4' as const, value: '192.168.1.20', provenance }],
    ports: [],
    groupIds: [],
    position: { x: 0, y: 0, pinned: false },
    provenance,
  };
  return {
    ...workspace('alpha', 'Alpha network', '2026-08-21T05:00:00.000Z'),
    nodes: [{ ...historicalNode, label: 'Current annotated host' }],
    snapshots: [
      {
        id: 'snapshot-original',
        label: 'Original scan',
        tags: ['local-network'],
        notes: '',
        observedAt,
        nodes: [historicalNode],
        edges: [],
        groups: [],
        provenance,
      },
    ],
  };
}

class ControlledPersistence implements NetworkStorePersistence {
  readonly records = new Map<string, unknown>();
  openBarrier: Promise<void> | null = null;
  putBarrier: Promise<void> | null = null;
  deleteBarrier: Promise<void> | null = null;
  deleteError: Error | null = null;
  onPut: (() => void) | null = null;
  onDelete: (() => void) | null = null;

  async open(
    _configuration: NetworkStoreConfiguration
  ): Promise<NetworkStorePersistenceConnection> {
    await this.openBarrier;
    return {
      read: async (maxRecords) => ({
        values: structuredClone([...this.records.values()].slice(0, maxRecords)),
        overflow: this.records.size > maxRecords,
      }),
      put: async (value, expectedWorkspaceJSON) => {
        this.onPut?.();
        await this.putBarrier;
        const id = (value as { id: string }).id;
        const current = this.records.get(id) as { workspaceJSON?: unknown } | undefined;
        if (
          (typeof current?.workspaceJSON === 'string' ? current.workspaceJSON : null) !==
          expectedWorkspaceJSON
        ) {
          return false;
        }
        this.records.set(id, structuredClone(value));
        return true;
      },
      delete: async (id, expectedWorkspaceJSON) => {
        this.onDelete?.();
        await this.deleteBarrier;
        if (this.deleteError) throw this.deleteError;
        const current = this.records.get(id) as { workspaceJSON?: unknown } | undefined;
        if (current?.workspaceJSON !== expectedWorkspaceJSON) return false;
        this.records.delete(id);
        return true;
      },
    };
  }
}

async function seededStore() {
  const persistence = new ControlledPersistence();
  const store = new NetworkStore(persistence);
  await store.put(workspace('alpha', 'Alpha network', '2026-08-21T05:00:00.000Z'));
  await store.put(workspace('beta', 'Beta network', '2026-08-21T04:00:00.000Z'));
  return { persistence, store };
}

function createTestRouter(store: NetworkStore, initialEntry = '/network/map') {
  function TestRoot() {
    return (
      <>
        <Link to={'/outside' as never}>Leave workbench</Link>
        <Link to={'/networking' as never}>Similar route prefix</Link>
        <Outlet />
      </>
    );
  }

  const rootRoute = createRootRoute({ component: TestRoot });
  const networkRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/network',
    component: () => <NetworkWorkbench store={store} />,
  });
  const networkChildren = ['path', 'local', 'map', 'history'].map((path) =>
    createRoute({
      getParentRoute: () => networkRoute,
      path,
    })
  );
  const outsideRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/outside',
    component: () => <h1>Outside the workbench</h1>,
  });
  const similarPrefixRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/networking',
    component: () => <h1>Similar route outside the workbench</h1>,
  });
  const routeTree = rootRoute.addChildren([
    networkRoute.addChildren(networkChildren),
    outsideRoute,
    similarPrefixRoute,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

async function renderWorkbench(store: NetworkStore, initialEntry = '/network/map') {
  const router = createTestRouter(store, initialEntry);
  render(<RouterProvider router={router} />);
  if (initialEntry === '/network/history') {
    await screen.findByRole('region', { name: 'Alpha network snapshots' });
  } else {
    await screen.findByDisplayValue('Alpha network');
  }
  return router;
}

function deferNextWorkspaceGet(store: NetworkStore, id: string) {
  const started = deferred();
  const barrier = deferred();
  const finished = deferred();
  const originalGet = store.get.bind(store);
  let block = true;
  vi.spyOn(store, 'get').mockImplementation(async (candidateID) => {
    if (!block || candidateID !== id) return originalGet(candidateID);
    block = false;
    started.resolve();
    await barrier.promise;
    const result = await originalGet(candidateID);
    finished.resolve();
    return result;
  });
  return { started, barrier, finished };
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('NetworkWorkbench persistence protections', () => {
  it('saves map edits and can discard later changes back to the persisted workspace', async () => {
    const { store } = await seededStore();
    await renderWorkbench(store);
    const name = screen.getByLabelText('Workspace name');

    fireEvent.change(name, { target: { value: 'Alpha edited' } });
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText('Saved edits to Alpha edited.')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText(/Unsaved map edits stay in this tab/i)).not.toBeInTheDocument()
    );
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Alpha edited' });

    fireEvent.change(name, { target: { value: 'Throwaway edit' } });
    fireEvent.click(screen.getByRole('button', { name: /^Discard$/ }));

    expect(await screen.findByText('Discarded unsaved map edits.')).toBeVisible();
    expect(name).toHaveValue('Alpha edited');
    expect(screen.queryByText(/Unsaved map edits stay in this tab/i)).not.toBeInTheDocument();
  });

  it('keeps workspace switching and new observations behind save or discard while edits are dirty', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=workbench-token; path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : trace
        )
      )
    );
    const { store } = await seededStore();
    const router = await renderWorkbench(store);

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Unsaved alpha' },
    });
    expect(screen.getByLabelText('Current workspace')).toBeDisabled();

    await act(async () => {
      await router.navigate({ to: '/network/history' });
    });
    expect(await screen.findByRole('button', { name: /Beta network.*0 nodes/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Beta network.*0 nodes/i }));
    expect(screen.getByRole('button', { name: /Alpha network.*0 nodes/i })).toHaveClass(
      'is-active'
    );

    await act(async () => {
      await router.navigate({ to: '/network/path' });
    });
    expect(await screen.findByText('Built in · no elevation')).toBeVisible();
    fireEvent.click(screen.getByLabelText(/authorize these active UDP path probes/i));
    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save trace' }));

    expect(
      await screen.findByText(
        'Save or discard the current map edits before saving a new path observation.'
      )
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save trace' })).toBeEnabled();
    const listed = await store.list();
    expect(listed.error).toBeNull();
    expect(listed.value).toHaveLength(2);
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Alpha network' });
  });

  it('does not let a delayed save overwrite a newer edit or clear its dirty state', async () => {
    const { persistence, store } = await seededStore();
    await renderWorkbench(store);
    const barrier = deferred();
    persistence.putBarrier = barrier.promise;
    const name = screen.getByLabelText('Workspace name');

    fireEvent.change(name, { target: { value: 'First edit' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    fireEvent.change(name, { target: { value: 'Newer unsaved edit' } });

    expect(name).toHaveValue('Newer unsaved edit');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    barrier.resolve();

    expect(
      await screen.findByText('Saved edits to First edit. Newer edits remain unsaved.')
    ).toBeVisible();
    expect(name).toHaveValue('Newer unsaved edit');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save edits' })).toBeEnabled();
    expect((await store.get('alpha')).value).toMatchObject({ name: 'First edit' });

    persistence.putBarrier = null;
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText('Saved edits to Newer unsaved edit.')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText(/Unsaved map edits stay in this tab/i)).not.toBeInTheDocument()
    );
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Newer unsaved edit' });
  });

  it('reports a delayed failed save without advancing the local edit base', async () => {
    const { persistence, store } = await seededStore();
    await renderWorkbench(store);
    const writeStarted = deferred();
    const writeBarrier = deferred();
    persistence.onPut = writeStarted.resolve;
    persistence.putBarrier = writeBarrier.promise;
    const putSpy = vi.spyOn(store, 'put');
    const name = screen.getByLabelText('Workspace name');

    fireEvent.change(name, { target: { value: 'Failed save draft' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await writeStarted.promise;
    fireEvent.change(name, { target: { value: 'Newer edit after failed save' } });
    persistence.records.delete('alpha');
    await act(async () => {
      writeBarrier.resolve();
      await store.list();
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        /Workspace alpha changed before this operation completed.*Newer edits remain unsaved/i
      )
    ).toBeVisible();
    expect(name).toHaveValue('Newer edit after failed save');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Alpha network' });

    persistence.putBarrier = null;
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(putSpy.mock.calls[1]?.[1]?.expectedPrevious).toMatchObject({ name: 'Alpha network' });
  });

  it('keeps the committed save base when a newer edit arrives during metadata refresh', async () => {
    const { store } = await seededStore();
    await renderWorkbench(store);
    const listStarted = deferred();
    const listBarrier = deferred();
    const listFinished = deferred();
    const originalList = store.list.bind(store);
    let blockNextList = true;
    vi.spyOn(store, 'list').mockImplementation(async () => {
      if (!blockNextList) return originalList();
      blockNextList = false;
      listStarted.resolve();
      await listBarrier.promise;
      const result = await originalList();
      listFinished.resolve();
      return result;
    });
    const name = screen.getByLabelText('Workspace name');

    fireEvent.change(name, { target: { value: 'Committed edit' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await listStarted.promise;
    fireEvent.change(name, { target: { value: 'Edited during refresh' } });
    await act(async () => {
      listBarrier.resolve();
      await listFinished.promise;
    });

    expect(
      await screen.findByText('Saved edits to Committed edit. Newer edits remain unsaved.')
    ).toBeVisible();
    expect(name).toHaveValue('Edited during refresh');
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Committed edit' });

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByText('Saved edits to Edited during refresh.')).toBeVisible();
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Edited during refresh' });
  });

  it('blocks routes outside the workbench until the user stays or explicitly leaves', async () => {
    const { store } = await seededStore();
    const router = await renderWorkbench(store);
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Unsaved before leaving' },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Leave workbench' }));
    const firstDialog = await screen.findByRole('alertdialog', {
      name: 'Leave with unsaved map edits?',
    });
    expect(router.state.location.pathname).toBe('/network/map');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(firstDialog).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/network/map');
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Unsaved before leaving');

    fireEvent.click(screen.getByRole('link', { name: 'Leave workbench' }));
    await screen.findByRole('alertdialog', { name: 'Leave with unsaved map edits?' });
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));

    expect(await screen.findByRole('heading', { name: 'Outside the workbench' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/outside');
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Alpha network' });
  });

  it('allows true network child routes but blocks a similar outside prefix while dirty', async () => {
    const { store } = await seededStore();
    const router = await renderWorkbench(store);
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Unsaved internal navigation' },
    });

    await act(async () => {
      await router.navigate({ to: '/network/history' });
    });
    expect(await screen.findByRole('heading', { name: 'Network history' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/history');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Similar route prefix' }));

    expect(
      await screen.findByRole('alertdialog', { name: 'Leave with unsaved map edits?' })
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/history');
    expect(
      screen.queryByRole('heading', { name: 'Similar route outside the workbench' })
    ).not.toBeInTheDocument();
  });

  it('ignores a late workspace selection after the current map is edited', async () => {
    const { store } = await seededStore();
    await renderWorkbench(store);
    const pendingGet = deferNextWorkspaceGet(store, 'beta');

    fireEvent.change(screen.getByLabelText('Current workspace'), {
      target: { value: 'beta' },
    });
    await pendingGet.started.promise;
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local alpha edit' },
    });
    await act(async () => {
      pendingGet.barrier.resolve();
      await pendingGet.finished.promise;
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local alpha edit');
    expect(screen.getByLabelText('Current workspace')).toHaveValue('alpha');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect(screen.queryByText(/Saved workspace beta was not found/i)).not.toBeInTheDocument();
  });

  it('ignores a deferred file import after the current map is edited', async () => {
    const { store } = await seededStore();
    const router = await renderWorkbench(store);
    const content = deferredValue<string>();
    const file = new File([], 'gamma.protopeek-network.json', { type: 'application/json' });
    const readText = vi.fn(() => content.promise);
    const putSpy = vi.spyOn(store, 'put');
    Object.defineProperty(file, 'text', { value: readText });

    fireEvent.change(screen.getByLabelText('Import network workspace'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(readText).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit during import' },
    });
    await act(async () => {
      content.resolve(
        serializeNetworkWorkspace(workspace('gamma', 'Gamma imported', '2026-08-21T06:00:00.000Z'))
      );
      await content.promise;
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit during import');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect((await store.get('gamma')).value).toBeNull();
    expect(putSpy).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/network/map');
    expect(screen.queryByText(/Imported lossless/i)).not.toBeInTheDocument();
  });

  it('ignores a late Path workspace lookup after the current map is edited', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=workbench-token; path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : trace
        )
      )
    );
    const { store } = await seededStore();
    const router = await renderWorkbench(store);
    const pendingGet = deferNextWorkspaceGet(store, 'beta');
    const putSpy = vi.spyOn(store, 'put');

    await act(async () => {
      await router.navigate({ to: '/network/path' });
    });
    fireEvent.click(await screen.findByLabelText(/authorize these active UDP path probes/i));
    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save trace' }));
    await pendingGet.started.promise;
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit during path lookup' },
    });
    await act(async () => {
      pendingGet.barrier.resolve();
      await pendingGet.finished.promise;
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit during path lookup');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect((await store.list()).value).toHaveLength(2);
    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved .* as a network workspace/i)).not.toBeInTheDocument();
  });

  it('ignores a late Local workspace lookup after the current map is edited', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=workbench-token; path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities')
            ? localCapabilities
            : localDiscovery
        )
      )
    );
    const { store } = await seededStore();
    const router = await renderWorkbench(store);
    const pendingGet = deferNextWorkspaceGet(store, 'beta');
    const putSpy = vi.spyOn(store, 'put');

    await act(async () => {
      await router.navigate({ to: '/network/local' });
    });
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: /I am authorized to probe this private CIDR/i,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save snapshot' }));
    await pendingGet.started.promise;
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit during snapshot lookup' },
    });
    await act(async () => {
      pendingGet.barrier.resolve();
      await pendingGet.finished.promise;
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Workspace name')).toHaveValue(
      'Local edit during snapshot lookup'
    );
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect((await store.list()).value).toHaveLength(2);
    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved .* as a network workspace/i)).not.toBeInTheDocument();
  });

  it('requires a second explicit action before replacing the current map from history', async () => {
    const persistence = new ControlledPersistence();
    const store = new NetworkStore(persistence);
    const current = restorableWorkspace();
    await store.put(current);
    const router = createTestRouter(store, '/network/history');
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Original scan')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Use as current map' }));

    expect(
      await screen.findByText(
        'Press confirm restore to replace the editable current map. Immutable snapshots remain available.'
      )
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm restore current map' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/history');
    expect((await store.get('alpha')).value?.nodes[0]?.label).toBe('Current annotated host');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore current map' }));

    expect(await screen.findByRole('heading', { name: 'Network evidence map' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/map');
    const restored = (await store.get('alpha')).value;
    expect(restored?.nodes[0]?.label).toBe('Original observed host');
    expect(restored?.snapshots).toHaveLength(1);
    expect(restored?.snapshots[0]?.nodes[0]?.label).toBe('Original observed host');
  });

  it('keeps a newer local edit when a confirmed restore write finishes late', async () => {
    const persistence = new ControlledPersistence();
    const store = new NetworkStore(persistence);
    await store.put(restorableWorkspace());
    const router = createTestRouter(store, '/network/history');
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Original scan')).toBeVisible();
    const writeStarted = deferred();
    const writeBarrier = deferred();
    persistence.onPut = writeStarted.resolve;
    persistence.putBarrier = writeBarrier.promise;

    fireEvent.click(screen.getByRole('button', { name: 'Use as current map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore current map' }));
    await writeStarted.promise;
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit after restore began' },
    });
    await act(async () => {
      writeBarrier.resolve();
      await store.get('alpha');
      await Promise.resolve();
    });
    const restored = (await store.get('alpha')).value;

    expect(restored?.nodes[0]?.label).toBe('Original observed host');
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit after restore began');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/map');
    expect(
      screen.getByText('Restored the snapshot as the current map. Newer edits remain unsaved.')
    ).toBeVisible();

    persistence.putBarrier = null;
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(
      await screen.findByText(/Workspace alpha changed before this operation completed/)
    ).toBeVisible();
    expect((await store.get('alpha')).value?.nodes[0]?.label).toBe('Original observed host');
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit after restore began');
  });

  it('keeps a newer workspace selection when a confirmed restore write finishes late', async () => {
    const persistence = new ControlledPersistence();
    const store = new NetworkStore(persistence);
    await store.put(restorableWorkspace());
    await store.put(workspace('beta', 'Beta network', '2026-08-21T04:00:00.000Z'));
    const router = createTestRouter(store, '/network/history');
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Original scan')).toBeVisible();
    const writeStarted = deferred();
    const writeBarrier = deferred();
    persistence.onPut = writeStarted.resolve;
    persistence.putBarrier = writeBarrier.promise;

    fireEvent.click(screen.getByRole('button', { name: 'Use as current map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore current map' }));
    await writeStarted.promise;
    const beta = screen.getByRole('button', { name: /Beta network.*0 nodes/i });
    fireEvent.click(beta);
    await act(async () => {
      writeBarrier.resolve();
      await store.get('alpha');
    });

    await waitFor(() => expect(beta).toHaveClass('is-active'));
    expect(screen.getByRole('region', { name: 'Beta network snapshots' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/network/history');
    expect((await store.get('alpha')).value?.nodes[0]?.label).toBe('Original observed host');
    expect(screen.queryByText('Restored the snapshot as the current map.')).not.toBeInTheDocument();
  });

  it('does not let a late delete clear or replace a newer dirty view', async () => {
    const { persistence, store } = await seededStore();
    const router = await renderWorkbench(store, '/network/history');
    const deleteStarted = deferred();
    const deleteBarrier = deferred();
    persistence.onDelete = deleteStarted.resolve;
    persistence.deleteBarrier = deleteBarrier.promise;

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await deleteStarted.promise;
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit after delete began' },
    });
    await act(async () => {
      deleteBarrier.resolve();
      await store.get('alpha');
      await Promise.resolve();
    });

    expect((await store.get('alpha')).value).toBeNull();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit after delete began');
    expect(screen.getByLabelText('Current workspace')).toHaveValue('alpha');
    expect(screen.getByText(/Unsaved map edits stay in this tab/i)).toBeVisible();
    expect(
      screen.getByText(
        'Workspace removed from this browser profile. This cannot be undone here. Newer edits remain unsaved.'
      )
    ).toBeVisible();
    expect(
      screen.queryByText('Workspace removed from this browser profile. This cannot be undone here.')
    ).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/network/history' });
    });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    persistence.deleteBarrier = null;
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(
      await screen.findByText(/Workspace alpha changed before this operation completed/)
    ).toBeVisible();
  });

  it('does not report a failed stale delete as a successful removal', async () => {
    const { persistence, store } = await seededStore();
    const router = await renderWorkbench(store, '/network/history');
    const deleteStarted = deferred();
    const deleteBarrier = deferred();
    persistence.onDelete = deleteStarted.resolve;
    persistence.deleteBarrier = deleteBarrier.promise;

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await deleteStarted.promise;
    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Local edit during failed delete' },
    });
    persistence.deleteError = new Error('Injected delete failure.');
    await act(async () => {
      deleteBarrier.resolve();
      await store.list();
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        /Workspace alpha was not deleted because browser storage failed.*Newer edits remain unsaved/i
      )
    ).toBeVisible();
    expect(
      screen.queryByText(/Workspace removed from this browser profile/i)
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Local edit during failed delete');
    expect((await store.get('alpha')).value).toMatchObject({ name: 'Alpha network' });
    expect(
      screen.getByText(
        /Network workspaces are session-only because browser storage is unavailable/i
      )
    ).toBeVisible();
    await act(async () => {
      await router.navigate({ to: '/network/history' });
    });
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
  });

  it('lets a Gamma import supersede late initialization without leaving the view loading', async () => {
    const persistence = new ControlledPersistence();
    const seedStore = new NetworkStore(persistence);
    await seedStore.put(workspace('alpha', 'Alpha network', '2026-08-21T05:00:00.000Z'));
    const openBarrier = deferred();
    persistence.openBarrier = openBarrier.promise;
    const store = new NetworkStore(persistence);
    const openSpy = vi.spyOn(persistence, 'open');
    const router = createTestRouter(store);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(openSpy).toHaveBeenCalledOnce());
    const gamma = workspace('gamma', 'Gamma imported', '2026-08-21T03:00:00.000Z');
    const file = new File([], 'gamma.protopeek-network.json', { type: 'application/json' });
    const readText = vi.fn(async () => serializeNetworkWorkspace(gamma));
    Object.defineProperty(file, 'text', { value: readText });

    fireEvent.change(screen.getByLabelText('Import network workspace'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(readText).toHaveBeenCalledOnce());
    await act(async () => {
      openBarrier.resolve();
      await store.get('gamma');
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Workspace name')).toHaveValue('Gamma imported')
    );
    expect(screen.getByLabelText('Workspace name')).toBeEnabled();
    expect(screen.getByLabelText('Current workspace')).toHaveValue('gamma');
    expect(screen.queryByText(/Loading saved workspaces/i)).not.toBeInTheDocument();
    expect((await store.get('gamma')).value).toMatchObject({ name: 'Gamma imported' });
    expect(router.state.location.pathname).toBe('/network/map');
  });

  it('clears initialization loading after an invalid import supersedes it', async () => {
    const persistence = new ControlledPersistence();
    const openBarrier = deferred();
    persistence.openBarrier = openBarrier.promise;
    const store = new NetworkStore(persistence);
    const openSpy = vi.spyOn(persistence, 'open');
    const router = createTestRouter(store);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(openSpy).toHaveBeenCalledOnce());
    const file = new File([], 'invalid.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn(async () => '{invalid') });

    fireEvent.change(screen.getByLabelText('Import network workspace'), {
      target: { files: [file] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/JSON is malformed/i);
    await act(async () => {
      openBarrier.resolve();
      await store.initialize();
    });

    expect(await screen.findByRole('heading', { name: 'No saved network evidence' })).toBeVisible();
    expect(screen.queryByText(/Loading saved workspaces/i)).not.toBeInTheDocument();
  });

  it('accepts an explicit CIDR but rejects malformed CIDR and out-of-range VLAN groups', async () => {
    const { store } = await seededStore();
    await renderWorkbench(store);
    const groupSummary = screen.getByText('Add an organizational group');
    const groupEditor = groupSummary.closest('details');
    if (!groupEditor) throw new Error('Expected the organizational group editor.');
    fireEvent.click(groupSummary);
    await waitFor(() => expect(groupEditor).toHaveAttribute('open'));
    fireEvent.change(screen.getByLabelText(/^Name$/), {
      target: { value: 'Payments subnet' },
    });
    const detail = screen.getByLabelText('CIDR');
    const addGroup = screen.getByRole('button', { name: 'Add group' });

    fireEvent.change(detail, { target: { value: '10.20.0.999/24' } });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'CIDR must be an explicit IPv4 or IPv6 prefix, such as 10.20.0.0/24.'
    );
    expect(addGroup).toBeDisabled();

    fireEvent.change(detail, { target: { value: '10.20.0.0/24' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(addGroup).toBeEnabled();
    fireEvent.click(addGroup);
    expect(screen.getByText(/1 groups · manual evidence/i)).toBeVisible();

    await waitFor(() => expect(groupEditor).not.toHaveAttribute('open'));
    fireEvent.click(groupSummary);
    await waitFor(() => expect(groupEditor).toHaveAttribute('open'));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vlan' } });
    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'Edge VLAN' } });
    const vlanID = screen.getByLabelText('VLAN ID');

    for (const invalid of ['0', '4095']) {
      fireEvent.change(vlanID, { target: { value: invalid } });
      expect(screen.getByText('VLAN ID must be a whole number from 1 through 4094.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled();
    }
    fireEvent.change(vlanID, { target: { value: '4094' } });
    expect(screen.queryByText('VLAN ID must be a whole number from 1 through 4094.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add group' })).toBeEnabled();
  });
});
