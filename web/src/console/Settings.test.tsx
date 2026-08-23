import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { interfacePreferencesStorageKey } from './interface-preferences';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
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
    fireEvent.click(screen.getByRole('button', { name: /^Compact/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Show keyboard shortcut hints/i }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
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

    fireEvent.click(screen.getByRole('button', { name: 'Restore interface defaults' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Interface defaults restored.');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-density', 'comfortable');
    expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'shown');
    expect(screen.getByText(/CPU, memory, scan authorization, TLS verification/i)).toBeVisible();
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
    };
    let previewReads = 0;
    let rolledBack = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
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
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Check for GoBarryGo/i }));
    expect(await screen.findByText('2 entries · 1.0 KiB')).toBeVisible();
    fireEvent.click(screen.getByText('Review preserved differences'));
    expect(screen.getByText('Native notifications stay preserved in GoBarryGo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import into ProtoPeek' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Keep GoBarryGo untouched/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Import into ProtoPeek' }));

    expect(await screen.findByText(/original files were left untouched/i)).toBeVisible();
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
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Allow guarded rollback/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back this import' }));
    expect(await screen.findByText(/restored from the migration receipt/i)).toBeVisible();
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
      vi.fn(async () =>
        Response.json({
          preferencesFound: true,
          sessionFound: false,
          sessionBytes: 0,
          sessionEntries: 0,
          settingChanges: [],
          preservedButUnsupported: [],
          warnings: [],
          alreadyImported: false,
          ...states[Math.min(previewReads++, states.length - 1)],
        })
      )
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
