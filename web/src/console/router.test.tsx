import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapResponse } from '@/shared/types';

import { createProtoPeekRouter } from './router';

const bootstrap: BootstrapResponse = {
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

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('protocol routes', () => {
  it('uses the dashboard at root and preserves the gRPC and HTTP workbench routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const body = path.endsWith('/examples') || path.endsWith('/api/scan') ? [] : bootstrap;
        return {
          ok: true,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as Response;
      })
    );
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Protocol Peek' })).toBeInTheDocument();
    expect(screen.getByText('Route trace')).toBeInTheDocument();
    expect(screen.getAllByText('Gated').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Scan target/ }));
    expect(screen.getByRole('dialog', { name: 'Scan target' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    expect(screen.getByRole('dialog', { name: 'Scan target' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);

    await act(async () => {
      await router.navigate({ to: '/grpc' });
    });
    expect(await screen.findByRole('heading', { name: 'Open a gRPC target.' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/http' });
    });
    expect(await screen.findByText('Request workbench')).toBeInTheDocument();
  });

  it('stores truthful recent discoveries in the local browser profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const body = path.endsWith('/api/scan')
          ? [
              {
                address: '127.0.0.1:8080',
                alive: true,
                tcp: true,
                grpc: false,
                http: true,
                protocols: ['tcp', 'http'],
                reflection: 'not-checked',
                transport: 'plaintext',
                services: [],
                httpTransport: 'plaintext',
                httpProtocol: 'HTTP/1.1',
                httpStatus: '204 No Content',
                httpStatusCode: 204,
                httpServer: '',
                failure: '',
                error: '',
                details: ['http plaintext: HTTP/1.1 204 No Content'],
                latencyMs: 2,
              },
            ]
          : bootstrap;
        return {
          ok: true,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as Response;
      })
    );
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    await screen.findByRole('heading', { name: 'Protocol Peek' });
    fireEvent.click(screen.getByRole('button', { name: /Scan target/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Scan target' }), {
      target: { value: 'http://127.0.0.1:8080' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));
    expect(await screen.findByText('HTTP/1.1 · 204 No Content')).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('protopeek.discoveries.v1') ?? '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ address: '127.0.0.1:8080', http: true, tcp: true });
    });
  });
});
