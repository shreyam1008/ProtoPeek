import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapResponse } from '@/shared/types';
import { appStorageKeys } from '@/shared/utils';

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
}: {
  connectOK: boolean;
  scanResults?: unknown[];
  bootstrap?: BootstrapResponse;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/bootstrap')) return response(bootstrap);
    if (path.endsWith('/examples')) return response([]);
    if (path.endsWith('/api/scan')) return response(scanResults);
    if (path.endsWith('/api/workspace/connect')) {
      return connectOK
        ? response({ sessionId: 'session-1', bootstrap: launcherBootstrap })
        : response('connection refused', false);
    }
    if (path.endsWith('/api/workspace/session') && init?.method === 'DELETE') {
      return response(null);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('gRPC launcher recents', () => {
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
