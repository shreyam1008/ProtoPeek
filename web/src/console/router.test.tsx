import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapResponse } from '@/shared/types';

import { getCompatibilityRouteTargets } from './app/feature-registry';
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
  it.each(getCompatibilityRouteTargets())('redirects $route to $target', async ({
    route,
    target,
  }) => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: [route] }));

    await router.load();

    expect(router.state.location.pathname).toBe(target);
  });

  it('ignores malformed recent-discovery storage while rendering the dashboard', async () => {
    window.localStorage.setItem('protopeek.discoveries.v1', JSON.stringify({ invalid: true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(bootstrap))
    );
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/'] }));

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'What do you need to check?' })
    ).toBeInTheDocument();
    expect(screen.getByText(/No recent services yet/i)).toBeVisible();
  });

  it('owns the HTTP query boundary inside the lazy HTTP route', async () => {
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: ['/protocols/http'] })
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Request workbench')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/protocols/http');
  });

  it('uses the dashboard at root and preserves lazy workbench, network, and roadmap routes', async () => {
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

    expect(
      await screen.findByRole('heading', { name: 'What do you need to check?' })
    ).toBeInTheDocument();
    expect(screen.getByText('Network path')).toBeInTheDocument();
    expect(screen.getByText('Bundled Nmap')).toBeInTheDocument();
    expect(screen.getByText('Local discovery')).toBeInTheDocument();
    expect(screen.getByText('Ask first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Check this computer/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Find a service/ }));
    expect(
      await screen.findByRole('dialog', { name: 'Scan target' }, { timeout: 5000 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect target' }));
    expect(
      await screen.findByRole('dialog', { name: 'Scan target' }, { timeout: 5000 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close scan target dialog' })[1]);

    await act(async () => {
      await router.navigate({ to: '/network' });
    });
    expect(
      await screen.findByRole('heading', { name: 'See how this machine reaches a target.' })
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/network/path');
    expect(screen.getByRole('link', { name: 'Open Network' })).toHaveClass('is-active');

    await act(async () => {
      await router.navigate({ to: '/network/map' });
    });
    expect(
      await screen.findByRole('heading', { name: 'Network evidence map' })
    ).toBeInTheDocument();
    expect(screen.getByText(/logical evidence.*not physical cabling/i)).toBeVisible();

    await act(async () => {
      await router.navigate({ to: '/this-pc' });
    });
    expect(await screen.findByRole('heading', { name: 'This PC' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/this-pc');
    expect(screen.getByRole('link', { name: 'Open This PC' })).toHaveClass('is-active');

    await act(async () => {
      await router.navigate({ to: '/tunnels' });
    });
    expect(await screen.findByRole('heading', { name: 'Tunnel operations' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/tunnels');
    expect(screen.getByRole('link', { name: 'Open Tunnels' })).toHaveClass('is-active');

    await act(async () => {
      await router.navigate({ to: '/roadmap' });
    });
    expect(await screen.findByRole('heading', { name: 'Product roadmap' })).toBeInTheDocument();
    expect(screen.getByText('Owned package channels')).toBeInTheDocument();
    expect(
      screen.getByText(/install checksum-pinned v0\.5\.0 archives, declare aria2/)
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Downloader', level: 3 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Security evidence', level: 3 })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'GoBarryGo bridge', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('WinGet package')).toBeInTheDocument();
    expect(screen.getByText('Bundled Nmap execution')).toBeInTheDocument();
    expect(screen.getByText('Network Path · Linux')).toBeInTheDocument();
    expect(screen.getByText('Broader/public range discovery')).toBeInTheDocument();
  });

  it('opens an HTTP service found by the gRPC launcher in the HTTP workbench', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/api/scan')) {
          return Response.json([
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
              httpStatus: '200 OK',
              httpStatusCode: 200,
              httpServer: '',
              failure: '',
              error: null,
              details: ['http plaintext: HTTP/1.1 200 OK'],
              latencyMs: 2,
            },
          ]);
        }
        if (path.endsWith('/examples')) return Response.json([]);
        return Response.json(bootstrap);
      })
    );
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/grpc'] }));
    render(<RouterProvider router={router} />);

    await screen.findByRole('heading', { name: 'Open a gRPC target.' });
    fireEvent.click(await screen.findByRole('button', { name: 'HTTP' }));

    expect(await screen.findByRole('heading', { name: 'Request workbench' })).toBeVisible();
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://127.0.0.1:8080/');
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

    await screen.findByRole('heading', { name: 'What do you need to check?' });
    fireEvent.click(screen.getByRole('button', { name: /Find a service/ }));
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
