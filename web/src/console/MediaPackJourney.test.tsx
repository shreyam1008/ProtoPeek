import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it('finds a gallery companion in the library and opens its actual media setup', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/media/install')) {
      expect(JSON.parse(String(init?.body))).toEqual({ engine: 'gallery-dl' });
      return Response.json({ ok: true });
    }
    if (url.endsWith('/api/media/snapshot')) {
      return Response.json({
        tools: [
          {
            name: 'gallery-dl',
            path: '',
            help: 'Gallery setup',
            canInstall: true,
            installBytes: 22541572,
          },
          {
            name: 'native-go',
            path: 'Built in',
            help: 'Direct media',
            canInstall: false,
            installBytes: 0,
          },
        ],
        jobs: [],
        directory: '/tmp/downloads',
      });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/extensions'] }));
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Add only what you need.' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search extensions' }), {
    target: { value: 'gallery album' },
  });
  expect(await screen.findByRole('heading', { name: 'gallery-dl' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Pin gallery-dl' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pinned (1)' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Unpin gallery-dl' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: /Open setup in Files/ }));
  expect(await screen.findByText('Gallery setup')).toBeVisible();
  expect(router.state.location.pathname).toBe('/downloader');
  expect(screen.getByRole('region', { name: 'Engine setup' })).toHaveFocus();
  expect(router.state.location.search).toEqual({ mediaTool: 'gallery-dl' });
  expect(screen.getByRole('button', { name: /Images & galleries/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: /Install gallery-dl/ }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/media/install'))).toBe(
      true
    )
  );
});
