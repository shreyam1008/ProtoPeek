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
import type { NetworkWorkspaceV1 } from './network-model';
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

class ControlledPersistence implements NetworkStorePersistence {
  readonly records = new Map<string, unknown>();
  putBarrier: Promise<void> | null = null;

  async open(
    _configuration: NetworkStoreConfiguration
  ): Promise<NetworkStorePersistenceConnection> {
    return {
      read: async (maxRecords) => ({
        values: structuredClone([...this.records.values()].slice(0, maxRecords)),
        overflow: this.records.size > maxRecords,
      }),
      put: async (value, expectedWorkspaceJSON) => {
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
  const routeTree = rootRoute.addChildren([
    networkRoute.addChildren(networkChildren),
    outsideRoute,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

async function renderWorkbench(store: NetworkStore, initialEntry = '/network/map') {
  const router = createTestRouter(store, initialEntry);
  render(<RouterProvider router={router} />);
  await screen.findByDisplayValue('Alpha network');
  return router;
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
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

  it('requires a second explicit action before replacing the current map from history', async () => {
    const persistence = new ControlledPersistence();
    const store = new NetworkStore(persistence);
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
    const current = {
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
    } satisfies NetworkWorkspaceV1;
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
