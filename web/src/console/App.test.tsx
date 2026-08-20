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
    servicesTruncated: false,
    httpTransport: '',
    httpProtocol: '',
    httpProtocolTruncated: false,
    httpStatus: '',
    httpStatusTruncated: false,
    httpStatusCode: 0,
    httpServer: '',
    httpServerTruncated: false,
    failure: '',
    error: '',
    errorTruncated: false,
    details: ['gRPC plaintext: reflection available'],
    detailsTruncated: false,
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

function protoFolderFile(name: string, text: string, relativePath: string) {
  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
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
  vi.useRealTimers();
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

  it('cancels an in-flight folder upload while freezing draft mutations and preserving the prior session', async () => {
    let connectCount = 0;
    let resolveReplacement: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(launcherBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/api/scan')) return Promise.resolve(response([]));
      if (path.endsWith('/api/workspace/connect')) {
        connectCount++;
        if (connectCount === 1) {
          return Promise.resolve(
            response({
              sessionId: 'session-old',
              bootstrap: { ...directBootstrap, launcherMode: false },
            })
          );
        }
        return new Promise<Response>((resolve) => {
          resolveReplacement = resolve;
        });
      }
      if (path.endsWith('/api/workspace/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/workspace/protos')) return Promise.resolve(response({ files: [] }));
      if (path.endsWith('/api/workspace/session') && init?.method === 'DELETE') {
        return Promise.resolve(response(null));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage targets' }));

    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'replacement.test:50051' },
    });
    fireEvent.change(screen.getByLabelText('Schema source'), {
      target: { value: 'browser-proto-folder' },
    });
    const folderInput = container.querySelector<HTMLInputElement>('input[webkitdirectory]');
    const proto = protoFolderFile('service.proto', 'service', 'replacement/service.proto');
    Object.defineProperty(folderInput, 'files', { configurable: true, value: [proto] });
    fireEvent.change(folderInput as HTMLInputElement);
    await screen.findByText('replacement');
    const targetPanel = screen.getByLabelText('Address').closest('.space-y-4');
    expect(targetPanel).not.toBeNull();
    fireEvent.click(within(targetPanel as HTMLElement).getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(connectCount).toBe(2));
    const replacementCall = fetchMock.mock.calls.filter(([request]) =>
      String(request).includes('/api/workspace/connect')
    )[1];
    const signal = replacementCall?.[1]?.signal as AbortSignal;
    expect(screen.getByLabelText('Address')).toBeDisabled();
    expect(screen.getByLabelText('Schema source')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete localhost:50051/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel connection' }));

    expect(signal.aborted).toBe(true);
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByLabelText('Address')).toBeEnabled();
    resolveReplacement?.(
      response({
        sessionId: 'session-new-late',
        bootstrap: { ...directBootstrap, target: 'replacement.test:50051' },
      })
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([request, init]) => {
          const url = String(request);
          return (
            url.includes('/api/workspace/session') &&
            url.includes('session-new-late') &&
            init?.method === 'DELETE'
          );
        })
      ).toBe(true)
    );
    expect(
      fetchMock.mock.calls.some(([request, init]) => {
        const url = String(request);
        return (
          url.includes('/api/workspace/session') &&
          url.includes('session-old') &&
          init?.method === 'DELETE'
        );
      })
    ).toBe(false);
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

  it('connects a deterministic browser-folder manifest and persists only a pathless profile', async () => {
    const fetchMock = installLauncherFetch({ connectOK: true });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);

    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.change(screen.getByLabelText('Schema source'), {
      target: { value: 'browser-proto-folder' },
    });
    expect(screen.getByText('Folder required')).toBeVisible();
    expect(screen.getAllByText(/never to the gRPC target/i)).toHaveLength(2);
    expect(
      screen.getByText(/schema snapshots go only to this running ProtoPeek instance/i)
    ).toBeVisible();
    const folderInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][webkitdirectory]'
    );
    const zeta = protoFolderFile('zeta.proto', 'zeta', 'private-checkout/zeta.proto');
    const alpha = protoFolderFile('alpha.proto', 'alpha', 'private-checkout/nested/alpha.proto');
    Object.defineProperty(folderInput, 'files', {
      configurable: true,
      value: [zeta, alpha],
    });
    fireEvent.change(folderInput as HTMLInputElement);
    expect(await screen.findByText('2 proto files · 9 B')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/api/workspace/connect')
      );
      expect(call?.[1]?.body).toBeInstanceOf(FormData);
      const entries = Array.from((call?.[1]?.body as FormData).entries());
      expect(entries.map(([name]) => name)).toEqual(['target', 'manifest', 'file.0', 'file.1']);
      expect(JSON.parse(String(entries[0][1]))).toMatchObject({
        schemaSource: 'browser-proto-folder',
        protoFiles: [],
        importPaths: [],
        protosets: [],
      });
      expect(JSON.parse(String(entries[1][1]))).toEqual({
        version: 1,
        files: [
          { path: 'nested/alpha.proto', size: 5 },
          { path: 'zeta.proto', size: 4 },
        ],
      });
    });
    await screen.findByText('1 recent');
    const stored = JSON.parse(window.localStorage.getItem(appStorageKeys.targets) ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      schemaSource: 'browser-proto-folder',
      protoFiles: [],
      importPaths: [],
      protosets: [],
    });
    expect(stored[0]).not.toHaveProperty('rootName');
    expect(stored[0]).not.toHaveProperty('files');
    expect(JSON.stringify(stored)).not.toContain('private-checkout');
  });

  it('reloads a saved browser-folder profile as Folder required and never reconnects it directly', async () => {
    window.localStorage.setItem(
      appStorageKeys.targets,
      JSON.stringify([
        savedTarget('browser-target', 'localhost:50051', {
          name: 'Browser protos',
          schemaSource: 'browser-proto-folder',
        }),
      ])
    );
    const fetchMock = installLauncherFetch({ connectOK: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect((await screen.findAllByText('Browser folder')).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: 'Repick folder' }));

    expect(screen.getByLabelText('Schema source')).toHaveValue('browser-proto-folder');
    expect(screen.getByText('Folder required')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(
      await screen.findByText(/Choose the proto folder again before connecting/i)
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/api/workspace/connect'))
    ).toBe(false);
  });

  it('disables Connect during replacement and discards a late folder after the source changes', async () => {
    const fetchMock = installLauncherFetch({ connectOK: true });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App />);
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.change(screen.getByLabelText('Schema source'), {
      target: { value: 'browser-proto-folder' },
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const original = protoFolderFile('original.proto', 'old', 'original/original.proto');
    Object.defineProperty(input, 'files', { configurable: true, value: [original] });
    fireEvent.change(input as HTMLInputElement);
    expect(await screen.findByText('original')).toBeVisible();

    let resolveReplacement: ((file: File) => void) | undefined;
    const replacement = new Promise<File>((resolve) => {
      resolveReplacement = resolve;
    });
    const getFile = vi.fn(() => replacement);
    vi.stubGlobal(
      'showDirectoryPicker',
      vi.fn(async () => ({
        kind: 'directory',
        name: 'replacement',
        async *values() {
          yield { kind: 'file', name: 'replacement.proto', getFile };
        },
      }))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace proto folder' }));
    await waitFor(() => expect(getFile).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Schema source'), {
      target: { value: 'reflection' },
    });
    resolveReplacement?.(protoFolderFile('replacement.proto', 'new', 'replacement.proto'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText('Schema source'), {
      target: { value: 'browser-proto-folder' },
    });

    expect(screen.getByText('Folder required')).toBeVisible();
    expect(screen.queryByText('replacement')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('/api/workspace/connect'))
    ).toBe(false);
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
      servicesTruncated: false,
      httpTransport: '',
      httpProtocol: '',
      httpProtocolTruncated: false,
      httpStatus: '',
      httpStatusTruncated: false,
      httpStatusCode: 0,
      httpServer: '',
      httpServerTruncated: false,
      failure: '',
      error: '',
      errorTruncated: false,
      details: ['gRPC plaintext: reflection available'],
      detailsTruncated: false,
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
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open history and saved requests' }));
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

  it('imports browser-folder profiles without snapshots and requires a repick', async () => {
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
        savedTarget('imported-browser-folder', 'localhost:50052', {
          schemaSource: 'browser-proto-folder' as const,
        }),
      ],
    };

    workspaceFile(input, JSON.stringify(workspace));

    expect(
      await screen.findByText(/include no schema snapshot bytes, folder handle/i)
    ).toBeVisible();
    expect(screen.getByText(/must be repicked before connecting/i)).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('/api/workspace/connect'))
    ).toBe(false);
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

describe('unary repeat', () => {
  it('runs the requested calls sequentially with one signal and an explicit deadline', async () => {
    const pending: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        return new Promise<Response>((resolve) => pending.push(resolve));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    await screen.findByRole('heading', { name: 'Unary repeat' });

    fireEvent.change(screen.getByLabelText('Calls'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Per-call deadline in seconds'), {
      target: { value: '1.5' },
    });
    expect(screen.getByRole('button', { name: 'Run repeat' })).toHaveTextContent('Run 3 calls');
    expect(
      screen.getByText(/Every Repeat attempt is a real RPC and may mutate service data/i)
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));

    await waitFor(() => expect(pending).toHaveLength(1));
    const invokeCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'));
    expect(invokeCalls()).toHaveLength(1);
    const firstSignal = invokeCalls()[0]?.[1]?.signal;
    expect(JSON.parse(String(invokeCalls()[0]?.[1]?.body))).toMatchObject({
      timeout_seconds: 1.5,
    });

    await act(async () => {
      pending.shift()?.(
        response({ headers: [], responses: [], requests: null, trailers: [], error: null })
      );
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(invokeCalls()).toHaveLength(2);
    expect(invokeCalls()[1]?.[1]?.signal).toBe(firstSignal);

    await act(async () => {
      pending.shift()?.(
        response({ headers: [], responses: [], requests: null, trailers: [], error: null })
      );
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(invokeCalls()).toHaveLength(3);
    expect(invokeCalls()[2]?.[1]?.signal).toBe(firstSignal);
    await act(async () => {
      pending.shift()?.(
        response({ headers: [], responses: [], requests: null, trailers: [], error: null })
      );
    });

    expect(await screen.findByText('3 of 3 attempts')).toBeVisible();
    expect(screen.getByText('Completed all requested calls.')).toBeVisible();
    expect(window.localStorage.getItem('protopeek.simulation.v1')).toBeNull();
  });

  it('clears an older Invoke loading state when Repeat takes ownership', async () => {
    const invokeSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        invokeSignals.push(init?.signal as AbortSignal);
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<App />);
    const workspace = await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(within(workspace).getByRole('button', { name: /^Invoke/ }));
    await waitFor(() => expect(invokeSignals).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run repeat' }));
    await waitFor(() => expect(invokeSignals).toHaveLength(2));
    expect(invokeSignals[0]?.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    const reopened = await screen.findByRole('region', { name: 'Echo call workspace' });
    expect(within(reopened).getByRole('button', { name: /^Invoke/ })).toBeVisible();
    expect(within(reopened).queryByText(/Waiting for unary/i)).not.toBeInTheDocument();
    unmount();
  });

  it('cancels one active call and preserves completed attempts as partial results', async () => {
    let lateResolve: ((value: Response) => void) | undefined;
    const invokeSignals: AbortSignal[] = [];
    let invocation = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        invocation++;
        invokeSignals.push(init?.signal as AbortSignal);
        if (invocation === 1) {
          return Promise.resolve(
            response({ headers: [], responses: [], requests: null, trailers: [], error: null })
          );
        }
        return new Promise<Response>((resolve) => {
          lateResolve = resolve;
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    await waitFor(() => expect(invokeSignals).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel repeat' }));
    expect(await screen.findByText('2 of 3 attempts')).toBeVisible();
    expect(screen.getByText('Cancelled; partial results preserved.')).toBeVisible();
    expect(invokeSignals[0]).toBe(invokeSignals[1]);
    expect(invokeSignals[1]?.aborted).toBe(true);
    expect(
      within(screen.getByText('OK').parentElement as HTMLElement).getByText('1')
    ).toBeVisible();
    expect(
      within(screen.getByText('Cancelled').parentElement as HTMLElement).getByText('1')
    ).toBeVisible();
    expect(invocation).toBe(2);

    lateResolve?.(
      response({ headers: [], responses: [], requests: null, trailers: [], error: null })
    );
    await act(async () => undefined);
    expect(screen.getByText('2 of 3 attempts')).toBeVisible();
    expect(invocation).toBe(2);
  });

  it('disables assertions and refuses ordinary Invoke while Repeat owns the request', async () => {
    let repeatSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        repeatSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run repeat' }));
    await waitFor(() => expect(repeatSignal).toBeDefined());

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(await screen.findByRole('button', { name: /Invoke current method/ }));

    expect(repeatSignal?.aborted).toBe(false);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'))
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel repeat' })).toBeVisible();
    expect(screen.getByText('Repeat owns this request')).toBeVisible();
    expect(screen.getByText(/Cancel Repeat first, then invoke the RPC/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel repeat' }));
    await screen.findByText('Cancelled; partial results preserved.');
    expect(screen.queryByText(/Cancel Repeat first, then invoke the RPC/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    const workspace = await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(within(workspace).getByRole('button', { name: /^Invoke/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'))
      ).toHaveLength(2)
    );
    expect(within(workspace).getByRole('button', { name: /^Cancel/ })).toBeVisible();
  });

  it('cancels navigation away from an active Repeat and preserves partial evidence', async () => {
    let invocation = 0;
    let repeatSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        invocation++;
        repeatSignal = init?.signal as AbortSignal;
        if (invocation === 1) {
          return Promise.resolve(
            response({ headers: [], responses: [], requests: null, trailers: [], error: null })
          );
        }
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    await waitFor(() => expect(invocation).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    expect(repeatSignal?.aborted).toBe(true);
    expect(await screen.findByText('Recent calls')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    expect(await screen.findByText('2 of 3 attempts')).toBeVisible();
    expect(screen.getByText('Cancelled; partial results preserved.')).toBeVisible();
    expect(
      within(screen.getByText('Cancelled').parentElement as HTMLElement).getByText('1')
    ).toBeVisible();
    expect(invocation).toBe(2);
  });

  it('separates gRPC and relay/transport failures without sending secret sentinels', async () => {
    window.localStorage.setItem(
      appStorageKeys.collections,
      JSON.stringify([
        savedCollection({
          name: 'Repeat safely',
          metadata: [
            { name: 'authorization', value: '[redacted]' },
            { name: 'x-request-id', value: 'repeat-1' },
          ],
        }),
      ])
    );
    let invocation = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(directBootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.includes('/invoke/')) {
        invocation++;
        if (invocation === 1) {
          return response({
            headers: [],
            responses: [],
            requests: null,
            trailers: [],
            error: null,
            timings: { headersMs: 3, firstMessageMs: 7, trailersMs: 10, totalMs: 11 },
          });
        }
        if (invocation === 2) {
          return response({
            headers: [{ name: 'content-type', value: 'application/grpc' }],
            responses: [],
            requests: null,
            trailers: [{ name: 'grpc-status', value: '14' }],
            error: { code: 14, name: 'Unavailable', message: 'backend unavailable', details: [] },
            timings: { headersMs: 4, firstMessageMs: null, trailersMs: 22, totalMs: 23 },
          });
        }
        return response('local relay failed', false);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    fireEvent.click(screen.getByRole('button', { name: /Repeat safely/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));

    expect(await screen.findByText('3 of 3 attempts')).toBeVisible();
    expect(
      within(screen.getByText('gRPC errors').parentElement as HTMLElement).getByText('1')
    ).toBeVisible();
    expect(
      within(screen.getByText('Relay / transport errors').parentElement as HTMLElement).getByText(
        '1'
      )
    ).toBeVisible();
    expect(
      within(screen.getByText('p95').parentElement as HTMLElement).getByText('Needs 20 (2)')
    ).toBeVisible();
    expect(screen.getByText(/ProtoPeek handler invoke \(2 measured calls\)/)).toBeVisible();
    expect(
      screen.getByText(/Handler timing includes JSON\/protobuf conversion and callbacks/i)
    ).toBeVisible();
    const invokeCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/invoke/')
    );
    expect(invokeCalls).toHaveLength(3);
    for (const [, init] of invokeCalls) {
      const sent = JSON.parse(String(init?.body)) as {
        metadata: Array<{ name: string; value: string }>;
      };
      expect(sent.metadata).toEqual([{ name: 'x-request-id', value: 'repeat-1' }]);
      expect(String(init?.body)).not.toContain('[redacted]');
    }
  });

  it('keeps Repeat unavailable for streaming methods', async () => {
    const streamingMethod = { ...directMethod, name: 'Watch', serverStreaming: true };
    const streamingBootstrap = {
      ...directBootstrap,
      services: [{ name: 'demo.Echo', description: '', methods: [streamingMethod] }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(streamingBootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.includes('/invoke/')) {
        return response({ headers: [], responses: [], requests: null, trailers: [], error: null });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Watch call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));

    expect(await screen.findByText('Unary only')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run repeat' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/invoke/'))).toBe(false);
  });

  it('stops at the 60 second aggregate cap and keeps the timed-out attempt', async () => {
    let repeatSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(directBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        repeatSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    await screen.findByRole('heading', { name: 'Unary repeat' });

    const runStartedAt = '2026-08-20T12:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(runStartedAt));
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    expect(repeatSignal).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText('1 of 5 attempts')).toBeVisible();
    expect(
      screen.getByText('Stopped at the 60 second wall cap; partial results preserved.')
    ).toBeVisible();
    expect(repeatSignal?.aborted).toBe(true);
    expect(screen.getByTitle('Repeat run started')).toHaveAttribute('datetime', runStartedAt);
  });

  it('aborts and discards Repeat when the user changes RPC context', async () => {
    const otherMethod = { ...directMethod, name: 'Other', fullName: 'demo.Echo/Other' };
    const twoMethodBootstrap = {
      ...directBootstrap,
      services: [{ name: 'demo.Echo', description: '', methods: [directMethod, otherMethod] }],
    };
    let repeatSignal: AbortSignal | undefined;
    let lateResolve: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return Promise.resolve(response(twoMethodBootstrap));
      if (path.endsWith('/examples')) return Promise.resolve(response([]));
      if (path.endsWith('/metadata')) return Promise.resolve(response(directSchema));
      if (path.endsWith('/api/protos')) return Promise.resolve(response({ files: [] }));
      if (path.includes('/invoke/')) {
        repeatSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          lateResolve = resolve;
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run repeat' }));
    await waitFor(() => expect(repeatSignal).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    expect(repeatSignal?.aborted).toBe(true);
    lateResolve?.(
      response({ headers: [], responses: [], requests: null, trailers: [], error: null })
    );
    expect(await screen.findByRole('region', { name: 'Other call workspace' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    expect(screen.queryByText(/of 5 attempts/)).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'))
    ).toHaveLength(1);
  });

  it('exports raw attempt evidence without the request body or metadata', async () => {
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    let exportedBlob: Blob | undefined;
    let downloadedAs = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return 'blob:repeat';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadedAs = this.download;
    });
    render(<App />);
    const workspace = await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.change(within(workspace).getByLabelText('Request JSON'), {
      target: { value: '{"private":"request-secret"}' },
    });
    fireEvent.click(within(workspace).getByRole('tab', { name: /Metadata/ }));
    fireEvent.click(within(workspace).getByRole('button', { name: 'Bearer auth' }));
    fireEvent.change(within(workspace).getByLabelText('Metadata value 1'), {
      target: { value: 'Bearer metadata-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    await screen.findByText('2 of 2 attempts');
    const disclosure = screen.getByText(/Export includes method, target, run configuration/i);
    expect(disclosure).toHaveTextContent(/timestamps, counts, per-attempt offsets and timings/i);
    expect(disclosure).toHaveTextContent(/error and status text/i);
    expect(disclosure).toHaveTextContent(/Review.*before sharing/i);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    expect(downloadedAs).toMatch(/^protopeek-repeat-Echo-/);
    expect(exportedBlob).toBeDefined();
    const exportedText = await exportedBlob?.text();
    expect(exportedText).toContain('"format": "protopeek-repeat"');
    expect(exportedText).not.toContain('request-secret');
    expect(exportedText).not.toContain('metadata-secret');
    expect(exportedText).not.toContain('metadata');
  });

  it('attributes preserved evidence to its frozen run after controls and requests change', async () => {
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Per-call deadline in seconds'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    await screen.findByText('2 of 2 attempts');

    const createdAt = screen.getByTitle('Repeat run started').getAttribute('datetime');
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(screen.getByText(/2 calls · 0 ms think · 1.5 s deadline/)).toBeVisible();
    expect(screen.getByText(/payload and metadata were snapshotted at run start/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Calls'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Per-call deadline in seconds'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    const workspace = await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(within(workspace).getByRole('button', { name: /^Invoke/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'))
      ).toHaveLength(3)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));

    expect(screen.getByLabelText('Calls')).toHaveValue(3);
    expect(screen.getByLabelText('Per-call deadline in seconds')).toHaveValue(2);
    expect(screen.getByTitle('Repeat run started')).toHaveAttribute('datetime', createdAt);
    expect(screen.getByText(/2 calls · 0 ms think · 1.5 s deadline/)).toBeVisible();
    expect(screen.getByText(/Previous run · controls have changed/i)).toBeVisible();
  });

  it('waits only between sequential calls and never after the final call', async () => {
    const fetchMock = installDirectFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.change(await screen.findByLabelText('Calls'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Think time in milliseconds'), {
      target: { value: '5000' },
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Run repeat' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const invokeCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'));
    expect(invokeCalls()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(invokeCalls()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeCalls()).toHaveLength(2);
    expect(screen.getByText('2 of 2 attempts')).toBeVisible();
    expect(screen.getByText('Completed all requested calls.')).toBeVisible();
  });
});

describe('gRPC Health Check and Watch', () => {
  it('runs reflection-independent Check with sendable live metadata and keeps frozen evidence', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(directBootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.endsWith('/api/health/check')) {
        return response({
          service: 'demo.Echo',
          startedAt: '2026-08-20T12:00:00.000Z',
          handlerInvokeMs: 4.5,
          servingStatus: { code: 1, name: 'SERVING' },
          grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
          headers: [{ name: 'x-backend', value: 'blue' }],
          trailers: [{ name: 'grpc-status', value: '0' }],
          headersTruncated: false,
          trailersTruncated: false,
        });
      }
      throw new Error(`Unexpected request: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const workspace = await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(within(workspace).getByRole('tab', { name: /Metadata/ }));
    fireEvent.click(within(workspace).getByRole('button', { name: 'Bearer auth' }));
    fireEvent.change(within(workspace).getByLabelText('Metadata value 1'), {
      target: { value: 'Bearer health-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use selected service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));

    expect(await screen.findByText('Health Check returned once.')).toBeVisible();
    expect(screen.getByText('SERVING')).toBeVisible();
    expect(screen.getByText(/5 s Check deadline/)).toBeVisible();
    expect(screen.getByText(/1 editor metadata entry/)).toBeVisible();
    expect(screen.getByText(/4.5 ms ProtoPeek handler invoke/)).toBeVisible();
    expect(document.body).not.toHaveTextContent('health-secret');

    const healthCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/health/check')
    );
    expect(JSON.parse(String(healthCall?.[1]?.body))).toEqual({
      service: 'demo.Echo',
      timeout_seconds: 5,
      metadata: [{ name: 'authorization', value: 'Bearer health-secret' }],
    });
  });

  it('gives Watch explicit ownership, refuses Invoke, and preserves partials on navigation', async () => {
    let watchSignal: AbortSignal | undefined;
    let watchController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(directBootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.endsWith('/api/health/watch')) {
        watchSignal = init?.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            watchController = controller;
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }
      if (path.includes('/invoke/')) {
        return response({ headers: [], responses: [], requests: null, trailers: [], error: null });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Watch' }));
    await waitFor(() => expect(watchSignal).toBeDefined());

    const startedAt = '2026-08-20T12:00:00.000Z';
    const frames = [
      {
        type: 'started',
        service: '',
        startedAt,
        observedOffsetMs: 0,
        durationSeconds: 60,
        metadataCount: 0,
      },
      {
        type: 'status-observed',
        service: '',
        startedAt,
        observedOffsetMs: 3,
        sequence: 1,
        servingStatus: { code: 3, name: 'SERVICE_UNKNOWN' },
      },
    ];
    await act(async () => {
      watchController?.enqueue(
        new TextEncoder().encode(`${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`)
      );
    });
    expect((await screen.findAllByText('SERVICE_UNKNOWN'))[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run repeat' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(await screen.findByRole('button', { name: /Invoke current method/ }));
    expect(await screen.findByText(/Cancel Health first/i)).toBeVisible();
    expect(watchSignal?.aborted).toBe(false);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'))
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^History & saved/ }));
    expect(watchSignal?.aborted).toBe(true);
    expect(await screen.findByText('Recent calls')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    expect(await screen.findByText(/Cancelled when you left Checks/i)).toBeVisible();
    expect(screen.getAllByText('SERVICE_UNKNOWN')[0]).toBeVisible();
    expect(screen.queryByText(/Cancel Health first/i)).not.toBeInTheDocument();
  });

  it('aborts an active Watch when the workbench unmounts', async () => {
    let watchSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(directBootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.endsWith('/api/health/watch')) {
        watchSignal = init?.signal as AbortSignal;
        return new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Watch' }));
    await waitFor(() => expect(watchSignal).toBeDefined());

    unmount();

    expect(watchSignal?.aborted).toBe(true);
  });

  it('ignores a late Watch response after the selected method changes', async () => {
    const otherMethod = {
      ...directMethod,
      name: 'Other',
      fullName: 'demo.Echo/Other',
    };
    const bootstrap = {
      ...directBootstrap,
      services: [
        {
          ...directBootstrap.services[0],
          methods: [directMethod, otherMethod],
        },
      ],
    };
    let watchSignal: AbortSignal | undefined;
    let resolveWatch: ((value: Response) => void) | undefined;
    const pendingWatch = new Promise<Response>((resolve) => {
      resolveWatch = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) return response(bootstrap);
      if (path.endsWith('/examples')) return response([]);
      if (path.endsWith('/metadata')) return response(directSchema);
      if (path.endsWith('/api/protos')) return response({ files: [] });
      if (path.endsWith('/api/health/watch')) {
        watchSignal = init?.signal as AbortSignal;
        return pendingWatch;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('region', { name: 'Echo call workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Watch' }));
    await waitFor(() => expect(watchSignal).toBeDefined());

    fireEvent.click(screen.getByText('Other').closest('button') as HTMLButtonElement);
    expect(watchSignal?.aborted).toBe(true);

    const startedAt = '2026-08-20T12:00:00.000Z';
    const lateFrames = [
      {
        type: 'started',
        service: '',
        startedAt,
        observedOffsetMs: 0,
        durationSeconds: 60,
        metadataCount: 0,
      },
      {
        type: 'status-observed',
        service: '',
        startedAt,
        observedOffsetMs: 1,
        sequence: 1,
        servingStatus: { code: 1, name: 'SERVING' },
      },
      {
        type: 'ended',
        service: '',
        startedAt,
        observedOffsetMs: 2,
        reason: 'completed',
        observationCount: 1,
        grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
        trailers: [],
        trailersTruncated: false,
      },
    ];
    await act(async () => {
      resolveWatch?.(
        new Response(`${lateFrames.map((frame) => JSON.stringify(frame)).join('\n')}\n`, {
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      );
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Checks' }));
    expect(await screen.findByText(/target or method context changed/i)).toBeVisible();
    expect(screen.getByText('NO STATUS OBSERVED')).toBeVisible();
    expect(screen.queryByText(/^SERVING$/)).not.toBeInTheDocument();
  });
});
