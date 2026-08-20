import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapResponse, SavedCollection, WorkspaceTargetProfile } from '@/shared/types';
import { appStorageKeys, workspaceImportMaxBytes } from '@/shared/utils';

import { App } from './App';
import type { ScanResult } from './api';
import { protocolShellEvents } from './ProtocolShellContext';

const launcherBootstrap: BootstrapResponse = {
  appName: 'ProtoPeek',
  version: 'test',
  target: 'Choose a gRPC target',
  launcherMode: true,
  initialScanTarget: '',
  basePath: '/',
  docsURL: '',
  repoURL: '',
  learnURL: '',
  grpcWebURL: '',
  debuggingURL: '',
  authorName: '',
  authorURL: '',
  defaultMetadata: [],
  targetDefaults: {
    address: '',
    plaintext: true,
    insecure: false,
    authority: '',
    cacertPath: '',
    certPath: '',
    keyPath: '',
    schemaSource: 'reflection',
    protoFiles: [],
    importPaths: [],
    protosets: [],
  },
  grpcurlOptions: '',
  services: [],
};

const directMethod = {
  name: 'Echo',
  fullName: 'demo.Echo/Echo',
  description: '',
  clientStreaming: false,
  serverStreaming: false,
  requestType: 'demo.EchoRequest',
  responseType: 'demo.EchoResponse',
};

const directBootstrap: BootstrapResponse = {
  ...launcherBootstrap,
  target: 'localhost:50051',
  launcherMode: false,
  services: [{ name: 'demo.Echo', description: '', methods: [directMethod] }],
};

const directSchema = {
  requestType: 'demo.EchoRequest',
  requestStream: false,
  messageTypes: { 'demo.EchoRequest': [] },
  enumTypes: {},
};

function response(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function installLauncherFetch({
  connectOK,
  scanResults = [],
  bootstrap = launcherBootstrap,
  connectedBootstrap = launcherBootstrap,
}: {
  connectOK: boolean;
  scanResults?: unknown[];
  bootstrap?: BootstrapResponse;
  connectedBootstrap?: BootstrapResponse;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/bootstrap')) return response(bootstrap);
    if (path.endsWith('/examples')) return response([]);
    if (path.endsWith('/api/scan')) return response(scanResults);
    if (path.endsWith('/api/workspace/connect')) {
      return connectOK
        ? response({ sessionId: 'session-1', bootstrap: connectedBootstrap })
        : response('connection refused', false);
    }
    if (path.endsWith('/api/workspace/metadata')) return response(directSchema);
    if (path.endsWith('/api/workspace/protos')) return response({ files: [] });
    if (path.endsWith('/api/workspace/session') && init?.method === 'DELETE') {
      return response(null);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function installDirectFetch() {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/bootstrap')) return response(directBootstrap);
    if (path.endsWith('/examples')) return response([]);
    if (path.endsWith('/metadata')) return response(directSchema);
    if (path.endsWith('/api/protos')) return response({ files: [] });
    if (path.includes('/invoke/')) {
      return response({ headers: [], responses: [], requests: null, trailers: [], error: null });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function savedCollection(overrides: Partial<SavedCollection> = {}): SavedCollection {
  return {
    id: 'saved-1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    name: 'Saved replay',
    notes: '',
    service: 'demo.Echo',
    method: directMethod.fullName,
    metadata: [],
    timeoutSeconds: 15,
    requestText: '{}',
    ...overrides,
  };
}

function savedTarget(
  id: string,
  address = `${id}.test:50051`,
  overrides: Partial<WorkspaceTargetProfile> = {}
): WorkspaceTargetProfile {
  return {
    id,
    name: id,
    notes: '',
    updatedAt: '2026-08-20T00:00:00.000Z',
    address,
    plaintext: true,
    insecure: false,
    authority: '',
    cacertPath: '',
    certPath: '',
    keyPath: '',
    schemaSource: 'reflection',
    protoFiles: [],
    importPaths: [],
    protosets: [],
    ...overrides,
  };
}

function reflectedTarget(address: string): ScanResult {
  return {
    address,
    alive: true,
    tcp: true,
    grpc: true,
    http: false,
    protocols: ['tcp', 'grpc'],
    reflection: 'available',
    transport: 'plaintext',
    services: ['demo.Echo'],
    httpTransport: '',
    httpProtocol: '',
    httpStatus: '',
    httpStatusCode: 0,
    httpServer: '',
    failure: '',
    error: '',
    details: ['gRPC plaintext: reflection available'],
    latencyMs: 2,
  };
}

function workspaceFile(
  input: HTMLInputElement,
  text: string,
  size = new TextEncoder().encode(text).length
) {
  const read = vi.fn(async () => text);
  const file = {
    name: 'workspace.json',
    size,
    type: 'application/json',
    text: read,
  } as unknown as File;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
  return read;
}

function deferredWorkspaceFile(input: HTMLInputElement, text: string) {
  let resolveRead: ((value: string) => void) | undefined;
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
  );
  const file = {
    name: 'workspace.json',
    size: new TextEncoder().encode(text).length,
    type: 'application/json',
    text: read,
  } as unknown as File;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
  return {
    read,
    resolve() {
      if (!resolveRead) throw new Error('Workspace file read was not started.');
      resolveRead(text);
    },
  };
}

function installDeferredConnectionFetch() {
  let resolveConnect: ((value: Response) => void) | undefined;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
    if (path.endsWith('/examples')) return Promise.resolve(response([]));
    if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
    if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
    if (path.endsWith('/api/workspace/connect')) {
      return new Promise<Response>((resolve) => {
        resolveConnect = resolve;
      });
    }
    if (path.endsWith('/api/workspace/metadata')) return Promise.resolve(response(directSchema));
    if (path.endsWith('/api/workspace/protos')) return Promise.resolve(response({ files: [] }));
    if (path.endsWith('/api/workspace/session') && init?.method === 'DELETE') {
      return Promise.resolve(response(null));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return {
    fetchMock,
    resolveConnect(sessionId: string) {
      if (!resolveConnect) throw new Error('Workspace connection was not started.');
      resolveConnect(
        response({
          sessionId,
          bootstrap: { ...directBootstrap, launcherMode: false },
        })
      );
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('gRPC launcher recents', () => {
  it('renders startup recovery controls in launcher mode without overwriting the source', async () => {
    const raw = JSON.stringify({ malformed: true });
    window.localStorage.setItem(appStorageKeys.collections, raw);
    vi.stubGlobal('fetch', installLauncherFetch({ connectOK: false }));
    render(<App />);

    expect(await screen.findByText('Workspace storage needs recovery')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download originals' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use recovered data' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Open a gRPC target.' })).toBeVisible();
    expect(window.localStorage.getItem(appStorageKeys.collections)).toBe(raw);
  });

  it('invalidates a pending connection on unmount and closes a late server session', async () => {
    let resolveConnect: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(launcherBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/api/workspace/connect')) {
        return new Promise<Response>((resolve) => {
          resolveConnect = resolve;
        });
      }
      if (path.endsWith('/api/workspace/session')) return Promise.resolve(response(null));
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<App />);
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([request]) => String(request).includes('/api/workspace/connect'))
      ).toBe(true)
    );
    const connectCall = fetchMock.mock.calls.find(([request]) =>
      String(request).includes('/api/workspace/connect')
    );
    const signal = connectCall?.[1]?.signal as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true);
    resolveConnect?.(
      response({
        sessionId: 'late-session',
        bootstrap: { ...directBootstrap, launcherMode: false },
      })
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([request, init]) => {
          const value = String(request);
          return (
            value.includes('/api/workspace/session') &&
            value.includes('late-session') &&
            init?.method === 'DELETE'
          );
        })
      ).toBe(true)
    );
    expect(window.localStorage.getItem(appStorageKeys.targets)).toBe('[]');
  });

  it('automatically probes a bounded positional CLI target', async () => {
    const fetchMock = installLauncherFetch({
      connectOK: false,
      bootstrap: { ...launcherBootstrap, initialScanTarget: 'localhost' },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByLabelText('Scan target')).toHaveValue('localhost');
    await waitFor(() => {
      const scanCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/scan'));
      expect(scanCall).toBeTruthy();
      expect(JSON.parse(String(scanCall?.[1]?.body))).toMatchObject({
        addresses: ['localhost'],
        explicit: true,
      });
    });
  });

  it('does not persist a target when connection fails', async () => {
    vi.stubGlobal('fetch', installLauncherFetch({ connectOK: false }));
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await screen.findByText('connection refused');
    expect(JSON.parse(window.localStorage.getItem(appStorageKeys.targets) ?? '[]')).toEqual([]);
  });

  it('refuses a 51st target without evicting a successful connection', async () => {
    const full = Array.from({ length: 50 }, (_, index) => savedTarget(`target-${index}`));
    window.localStorage.setItem(appStorageKeys.targets, JSON.stringify(full));
    vi.stubGlobal('fetch', installLauncherFetch({ connectOK: true }));
    render(<App />);

    const address = await screen.findByLabelText('Address');
    fireEvent.change(address, { target: { value: 'new-target.test:50051' } });
    const connectPanel = address.closest('section');
    expect(connectPanel).not.toBeNull();
    if (!connectPanel) return;
    fireEvent.click(within(connectPanel).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Target was not saved')).toBeVisible();
    expect(screen.getByText(/50-item limit/i)).toBeVisible();
    const stored = JSON.parse(
      window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
    ) as WorkspaceTargetProfile[];
    expect(stored).toHaveLength(50);
    expect(stored.map((target) => target.id)).toEqual(full.map((target) => target.id));
  });

  it('opens a reflected plaintext discovery result and persists it after success', async () => {
    const fetchMock = installLauncherFetch({
      connectOK: true,
      scanResults: [
        {
          address: '127.0.0.1:50051',
          alive: true,
          grpc: true,
          reflection: 'available',
          transport: 'plaintext',
          services: ['demo.Echo'],
          latencyMs: 2,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'gRPC' }));
    await screen.findByText('1 recent');

    const connectCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/workspace/connect')
    );
    expect(connectCall).toBeTruthy();
    const sent = JSON.parse(String(connectCall?.[1]?.body)) as {
      target: { address: string; plaintext: boolean };
    };
    expect(sent.target).toMatchObject({ address: '127.0.0.1:50051', plaintext: true });

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
      ) as Array<{ address: string }>;
      expect(stored).toHaveLength(1);
      expect(stored[0]?.address).toBe('127.0.0.1:50051');
    });
  });

  it('reuses a matching recent target instead of creating a duplicate', async () => {
    window.localStorage.setItem(
      appStorageKeys.targets,
      JSON.stringify([
        {
          id: 'existing-target',
          name: 'Echo',
          notes: '',
          updatedAt: '2026-08-20T00:00:00.000Z',
          address: '127.0.0.1:50051',
          plaintext: true,
          insecure: false,
          authority: '',
          cacertPath: '',
          certPath: '',
          keyPath: '',
          schemaSource: 'reflection',
          protoFiles: [],
          importPaths: [],
          protosets: [],
        },
      ])
    );
    vi.stubGlobal(
      'fetch',
      installLauncherFetch({
        connectOK: true,
        scanResults: [
          {
            address: '127.0.0.1:50051',
            alive: true,
            grpc: true,
            reflection: 'available',
            transport: 'plaintext',
            services: ['demo.Echo'],
            latencyMs: 2,
          },
        ],
      })
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'gRPC' }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
      ) as Array<{ id: string }>;
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe('existing-target');
    });
  });

  it('accepts a discovery handoff while the gRPC workbench is already mounted', async () => {
    const fetchMock = installLauncherFetch({ connectOK: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Open a gRPC target.' });

    const result: ScanResult = {
      address: '127.0.0.1:50052',
      alive: true,
      tcp: true,
      grpc: true,
      http: false,
      protocols: ['tcp', 'grpc'],
      reflection: 'available',
      transport: 'plaintext',
      services: ['demo.Echo'],
      httpTransport: '',
      httpProtocol: '',
      httpStatus: '',
      httpStatusCode: 0,
      httpServer: '',
      failure: '',
      error: '',
      details: ['gRPC plaintext: reflection available'],
      latencyMs: 2,
    };
    window.localStorage.setItem(
      appStorageKeys.pendingGRPCTarget,
      JSON.stringify({ address: result.address, plaintext: true })
    );
    fireEvent(
      window,
      new CustomEvent<ScanResult>(protocolShellEvents.openGRPCDiscovery, { detail: result })
    );

    await waitFor(() => {
      const connectCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/api/workspace/connect')
      );
      expect(connectCall).toBeTruthy();
      const sent = JSON.parse(String(connectCall?.[1]?.body)) as {
        target: { address: string };
      };
      expect(sent.target.address).toBe('127.0.0.1:50052');
    });
    expect(window.localStorage.getItem(appStorageKeys.pendingGRPCTarget)).toBeNull();
  });
});

describe('gRPC replay safety', () => {
  it('applies same-method replay immediately and never invokes persisted redaction markers', async () => {
    window.localStorage.setItem(
      appStorageKeys.collections,
      JSON.stringify([
        savedCollection({
          name: 'Redacted replay',
          requestText: '{"from":"saved"}',
          metadata: [
            { name: 'authorization', value: '[redacted]' },
            { name: 'x-request-id', value: 'request-1' },
          ],
        }),
      ])
    );
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });

    fireEvent.change(screen.getByLabelText('Request JSON'), {
      target: { value: '{"stale":true}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Redacted replay/ }));

    expect(screen.getByLabelText('Request JSON')).toHaveValue('{"from":"saved"}');
    expect(screen.getByText(/redacted metadata value was left blank/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Metadata/ }));
    expect(screen.getByLabelText('Metadata value 1')).toHaveValue('');
    expect(screen.getByLabelText('Metadata value 2')).toHaveValue('request-1');

    fireEvent.click(
      within(screen.getByRole('region', { name: 'Echo call workspace' })).getByRole('button', {
        name: /^Invoke/,
      })
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/invoke/'))).toBe(true)
    );
    const invokeCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/invoke/'));
    const payload = JSON.parse(String(invokeCall?.[1]?.body)) as {
      metadata: Array<{ name: string; value: string }>;
    };
    expect(payload.metadata).toEqual([{ name: 'x-request-id', value: 'request-1' }]);
    expect(JSON.stringify(payload)).not.toContain('[redacted]');
    await waitFor(() => {
      const storedHistory = JSON.parse(
        window.localStorage.getItem(appStorageKeys.history) ?? '[]'
      ) as Array<{ targetId?: string; targetAddress: string }>;
      expect(storedHistory[0]).toMatchObject({ targetAddress: 'localhost:50051' });
      expect(storedHistory[0]).not.toHaveProperty('targetId');
    });
  });

  it('refuses absent methods and cross-target records without replacing the console', async () => {
    window.localStorage.setItem(
      appStorageKeys.collections,
      JSON.stringify([
        savedCollection({
          id: 'cross-target',
          name: 'Cross target',
          requestText: '{"cross":true}',
          targetAddress: 'elsewhere:50051',
        }),
        savedCollection({
          id: 'missing-method',
          name: 'Missing method',
          method: 'demo.Missing/Call',
          requestText: '{"missing":true}',
        }),
        savedCollection({
          id: 'orphan-target',
          name: 'Orphan target',
          targetId: 'deleted-without-address',
          requestText: '{"orphan":true}',
        }),
      ])
    );
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.change(screen.getByLabelText('Request JSON'), {
      target: { value: '{"keep":true}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));

    fireEvent.click(screen.getByRole('button', { name: /Cross target/ }));
    expect(screen.getByText(/different target\/profile/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Missing method/ }));
    expect(screen.getByText(/is not available on the current target/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Orphan target/ }));
    expect(screen.getByText(/saved target profile is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("ProtoPeek couldn't start")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    expect(screen.getByLabelText('Request JSON')).toHaveValue('{"keep":true}');
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/metadata'))
    ).toHaveLength(1);
  });

  it('allows an exact-address fallback when the original target profile was deleted', async () => {
    window.localStorage.setItem(
      appStorageKeys.collections,
      JSON.stringify([
        savedCollection({
          name: 'Deleted profile replay',
          requestText: '{"from":"deleted-profile"}',
          targetId: 'deleted-profile',
          targetAddress: 'localhost:50051',
        }),
      ])
    );
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Deleted profile replay/ }));
    expect(screen.getByLabelText('Request JSON')).toHaveValue('{"from":"deleted-profile"}');
  });

  it('aborts and ignores an in-flight RPC before applying replay', async () => {
    window.localStorage.setItem(
      appStorageKeys.collections,
      JSON.stringify([savedCollection({ name: 'Replace active', requestText: '{"from":"saved"}' })])
    );
    let resolveInvoke: ((value: ReturnType<typeof response>) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes('/invoke/')) {
        return new Promise<ReturnType<typeof response>>((resolve) => {
          resolveInvoke = resolve;
        });
      }
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });

    fireEvent.click(
      within(screen.getByRole('region', { name: 'Echo call workspace' })).getByRole('button', {
        name: /^Invoke/,
      })
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/invoke/'))).toBe(true)
    );
    const invokeCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/invoke/'));
    const invokeSignal = invokeCall?.[1]?.signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Replace active/ }));
    expect(invokeSignal.aborted).toBe(true);
    expect(screen.getByLabelText('Request JSON')).toHaveValue('{"from":"saved"}');

    resolveInvoke?.(
      response({
        headers: [],
        responses: [{ message: { stale: true }, isError: false }],
        requests: null,
        trailers: [],
        error: null,
      })
    );
    await Promise.resolve();
    expect(screen.getByLabelText('Request JSON')).toHaveValue('{"from":"saved"}');
    expect(window.localStorage.getItem(appStorageKeys.history)).toBe('[]');
  });

  it('scopes newly saved requests and reports storage quota failures', async () => {
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });

    fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
    const saved = JSON.parse(
      window.localStorage.getItem(appStorageKeys.collections) ?? '[]'
    ) as SavedCollection[];
    expect(saved[0]).toMatchObject({ targetAddress: 'localhost:50051' });
    expect(saved[0]?.targetId).toBeUndefined();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
    expect(screen.getByText('Request was not saved')).toBeInTheDocument();
    expect(screen.getByText(/Quota exceeded/)).toBeInTheDocument();
  });

  it('retries legacy scope persistence after a browser-storage failure', async () => {
    const legacy = savedCollection({ id: 'retry-legacy', name: 'Retry legacy' });
    window.localStorage.setItem(appStorageKeys.collections, JSON.stringify([legacy]));
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });

    const nativeSetItem = Storage.prototype.setItem;
    let failCollectionWrite = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (failCollectionWrite && key === appStorageKeys.collections) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      nativeSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Retry legacy/ }));
    expect(screen.getByText('Legacy replay was not migrated')).toBeInTheDocument();
    expect(
      (
        JSON.parse(
          window.localStorage.getItem(appStorageKeys.collections) ?? '[]'
        ) as SavedCollection[]
      )[0]?.targetAddress
    ).toBeUndefined();

    failCollectionWrite = false;
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Retry legacy/ }));
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(appStorageKeys.collections) ?? '[]'
      ) as SavedCollection[];
      expect(stored[0]?.targetAddress).toBe('localhost:50051');
    });
  });

  it('refuses a 101st saved request without evicting an existing recipe', async () => {
    const full = Array.from({ length: 100 }, (_, index) =>
      savedCollection({ id: `full-${index}`, name: `Full ${index}` })
    );
    window.localStorage.setItem(appStorageKeys.collections, JSON.stringify(full));
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });

    fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
    expect(screen.getByText('Request was not saved')).toBeInTheDocument();
    expect(screen.getByText(/100-item limit/i)).toBeInTheDocument();
    const stored = JSON.parse(
      window.localStorage.getItem(appStorageKeys.collections) ?? '[]'
    ) as SavedCollection[];
    expect(stored).toHaveLength(100);
    expect(stored.map((entry) => entry.id)).toEqual(full.map((entry) => entry.id));
  });
});

describe('workspace import boundaries', () => {
  const emptyWorkspace = {
    format: 'protopeek-workspace',
    version: 1,
    exportedAt: '2026-08-20T00:00:00.000Z',
    assertions: [],
    collections: [],
    environments: [],
    targets: [],
  };

  it('contains malformed and non-object JSON as non-fatal import errors', async () => {
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    workspaceFile(input, '{');
    expect(await screen.findByText(/Invalid workspace JSON/)).toBeInTheDocument();
    workspaceFile(input, '[]');
    expect(await screen.findByText(/Workspace must be an object/)).toBeInTheDocument();
    expect(screen.queryByText("ProtoPeek couldn't start")).not.toBeInTheDocument();
  });

  it('checks the 4 MiB limit before reading file text', async () => {
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    const read = workspaceFile(input, '{}', workspaceImportMaxBytes + 1);
    expect(await screen.findByText(/exceeds the 4 MiB/)).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps imported targets inactive and warns about ProtoPeek host file-read authority', async () => {
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;
    const workspace = {
      ...emptyWorkspace,
      targets: [
        {
          id: 'imported-target',
          name: 'Imported target',
          notes: '',
          updatedAt: '2026-08-20T00:00:00.000Z',
          address: 'imported:50051',
          plaintext: false,
          insecure: false,
          authority: '',
          cacertPath: '/host/ca.pem',
          certPath: '/host/client.pem',
          keyPath: '/host/client.key',
          schemaSource: 'protoset',
          protoFiles: [],
          importPaths: [],
          protosets: ['/host/schema.protoset'],
        },
      ],
    };

    workspaceFile(input, JSON.stringify(workspace));
    expect(await screen.findByText(/local file-read authority/i)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('/api/workspace/connect'))
    ).toBe(false);
    const targets = JSON.parse(
      window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
    ) as Array<{ id: string; address: string }>;
    expect(targets).toHaveLength(1);
    expect(targets[0]?.address).toBe('imported:50051');
    expect(targets[0]?.id).not.toBe('imported-target');
  });

  it('disconnects an active profile before replacing the imported target set', async () => {
    const fetchMock = installLauncherFetch({
      connectOK: true,
      connectedBootstrap: { ...directBootstrap, launcherMode: false },
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    workspaceFile(input, JSON.stringify(emptyWorkspace));
    expect(await screen.findByText('Workspace imported')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Open a gRPC target.' });
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          String(request).includes('/api/workspace/session') && init?.method === 'DELETE'
      )
    ).toBe(true);
    expect(window.localStorage.getItem(appStorageKeys.activeTargetId)).toBe(JSON.stringify(''));
  });

  it('invalidates a connection started while an imported target set is still being read', async () => {
    const connection = installDeferredConnectionFetch();
    vi.stubGlobal('fetch', connection.fetchMock);
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;
    const importedAddress = 'imported-after-race.test:50051';
    const pendingFile = deferredWorkspaceFile(
      input,
      JSON.stringify({
        ...emptyWorkspace,
        targets: [savedTarget('imported-after-race', importedAddress)],
      })
    );
    expect(pendingFile.read).toHaveBeenCalledOnce();

    fireEvent(
      window,
      new CustomEvent<ScanResult>(protocolShellEvents.openGRPCDiscovery, {
        detail: reflectedTarget('late-connect.test:50051'),
      })
    );
    await waitFor(() =>
      expect(
        connection.fetchMock.mock.calls.some(([request]) =>
          String(request).includes('/api/workspace/connect')
        )
      ).toBe(true)
    );
    const connectCall = connection.fetchMock.mock.calls.find(([request]) =>
      String(request).includes('/api/workspace/connect')
    );
    const signal = connectCall?.[1]?.signal as AbortSignal;

    await act(async () => pendingFile.resolve());
    expect(await screen.findByText('Workspace imported')).toBeVisible();
    expect(signal.aborted).toBe(true);
    connection.resolveConnect('late-after-import');
    await waitFor(() =>
      expect(
        connection.fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).includes('session_id=late-after-import') && init?.method === 'DELETE'
        )
      ).toBe(true)
    );
    const storedTargets = JSON.parse(
      window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
    ) as WorkspaceTargetProfile[];
    expect(storedTargets).toHaveLength(1);
    expect(storedTargets[0]?.address).toBe(importedAddress);
    expect(screen.getByRole('region', { name: 'Echo call workspace' })).toBeVisible();
  });

  it('disconnects a session that finishes while an imported target set is still being read', async () => {
    const connection = installDeferredConnectionFetch();
    vi.stubGlobal('fetch', connection.fetchMock);
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent(
      window,
      new CustomEvent<ScanResult>(protocolShellEvents.openGRPCDiscovery, {
        detail: reflectedTarget('during-read.test:50051'),
      })
    );
    await waitFor(() =>
      expect(
        connection.fetchMock.mock.calls.some(([request]) =>
          String(request).includes('/api/workspace/connect')
        )
      ).toBe(true)
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;
    const importedAddress = 'imported-after-finish.test:50051';
    const pendingFile = deferredWorkspaceFile(
      input,
      JSON.stringify({
        ...emptyWorkspace,
        targets: [savedTarget('imported-after-finish', importedAddress)],
      })
    );

    connection.resolveConnect('finished-during-read');
    await waitFor(() =>
      expect(
        connection.fetchMock.mock.calls.some(([request]) =>
          String(request).includes('/api/workspace/metadata')
        )
      ).toBe(true)
    );
    await act(async () => pendingFile.resolve());
    expect(await screen.findByText('Workspace imported')).toBeVisible();
    await screen.findByRole('region', { name: 'Echo call workspace' });
    await waitFor(() =>
      expect(
        connection.fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).includes('session_id=finished-during-read') && init?.method === 'DELETE'
        )
      ).toBe(true)
    );
    const storedTargets = JSON.parse(
      window.localStorage.getItem(appStorageKeys.targets) ?? '[]'
    ) as WorkspaceTargetProfile[];
    expect(storedTargets).toHaveLength(1);
    expect(storedTargets[0]?.address).toBe(importedAddress);
  });

  it('reports quota failure instead of claiming an import succeeded', async () => {
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    workspaceFile(input, JSON.stringify(emptyWorkspace));
    expect(await screen.findByText('Workspace was not imported')).toBeInTheDocument();
    expect(screen.getByText(/Quota exceeded/)).toBeInTheDocument();
    expect(screen.queryByText('Workspace imported')).not.toBeInTheDocument();
  });

  it('preserves every absent section in a partial legacy import', async () => {
    const originalCollection = savedCollection({ name: 'Keep collection' });
    const originalEnvironment = {
      id: 'environment-1',
      name: 'Keep environment',
      notes: '',
      metadata: [],
      timeoutSeconds: 15,
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    const originalTarget = {
      id: 'target-1',
      name: 'Keep target',
      notes: '',
      updatedAt: '2026-08-20T00:00:00.000Z',
      address: 'localhost:50051',
      plaintext: true,
      insecure: false,
      authority: '',
      cacertPath: '',
      certPath: '',
      keyPath: '',
      schemaSource: 'reflection',
      protoFiles: [],
      importPaths: [],
      protosets: [],
    };
    window.localStorage.setItem(appStorageKeys.collections, JSON.stringify([originalCollection]));
    window.localStorage.setItem(appStorageKeys.environments, JSON.stringify([originalEnvironment]));
    window.localStorage.setItem(appStorageKeys.targets, JSON.stringify([originalTarget]));
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    workspaceFile(input, JSON.stringify({ history: [] }));
    expect(await screen.findByText('Legacy workspace imported safely')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(appStorageKeys.collections) ?? '[]')).toEqual([
      originalCollection,
    ]);
    expect(JSON.parse(window.localStorage.getItem(appStorageKeys.environments) ?? '[]')).toEqual([
      originalEnvironment,
    ]);
    expect(JSON.parse(window.localStorage.getItem(appStorageKeys.targets) ?? '[]')).toEqual([
      originalTarget,
    ]);
    expect(window.localStorage.getItem(appStorageKeys.history)).toBe('[]');
  });

  it('atomically refuses an imported saved request with an unresolved target and no address', async () => {
    const original = savedCollection({ name: 'Keep original' });
    window.localStorage.setItem(appStorageKeys.collections, JSON.stringify([original]));
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    workspaceFile(
      input,
      JSON.stringify({
        collections: [
          savedCollection({
            id: 'orphan-import',
            name: 'Orphan import',
            targetId: 'missing-target',
            targetAddress: undefined,
          }),
        ],
      })
    );
    expect(
      await screen.findByText(/unavailable target and has no address fallback/i)
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(appStorageKeys.collections)).toBe(
      JSON.stringify([original])
    );
  });

  it('atomically refuses an imported request whose profile address conflicts', async () => {
    const original = savedCollection({ id: 'keep-conflict', name: 'Keep original' });
    window.localStorage.setItem(appStorageKeys.collections, JSON.stringify([original]));
    vi.stubGlobal('fetch', installDirectFetch());
    const { container } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;

    workspaceFile(
      input,
      JSON.stringify({
        collections: [
          savedCollection({
            id: 'conflicting-import',
            targetId: 'imported-target',
            targetAddress: 'elsewhere:50051',
          }),
        ],
        targets: [savedTarget('imported-target', 'localhost:50051')],
      })
    );
    expect(
      await screen.findByText(/target address conflicts with profile imported-target/i)
    ).toBeVisible();
    expect(window.localStorage.getItem(appStorageKeys.collections)).toBe(
      JSON.stringify([original])
    );
  });

  it('keeps mixed stored data byte-for-byte until recovered records are explicitly accepted', async () => {
    const valid = savedCollection({ id: 'valid-recovery', name: 'Recovered request' });
    const raw = JSON.stringify([
      valid,
      savedCollection({ id: 'invalid-recovery', createdAt: 'not-a-date' }),
    ]);
    window.localStorage.setItem(appStorageKeys.collections, raw);
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    expect(screen.getByText('Workspace storage needs recovery')).toBeInTheDocument();
    await Promise.resolve();
    expect(window.localStorage.getItem(appStorageKeys.collections)).toBe(raw);

    fireEvent.click(screen.getByRole('button', { name: 'Use recovered data' }));
    expect(await screen.findByText('Recovered workspace accepted')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(appStorageKeys.collections) ?? '[]')).toEqual([
      valid,
    ]);
  });

  it('discards malformed stored workspace arrays instead of crashing startup', async () => {
    for (const key of [
      appStorageKeys.assertions,
      appStorageKeys.collections,
      appStorageKeys.environments,
      appStorageKeys.history,
      appStorageKeys.targets,
    ]) {
      window.localStorage.setItem(key, JSON.stringify({ malformed: true }));
    }
    vi.stubGlobal('fetch', installDirectFetch());
    render(<App />);
    expect(await screen.findByRole('region', { name: 'Echo call workspace' })).toBeInTheDocument();
    expect(screen.queryByText("ProtoPeek couldn't start")).not.toBeInTheDocument();
  });
});
