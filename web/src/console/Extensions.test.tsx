import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingHandoff } from './app/handoff-store';
import { catalogIds, type ExtensionId, type SingleExtensionSnapshot } from './extension-catalog';
import type { ExtensionPack } from './extension-pack';
import { extensionPreferencesKey } from './extension-preferences';
import { httpDraftStorageKey } from './http-draft-store';
import { createProtoPeekRouter } from './router';

const mocks = vi.hoisted(() => ({ loadPack: vi.fn() }));
vi.mock('./extension-pack-loader', () => ({ loadExtensionPack: mocks.loadPack }));
const pack: ExtensionPack = {
  tool: 'caddy',
  download: 'https://caddyserver.com/docs/install',
  guide: 'https://caddyserver.com/docs/api',
  setup: { windows: 'Windows setup', darwin: 'macOS setup', linux: 'Linux setup' },
  afterSetup: 'Start the tool separately.',
  notes: ['Keep the admin port private on loopback.'],
  endpoint: {
    url: 'http://127.0.0.1:2019/reverse_proxy/upstreams',
    notice: 'Example only. No request is sent.',
  },
  commands: [{ label: 'Read version', text: 'caddy version' }],
};
function snapshot(id: ExtensionId = 'caddy'): SingleExtensionSnapshot {
  return {
    schemaVersion: 2,
    platform: 'windows',
    architecture: 'amd64',
    observedAt: '2026-10-23T00:00:00Z',
    extensions: [
      {
        id,
        status: 'detected',
        source: 'path',
        path: 'C:/Tools/caddy.exe',
        message: 'Executable located; readiness has not been checked.',
        bundled: false,
        bundledBytes: 0,
      },
    ],
  };
}
function show(path = '/extensions') {
  const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: [path] }));
  return { ...render(<RouterProvider router={router} />), router };
}
beforeEach(() => {
  mocks.loadPack.mockReset().mockResolvedValue(pack);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  clearPendingHandoff();
});

describe('optional extension library', () => {
  it('prepares the full endpoint as an unsent memory-only HTTP draft', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const draftWrites = vi.spyOn(Storage.prototype, 'setItem');
    const rendered = show('/extensions?extension=caddy');
    await screen.findByRole('button', { name: 'Open HTTP draft' });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'http://127.0.0.1:8080/private?access_token=sentinel' },
    });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open HTTP draft' }));
    expect(await screen.findByRole('textbox', { name: 'Request URL' })).toHaveValue(
      'http://127.0.0.1:8080/private?access_token=sentinel'
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('sentinel');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('sentinel');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(httpDraftStorageKey) ?? '{}').url).toContain(
        '/private'
      )
    );
    const writes = () => draftWrites.mock.calls.filter(([key]) => key === httpDraftStorageKey);
    const assertPrivate = () => {
      expect(localStorage.getItem(httpDraftStorageKey)).not.toContain('sentinel');
      expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('sentinel');
    };
    assertPrivate();
    const autosaves = writes().length;
    expect(autosaves).toBeGreaterThan(0);
    fireEvent(window, new Event('pagehide'));
    expect(writes()).toHaveLength(autosaves + 1);
    assertPrivate();
    rendered.unmount();
    expect(writes()).toHaveLength(autosaves + 2);
    assertPrivate();
    expect(writes().every(([, raw]) => !raw.includes('sentinel'))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels waiting without accepting a late result as a current observation', async () => {
    let resolve: (value: Response) => void = () => {};
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      })
    );
    show('/extensions?extension=caddy');
    await screen.findByRole('button', { name: 'Check this host' });
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel check' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Stopped waiting');
    await act(async () => resolve(Response.json(snapshot())));
    expect(screen.queryByText('Executable located')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check this host' })).toBeEnabled();
  });
  it('shows all20, filters and pins without checking, preloading packs or downloading tools', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    show();
    await screen.findByRole('heading', { name: 'Add only what you need.' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.getByRole('link', { name: 'Open live capture' })).toHaveAttribute(
      'href',
      '/network/packets?mode=live'
    );
    expect(screen.getByRole('link', { name: 'Read a packet file' })).toHaveAttribute(
      'href',
      '/network/packets?mode=file'
    );
    for (const link of screen.getAllByRole('link', { name: /Open setup|Setup & details/ }))
      fireEvent.mouseEnter(link);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search extensions' }), {
      target: { value: 'docker' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pin Docker' }));
    expect(screen.getByRole('button', { name: 'Unpin Docker' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(JSON.parse(localStorage.getItem(extensionPreferencesKey) ?? '{}')).toEqual({
      pinned: ['docker'],
    });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pinned (1)' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(mocks.loadPack).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recovers empty filters and shows preference failures without losing the in-memory selection', async () => {
    vi.stubGlobal('fetch', vi.fn());
    show();
    await screen.findByRole('heading', { name: 'Add only what you need.' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing-matches' } });
    expect(screen.getByRole('heading', { name: 'No matching extensions.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('article')).toHaveLength(catalogIds.length);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pin Docker' }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('button', { name: 'Unpin Docker' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    set.mockRestore();
  });
  it('loads only the selected setup; a local check is explicit and does not imply readiness', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(snapshot())
    );
    vi.stubGlobal('fetch', fetch);
    show('/extensions?extension=caddy');
    await screen.findByRole('button', { name: 'Check this host' });
    expect(mocks.loadPack).toHaveBeenCalledExactlyOnceWith('caddy');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Setup instructions for'), {
      target: { value: 'windows' },
    });
    expect(screen.getByText('Windows setup')).toBeVisible();
    expect(
      within(screen.getByLabelText('Setup instructions for')).queryByRole('option', {
        name: 'Choose a system',
      })
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    await screen.findByText('Executable located');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/api\/extensions\?id=caddy$/);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
    fireEvent.change(screen.getByLabelText('Setup instructions for'), {
      target: { value: 'linux' },
    });
    expect(screen.getByText('Linux setup')).toBeVisible();
    expect(screen.getByLabelText('Setup instructions for')).toHaveValue('linux');
    expect(
      within(screen.getByLabelText('Setup instructions for')).getAllByRole('option')
    ).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps failure recovery usable and rejects a mismatched single-tool response', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Host unavailable'))
      .mockResolvedValueOnce(Response.json(snapshot('docker')))
      .mockResolvedValueOnce(Response.json(snapshot()));
    vi.stubGlobal('fetch', fetch);
    show('/extensions?extension=caddy');
    await screen.findByRole('button', { name: 'Check this host' });
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Host unavailable');
    expect(screen.getByRole('link', { name: 'Official guide' })).toHaveAttribute(
      'href',
      pack.guide
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not read local tool status')
    );
    expect(screen.queryByText('Executable located')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    await screen.findByText('Executable located');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('aborts and ignores a late host observation after leaving the selected setup', async () => {
    let resolve: (value: Response) => void = () => {};
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      })
    );
    const { router } = show('/extensions?extension=caddy');
    await screen.findByRole('button', { name: 'Check this host' });
    fireEvent.click(screen.getByRole('button', { name: 'Check this host' }));
    await act(async () => {
      await router.navigate({ to: '/extensions', search: {} });
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(Response.json(snapshot())));
    await screen.findByRole('heading', { name: 'Add only what you need.' });
    expect(screen.queryByText(/Last checked/)).not.toBeInTheDocument();
  });
  it('leaves unknown extensions inert and does not load a package or contact the host', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    show('/extensions?extension=not-supported');
    await screen.findByRole('heading', { name: 'Extension not found.' });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.loadPack).not.toHaveBeenCalled();
  });
  it('offers retry for a failed lazy setup load and keeps ChatGPT external without a host check', async () => {
    mocks.loadPack
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...pack, endpoint: undefined });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    show('/extensions?extension=chatgpt');
    await screen.findByRole('button', { name: 'Retry setup' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    await screen.findByRole('link', { name: 'Open ChatGPT web' });
    expect(screen.queryByRole('button', { name: 'Check this host' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
