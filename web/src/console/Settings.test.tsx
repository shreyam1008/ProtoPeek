import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appearanceStorageKey } from '@/shared/theme';

import { interfacePreferencesStorageKey } from './interface-preferences';
import { createProtoPeekRouter } from './router';

const hostSnapshot = {
  observedAt: '2026-08-24T00:00:00Z',
  configRevision: 'a'.repeat(64),
  health: {
    ready: false,
    status: 'stopped',
    message: 'Downloader is stopped.',
    binaryPath: '/usr/bin/aria2c',
    engineVersion: '',
  },
  config: {
    version: 1,
    aria2Path: '/usr/bin/aria2c',
    downloadDirectory: '/home/user/Downloads',
    maxActiveJobs: 4,
    maxQueuedJobs: 128,
    maxTrackedJobs: 512,
    maxConnectionsPerHost: 8,
    split: 8,
    minSplitSizeBytes: 1 << 20,
    maxDownloadBytesPerSecond: 0,
    minimumFreeDiskBytes: 512 << 20,
    continuePartialDownloads: true,
    alwaysResume: true,
    fileAllocation: 'prealloc',
    autoRenameConflictingFiles: true,
    allowOverwriteExistingFiles: false,
    allowInsecureTls: false,
    userAgent: 'ProtoPeek test',
  },
  metrics: {},
  jobs: [],
};

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-mode');
  document.documentElement.removeAttribute('data-palette');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('Settings', () => {
  it('persists browser-local appearance and presentation choices', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: "Shape this browser's console." })
    ).toBeVisible();
    expect(screen.getByText('Local + explicit')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^Dark/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Nord/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Compact/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Show keyboard shortcut hints/i }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
      expect(document.documentElement).toHaveAttribute('data-theme-mode', 'dark');
      expect(document.documentElement).toHaveAttribute('data-palette', 'nord');
      expect(document.documentElement).toHaveAttribute('data-density', 'compact');
      expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'hidden');
    });
    expect(JSON.parse(window.localStorage.getItem(interfacePreferencesStorageKey) ?? '{}')).toEqual(
      {
        version: 1,
        density: 'compact',
        showKeyboardHints: false,
      }
    );
    expect(JSON.parse(window.localStorage.getItem(appearanceStorageKey) ?? '{}')).toEqual({
      version: 2,
      mode: 'dark',
      palette: 'nord',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore interface defaults' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Interface defaults restored.');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'system');
    expect(document.documentElement).toHaveAttribute('data-palette', 'graphite');
    expect(document.documentElement).toHaveAttribute('data-density', 'comfortable');
    expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'shown');
    expect(
      screen.getByText(/CPU, memory, scan authorization, and protocol deadlines/i)
    ).toBeVisible();
  });

  it('loads, edits, saves, and reloads host settings without browser persistence', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=host-token; path=/';
    const savedConfig = {
      ...hostSnapshot.config,
      maxActiveJobs: 6,
      maxDownloadBytesPerSecond: 2.5 * (1 << 20),
    };
    let snapshotReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        snapshotReads += 1;
        return Response.json({
          ...hostSnapshot,
          config: snapshotReads > 1 ? savedConfig : hostSnapshot.config,
          configRevision: snapshotReads > 1 ? 'b'.repeat(64) : hostSnapshot.configRevision,
        });
      }
      if (path.endsWith('/config') && init?.method === 'POST') {
        return Response.json({
          ...savedConfig,
          configRevision: 'b'.repeat(64),
          warning: 'directory durability could not be confirmed',
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);

    const activeJobs = await screen.findByRole('spinbutton', { name: /^Active jobs/ });
    expect(activeJobs).toHaveValue(4);
    expect(screen.getByRole('textbox', { name: /^aria2 executable\/path/ })).toHaveValue(
      '/usr/bin/aria2c'
    );

    fireEvent.change(activeJobs, { target: { value: '6' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Bandwidth cap · MiB\/s/ }), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save host settings' }));

    expect(
      await screen.findByText(
        'Host settings saved with a durability warning: directory durability could not be confirmed'
      )
    ).toBeVisible();
    const configCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/config')
    );
    expect(new Headers(configCall?.[1]?.headers).get('x-protopeek-csrf-token')).toBe('host-token');
    expect(new Headers(configCall?.[1]?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(configCall?.[1]?.body))).toEqual({
      expectedRevision: hostSnapshot.configRevision,
      maxActiveJobs: 6,
      maxDownloadBytesPerSecond: 2.5 * (1 << 20),
    });
    expect(
      storageSetItem.mock.calls.some(([key, value]) =>
        `${String(key)} ${String(value)}`.includes('/home/user/Downloads')
      )
    ).toBe(false);
    expect(Object.keys(window.localStorage)).not.toContain('transferHostConfig');

    fireEvent.click(screen.getByRole('button', { name: 'Reload host settings' }));
    await waitFor(() => expect(snapshotReads).toBe(3));
    expect(screen.getByRole('spinbutton', { name: /^Active jobs/ })).toHaveValue(6);
  });

  it('reports host save and reload errors while keeping runtime state truthful', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=host-token; path=/';
    let snapshotReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        snapshotReads += 1;
        if (snapshotReads > 1) return new Response('snapshot unavailable', { status: 503 });
        return Response.json(hostSnapshot);
      }
      if (path.endsWith('/config') && init?.method === 'POST') {
        return new Response('config write refused', { status: 423 });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('textbox', { name: /^aria2 executable\/path/ });

    fireEvent.click(screen.getByRole('button', { name: 'Save host settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('config write refused');
    expect(screen.getAllByText('Stopped')[0]).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Reload host settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('snapshot unavailable');
    expect(screen.getByRole('button', { name: 'Save host settings' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Active jobs/ }), {
      target: { value: '6' },
    });
    expect(screen.getByRole('button', { name: 'Save host settings' })).toBeDisabled();
  });

  it.each([
    'running',
    'starting',
    'stopping',
    'unavailable',
    'locked',
  ] as const)('disables host saves while the Downloader is %s', async (status) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        return Response.json({
          ...hostSnapshot,
          health: { ...hostSnapshot.health, status, message: `Downloader is ${status}.` },
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('textbox', { name: /^aria2 executable\/path/ });

    expect(screen.getByRole('button', { name: 'Save host settings' })).toBeDisabled();
    expect(
      screen.getAllByText(
        status === 'locked'
          ? 'In use by another process'
          : status.charAt(0).toUpperCase() + status.slice(1)
      )[0]
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/config'))
    ).toBe(false);
  });

  it.each([
    'failed',
    'binary_missing',
  ] as const)('keeps host saves available while the Downloader is definitively inactive: %s', async (status) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        return Response.json({
          ...hostSnapshot,
          health: { ...hostSnapshot.health, status, message: `Downloader is ${status}.` },
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('textbox', { name: /^aria2 executable\/path/ });

    expect(screen.getByRole('button', { name: 'Save host settings' })).toBeEnabled();
    expect(
      screen.getAllByText(status === 'binary_missing' ? 'aria2c not found' : 'Failed')[0]
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/config'))
    ).toBe(false);
  });

  it.each([
    1, 123456,
  ])('does not round unchanged %d-byte host values through MiB inputs', async (bytes) => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=host-token; path=/';
    const config = {
      ...hostSnapshot.config,
      maxDownloadBytesPerSecond: bytes,
      minimumFreeDiskBytes: bytes,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        return Response.json({ ...hostSnapshot, config, configRevision: 'c'.repeat(64) });
      }
      if (path.endsWith('/config') && init?.method === 'POST') {
        return Response.json({ ...config, configRevision: 'c'.repeat(64) });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('spinbutton', { name: /^Bandwidth cap · MiB\/s/ });
    fireEvent.click(screen.getByRole('button', { name: 'Save host settings' }));
    expect(
      await screen.findByText('Host settings saved and reloaded from the local transfer snapshot.')
    ).toBeVisible();

    const configCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/config')
    );
    expect(JSON.parse(String(configCall?.[1]?.body))).toEqual({
      expectedRevision: 'c'.repeat(64),
    });
  });

  it('distinguishes a saved config from a failed post-save snapshot reload', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=host-token; path=/';
    const savedConfig = { ...hostSnapshot.config, maxActiveJobs: 5 };
    let snapshotReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        snapshotReads += 1;
        if (snapshotReads > 1) return new Response('snapshot unavailable', { status: 503 });
        return Response.json(hostSnapshot);
      }
      if (path.endsWith('/config') && init?.method === 'POST') return Response.json(savedConfig);
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    const activeJobs = await screen.findByRole('spinbutton', { name: /^Active jobs/ });
    fireEvent.change(activeJobs, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save host settings' }));

    expect(
      await screen.findByText(
        'Host settings were saved. Reload the snapshot to confirm current host state.'
      )
    ).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('snapshot unavailable');
    expect(screen.getByRole('spinbutton', { name: /^Active jobs/ })).toHaveValue(5);
  });

  it('inspects and imports GoBarryGo only after explicit user actions', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    const preview = {
      available: true,
      preferencesFound: true,
      sessionFound: true,
      sessionBytes: 1024,
      sessionEntries: 2,
      settingChanges: [
        {
          key: 'downloadDirectory',
          before: '/home/user',
          after: '/home/user/Downloads',
          note: 'Keeps the existing download destination.',
        },
      ],
      preservedButUnsupported: ['Native notifications stay preserved in GoBarryGo.'],
      warnings: [],
      canImport: true,
      engineMustBeStopped: false,
      previewRevision: 'a'.repeat(64),
    };
    let previewReads = 0;
    let snapshotReads = 0;
    let rolledBack = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        snapshotReads += 1;
        return Response.json(hostSnapshot);
      }
      if (path.endsWith('/preview')) {
        previewReads += 1;
        return Response.json({
          ...preview,
          alreadyImported: previewReads > 1 && !rolledBack,
          lastReceiptId:
            previewReads > 1 && !rolledBack ? '20260823T120000.000000000Z-aabbccddeeff' : undefined,
        });
      }
      if (path.endsWith('/rollback') && init?.method === 'POST') {
        rolledBack = true;
        return Response.json({
          rolledBack: true,
          receiptId: '20260823T120000.000000000Z-aabbccddeeff',
          sourcePreserved: true,
          rolledBackAt: '2026-08-23T12:10:00Z',
          message: 'ProtoPeek transfer state was restored from the migration receipt.',
        });
      }
      if (path.endsWith('/import') && init?.method === 'POST') {
        return Response.json({
          imported: true,
          preferencesImported: true,
          sessionImported: true,
          sessionEntriesAdded: 2,
          sourcePreserved: true,
          importedAt: '2026-08-23T12:00:00Z',
          message:
            'GoBarryGo state imported into ProtoPeek. The original files were left untouched.',
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toMatch(
      /\/api\/transfers\/snapshot$/
    );
    expect(
      fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/preview'))
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    expect(await screen.findByText('2 entries · 1.0 KiB')).toBeVisible();
    fireEvent.click(screen.getByText('Review preserved differences'));
    expect(screen.getByText('Native notifications stay preserved in GoBarryGo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import into ProtoPeek' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Keep GoBarryGo untouched/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Import into ProtoPeek' }));

    expect(await screen.findByText(/original files were left untouched/i)).toBeVisible();
    expect(snapshotReads).toBe(2);
    expect(screen.getByRole('button', { name: 'Already imported' })).toBeDisabled();
    const importCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/import')
    );
    expect(new Headers(importCall?.[1]?.headers).get('x-protopeek-csrf-token')).toBe(
      'migration-token'
    );
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      importPreferences: true,
      importSession: true,
      acknowledgeSourcePreserved: true,
      expectedRevision: 'a'.repeat(64),
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Allow guarded rollback/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back this import' }));
    expect(await screen.findByText(/restored from the migration receipt/i)).toBeVisible();
    expect(snapshotReads).toBe(3);
    expect(screen.getByRole('button', { name: 'Import into ProtoPeek' })).toBeDisabled();
    const rollbackCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/rollback')
    );
    expect(JSON.parse(String(rollbackCall?.[1]?.body))).toEqual({
      receiptId: '20260823T120000.000000000Z-aabbccddeeff',
      acknowledgeCurrentStateCheck: true,
    });
  });

  it('keeps the latest guarded rollback available after a partial import', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/snapshot')) {
        return Response.json(hostSnapshot);
      }
      if (path.endsWith('/rollback') && init?.method === 'POST') {
        return Response.json({
          rolledBack: true,
          receiptId: '20260823T120000.000000000Z-aabbccddeeff',
          sourcePreserved: true,
          rolledBackAt: '2026-08-23T12:10:00Z',
          message: 'ProtoPeek transfer state was restored from the migration receipt.',
        });
      }
      if (path.endsWith('/preview') && init?.method === 'POST') {
        return Response.json({
          available: true,
          preferencesFound: true,
          sessionFound: true,
          sessionBytes: 1024,
          sessionEntries: 2,
          settingChanges: [],
          preservedButUnsupported: [],
          warnings: [],
          canImport: true,
          engineMustBeStopped: false,
          alreadyImported: false,
          lastReceiptId: '20260823T120000.000000000Z-aabbccddeeff',
          previewRevision: 'b'.repeat(64),
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });
    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));

    expect(await screen.findByRole('checkbox', { name: /Allow guarded rollback/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Roll back this import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import into ProtoPeek' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Allow guarded rollback/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back this import' }));

    expect(await screen.findByText(/restored from the migration receipt/i)).toBeVisible();
    const rollbackCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/rollback')
    );
    expect(new Headers(rollbackCall?.[1]?.headers).get('x-protopeek-csrf-token')).toBe(
      'migration-token'
    );
    expect(JSON.parse(String(rollbackCall?.[1]?.body))).toEqual({
      receiptId: '20260823T120000.000000000Z-aabbccddeeff',
      acknowledgeCurrentStateCheck: true,
    });
  });

  it('commits a successful import before independently reloading migration and host state', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    let previewReads = 0;
    let snapshotReads = 0;
    let importCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/snapshot')) {
          snapshotReads += 1;
          return Response.json(hostSnapshot);
        }
        if (path.endsWith('/preview')) {
          previewReads += 1;
          if (previewReads > 1) return new Response('preview reload unavailable', { status: 502 });
          return Response.json({
            available: true,
            preferencesFound: true,
            sessionFound: false,
            sessionBytes: 0,
            sessionEntries: 0,
            settingChanges: [],
            preservedButUnsupported: [],
            warnings: [],
            canImport: true,
            engineMustBeStopped: false,
            alreadyImported: false,
            previewRevision: 'f'.repeat(64),
          });
        }
        if (path.endsWith('/import') && init?.method === 'POST') {
          importCalls += 1;
          return Response.json({
            imported: true,
            preferencesImported: true,
            sessionImported: false,
            sourcePreserved: true,
            message: 'GoBarryGo preferences imported into ProtoPeek.',
          });
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });
    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    await screen.findByText('Ready for explicit import');
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep GoBarryGo untouched/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Import into ProtoPeek' }));

    expect(await screen.findByText('GoBarryGo preferences imported into ProtoPeek.')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Import succeeded, but current migration state could not be reloaded/i
    );
    expect(screen.getByRole('button', { name: /Check for GoBarryGo/i })).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: /Keep GoBarryGo untouched/i })
    ).not.toBeInTheDocument();
    expect(importCalls).toBe(1);
    expect(snapshotReads).toBe(2);
  });

  it('commits a successful rollback before independently reloading migration and host state', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    let previewReads = 0;
    let snapshotReads = 0;
    let rollbackCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/snapshot')) {
          snapshotReads += 1;
          return Response.json(hostSnapshot);
        }
        if (path.endsWith('/preview')) {
          previewReads += 1;
          if (previewReads > 1) return new Response('preview reload unavailable', { status: 502 });
          return Response.json({
            available: true,
            preferencesFound: true,
            sessionFound: false,
            sessionBytes: 0,
            sessionEntries: 0,
            settingChanges: [],
            preservedButUnsupported: [],
            warnings: [],
            canImport: true,
            engineMustBeStopped: false,
            alreadyImported: true,
            lastReceiptId: '20260823T120000.000000000Z-aabbccddeeff',
            previewRevision: '9'.repeat(64),
          });
        }
        if (path.endsWith('/rollback') && init?.method === 'POST') {
          rollbackCalls += 1;
          return Response.json({
            rolledBack: true,
            receiptId: '20260823T120000.000000000Z-aabbccddeeff',
            sourcePreserved: true,
            rolledBackAt: '2026-08-23T12:10:00Z',
            message: 'ProtoPeek transfer state restored from the migration receipt.',
          });
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });
    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    const rollbackApproval = await screen.findByRole('checkbox', {
      name: /Allow guarded rollback/i,
    });
    fireEvent.click(rollbackApproval);
    fireEvent.click(screen.getByRole('button', { name: 'Roll back this import' }));

    expect(
      await screen.findByText('ProtoPeek transfer state restored from the migration receipt.')
    ).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Rollback succeeded, but current migration state could not be reloaded/i
    );
    expect(screen.getByRole('button', { name: /Check for GoBarryGo/i })).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: /Allow guarded rollback/i })
    ).not.toBeInTheDocument();
    expect(rollbackCalls).toBe(1);
    expect(snapshotReads).toBe(2);
  });

  it('requires a fresh preview after an import revision conflict', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    let importCalls = 0;
    let previewCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/snapshot')) return Response.json(hostSnapshot);
        if (path.endsWith('/preview')) {
          previewCalls += 1;
          return Response.json({
            available: true,
            preferencesFound: true,
            sessionFound: false,
            sessionBytes: 0,
            sessionEntries: 0,
            settingChanges: [],
            preservedButUnsupported: [],
            warnings: [],
            canImport: true,
            engineMustBeStopped: false,
            alreadyImported: false,
            previewRevision: (previewCalls === 1 ? 'd' : 'e').repeat(64),
          });
        }
        if (path.endsWith('/import') && init?.method === 'POST') {
          importCalls += 1;
          return new Response(
            'GoBarryGo or ProtoPeek transfer state changed after this preview; check again before importing',
            { status: 409 }
          );
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });
    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    await screen.findByText('Ready for explicit import');
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep GoBarryGo untouched/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Import into ProtoPeek' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/state changed after this preview/i);
    expect(importCalls).toBe(1);
    expect(
      screen.queryByRole('checkbox', { name: /Keep GoBarryGo untouched/i })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    expect(await screen.findByText('Ready for explicit import')).toBeVisible();
    expect(importCalls).toBe(1);
  });

  it('labels unavailable and blocked GoBarryGo targets truthfully', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    const states = [
      {
        available: true,
        canImport: false,
        engineMustBeStopped: true,
      },
      {
        available: true,
        canImport: false,
        engineMustBeStopped: false,
      },
      {
        available: false,
        canImport: false,
        engineMustBeStopped: false,
      },
    ];
    let previewReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/snapshot')) return Response.json(hostSnapshot);
        return Response.json({
          preferencesFound: true,
          sessionFound: false,
          sessionBytes: 0,
          sessionEntries: 0,
          settingChanges: [],
          preservedButUnsupported: [],
          warnings: [],
          alreadyImported: false,
          previewRevision: 'c'.repeat(64),
          ...states[Math.min(previewReads++, states.length - 1)],
        });
      })
    );

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: "Shape this browser's console." });

    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    expect(await screen.findByText('Stop Downloader before import')).toBeVisible();
    expect(screen.queryByText('Ready for explicit import')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(await screen.findByText('Import is not available for this state')).toBeVisible();
    expect(screen.queryByText('Ready for explicit import')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(await screen.findByText('No compatible GoBarryGo state available')).toBeVisible();
    expect(screen.queryByText('Ready for explicit import')).not.toBeInTheDocument();
  });
});
