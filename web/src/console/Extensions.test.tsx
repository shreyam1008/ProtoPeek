import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ExtensionSnapshot, extensionIds } from './extension-catalog';
import { createProtoPeekRouter } from './router';

function snapshot(): ExtensionSnapshot {
  return {
    schemaVersion: 1,
    platform: 'linux',
    architecture: 'amd64',
    observedAt: '2026-09-28T00:00:00Z',
    extensions: extensionIds.map((id) => ({
      id,
      status: 'missing',
      source: 'none',
      path: '',
      message: 'Not found on this host.',
      bundled: false,
      bundledBytes: 0,
    })),
  };
}
function show() {
  const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/extensions'] }));
  return { ...render(<RouterProvider router={router} />), router };
}
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('Extensions', () => {
  it('groups services together, checks only local metadata, and uses host installation guidance', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(snapshot())
    );
    vi.stubGlobal('fetch', fetchMock);
    show();
    await screen.findByRole('heading', { name: 'Add only what you need.' });
    await screen.findByRole('button', { name: 'Refresh tools' });
    const services = screen.getByRole('region', { name: 'Connect & publish' });
    expect(within(services).getByRole('heading', { name: 'Tailscale' })).toBeVisible();
    expect(within(services).getByRole('heading', { name: 'Cloudflare Tunnel' })).toBeVisible();
    expect(within(services).getByRole('heading', { name: 'NetBird' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(extensionIds.length);
    expect(
      within(screen.getByRole('navigation', { name: 'Extensions tools' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual([
      '/extensions',
      '/network/tailnet',
      '/extensions/netbird',
      '/tunnels',
      '/extensions/publish',
      '/network/nmap',
    ]);
    expect(screen.getAllByText('Not found')).toHaveLength(extensionIds.length);
    expect(screen.getByLabelText('Setup instructions for')).toHaveValue('linux');
    expect(screen.getByRole('link', { name: 'Read a packet file' })).toHaveAttribute(
      'href',
      '/network/packets?mode=file'
    );
    expect(screen.getByRole('link', { name: 'Open live capture' })).toHaveAttribute(
      'href',
      '/network/packets?mode=live'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/extensions');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
    fireEvent.change(screen.getByLabelText('Setup instructions for'), {
      target: { value: 'windows' },
    });
    expect(screen.getByRole('link', { name: 'Npcap for Windows', hidden: true })).toHaveAttribute(
      'href',
      'https://npcap.com/#download'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('refreshes installation status without treating detection as readiness or downloading anything', async () => {
    const data = snapshot();
    data.extensions[0] = {
      ...data.extensions[0],
      status: 'detected',
      source: 'path',
      path: '/usr/bin/tailscale',
      message: 'Executable located; connection state has not been checked.',
    };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(data)
    );
    vi.stubGlobal('fetch', fetchMock);
    show();
    await screen.findByText('Detected');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tools' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]).toHaveProperty('cache', 'reload');
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/api/extensions'))).toBe(
      true
    );
  });
  it('keeps setup links usable after an error and recovers on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Host unavailable'))
      .mockResolvedValue(Response.json(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Host unavailable');
    expect(screen.getByRole('link', { name: 'Get Tailscale' })).toHaveAttribute(
      'href',
      'https://tailscale.com/download'
    );
    expect(screen.getAllByText('Not checked')).toHaveLength(extensionIds.length);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tools' }));
    await screen.findAllByText('Not found');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('aborts metadata loading on navigation away', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>(() => {});
      })
    );
    const { router } = show();
    await screen.findByRole('heading', { name: 'Add only what you need.' });
    await waitFor(() => expect(signal).toBeDefined());
    await act(async () => {
      await router.navigate({ to: '/protocols' });
    });
    expect(signal?.aborted).toBe(true);
  });
});
