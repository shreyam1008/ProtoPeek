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
  it('owns the HTTP query boundary inside the lazy HTTP route', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/http'] }));

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Request workbench')).toBeInTheDocument();
  });

  it('uses the dashboard at root and preserves lazy workbench and roadmap routes', async () => {
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
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Protocol Peek' })).toBeInTheDocument();
    expect(screen.getByText('Next-hop lookup')).toBeInTheDocument();
    expect(screen.getByText('Bundled Nmap')).toBeInTheDocument();
    expect(screen.getAllByText('Gated').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Scan target/ }));
    expect(await screen.findByRole('dialog', { name: 'Scan target' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    expect(await screen.findByRole('dialog', { name: 'Scan target' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);

    await act(async () => {
      await router.navigate({ to: '/grpc' });
    });
    expect(await screen.findByRole('heading', { name: 'Open a gRPC target.' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/http' });
    });
    expect(await screen.findByText('Request workbench')).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/routes' });
    });
    expect(await screen.findByRole('heading', { name: 'Next-hop route' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/roadmap' });
    });
    expect(await screen.findByRole('heading', { name: 'Product roadmap' })).toBeInTheDocument();
    expect(screen.getByText('Owned package channels')).toBeInTheDocument();
    expect(
      screen.getByText(/checksum-pinned v0\.3\.1 archives with both protopeek and pp/)
    ).toBeInTheDocument();
    expect(screen.getByText('WinGet package')).toBeInTheDocument();
    expect(screen.getByText('Bundled Nmap execution')).toBeInTheDocument();
    expect(screen.getByText('Traceroute / hop probes')).toBeInTheDocument();
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
    render(<RouterProvider router={router} />);

    await screen.findByRole('heading', { name: 'Protocol Peek' });
    fireEvent.click(screen.getByRole('button', { name: /Scan target/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Scan target' }), {
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
