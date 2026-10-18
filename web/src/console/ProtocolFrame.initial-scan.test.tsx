import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingHandoff } from './app/handoff-store';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  vi.unstubAllGlobals();
  clearPendingHandoff();
  localStorage.clear();
  sessionStorage.clear();
});

function launcherFetch(initialScanTarget?: string) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/bootstrap')) {
      return Response.json({
        version: 'test',
        target: 'Choose a gRPC target',
        launcherMode: true,
        initialScanTarget,
        services: [],
      });
    }
    if (path.endsWith('/api/scan') || path.endsWith('/examples')) return Response.json([]);
    throw new Error(`Unexpected request: ${path}`);
  });
}

describe('CLI discovery in the real shell', () => {
  it.each([
    '/',
    '/protocols/grpc',
  ] as const)('consumes the explicit CLI target once across route remounts starting at %s', async (initialRoute) => {
    const target = 'api.internal:8443';
    const fetchMock = launcherFetch(target);
    vi.stubGlobal('fetch', fetchMock);
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: [initialRoute] }));
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    );
    const scans = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/scan'));
    await waitFor(() => expect(scans()).toHaveLength(1));
    expect(JSON.parse(String(scans()[0]?.[1]?.body))).toMatchObject({
      addresses: [target],
      explicit: true,
    });
    if (initialRoute === '/') {
      await screen.findByRole('dialog', { name: 'Scan target' });
      fireEvent.keyDown(window, { key: 'Escape' });
    }
    // Updating the provider must not reset the claim to the original CLI target.
    fireEvent.click(screen.getByRole('button', { name: 'Use dark mode' }));
    for (const to of ['/protocols/grpc', '/', '/settings', '/protocols/grpc', '/'] as const) {
      await act(async () => {
        await router.navigate({ to });
      });
      await screen.findByRole('heading', {
        name:
          to === '/'
            ? 'What do you need to check?'
            : to === '/settings'
              ? 'Settings'
              : 'Open a gRPC target.',
      });
      expect(scans()).toHaveLength(1);
      expect(screen.queryByRole('dialog', { name: 'Scan target' })).toBeNull();
    }
  });

  it('keeps the launcher usable when an older bootstrap omits the CLI target', async () => {
    const fetchMock = launcherFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols/grpc'] }))}
      />
    );
    expect(await screen.findByLabelText('Address')).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'gRPC workbench unavailable' })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/scan'))).toBe(false);
  });

  it('does not replay the CLI scan after connecting and deleting the active target', async () => {
    const cliTarget = 'api.internal:8443';
    const connectedAddress = 'connected.test:50051';
    const method = {
      name: 'Echo',
      fullName: 'demo.Echo/Echo',
      description: '',
      clientStreaming: false,
      serverStreaming: false,
      requestType: 'demo.Request',
      responseType: 'demo.Response',
    };
    const initialFetch = launcherFetch(cliTarget);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/workspace/connect'))
        return Response.json({
          sessionId: 'connected-session',
          bootstrap: {
            version: 'test',
            target: connectedAddress,
            launcherMode: false,
            services: [{ name: 'demo.Echo', description: '', methods: [method] }],
          },
        });
      if (path.endsWith('/api/workspace/metadata'))
        return Response.json({
          requestType: method.requestType,
          requestStream: false,
          messageTypes: {},
          enumTypes: {},
        });
      if (path.endsWith('/api/workspace/protos')) return Response.json({ files: [] });
      if (path.endsWith('/api/workspace/session') && init?.method === 'DELETE')
        return Response.json(null);
      return initialFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols/grpc'] }))}
      />
    );
    const scans = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/scan'));
    await waitFor(() => expect(scans()).toHaveLength(1));
    expect(JSON.parse(String(scans()[0]?.[1]?.body))).toMatchObject({
      addresses: [cliTarget],
      explicit: true,
    });
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: connectedAddress },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByLabelText('Request JSON');
    fireEvent.click(screen.getByRole('button', { name: 'Targets' }));
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${connectedAddress}` }));
    await screen.findByRole('heading', { name: 'Open a gRPC target.' });
    expect(await screen.findByRole('button', { name: 'Scan target' })).toBeEnabled();
    expect(scans()).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/workspace/connect'))
    ).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('protopeek.targets.v1') ?? '[]')).toEqual([]);
  });
});

describe('gRPC keyboard validation inside the real shell', () => {
  it('respects shell dialogs, then reports invalid JSON without invoking or changing mobile panes', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 700px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    const method = {
      name: 'Echo',
      fullName: 'demo.Echo/Echo',
      description: '',
      clientStreaming: false,
      serverStreaming: false,
      requestType: 'demo.Request',
      responseType: 'demo.Response',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/bootstrap')) {
        return Response.json({
          version: 'test',
          target: 'localhost:50051',
          launcherMode: false,
          services: [{ name: 'demo.Echo', description: '', methods: [method] }],
        });
      }
      if (path.endsWith('/metadata')) {
        return Response.json({
          requestType: method.requestType,
          requestStream: false,
          messageTypes: {},
          enumTypes: {},
        });
      }
      if (path.endsWith('/api/protos')) return Response.json({ files: [] });
      if (path.endsWith('/examples')) return Response.json([]);
      if (path.includes('/invoke/')) {
        return Response.json({
          headers: [],
          responses: [],
          requests: null,
          trailers: [],
          error: null,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols/grpc'] }))}
      />
    );
    const editor = await screen.findByLabelText('Request JSON');
    const invocations = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/invoke/'));
    fireEvent.click(screen.getByRole('button', { name: 'Open global command menu' }));
    await screen.findByRole('dialog', { name: 'ProtoPeek commands' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(invocations()).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.change(editor, { target: { value: '{ broken' } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    const requestPane = document.getElementById('grpc-mobile-pane-panel-request');
    if (!requestPane) throw new Error('Request pane missing');
    expect(await within(requestPane).findByRole('alert')).not.toBeEmptyDOMElement();
    expect(document.getElementById('grpc-mobile-pane-tab-request')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(invocations()).toHaveLength(0);
    fireEvent.change(editor, { target: { value: '{}' } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(invocations()).toHaveLength(1));
  });
});
