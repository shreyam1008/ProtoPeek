import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { clearPendingHandoff } from './app/handoff-store';
import { httpDraftStorageKey } from './http-draft-store';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearPendingHandoff();
  localStorage.clear();
  sessionStorage.clear();
});

it('redacts an actual Home→HTTP query handoff during autosave, pagehide and unmount without sending it', async () => {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL) =>
    Response.json({ initialScanTarget: '' })
  );
  vi.stubGlobal('fetch', fetchMock);
  const draftWrites = vi.spyOn(Storage.prototype, 'setItem');
  const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/'] }));
  const rendered = render(<RouterProvider router={router} />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Service address' }), {
    target: { value: 'https://example.com/health?access_token=home-sentinel&view=detail' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Open a service' }));
  expect(await screen.findByRole('textbox', { name: 'Request URL' })).toHaveValue(
    'https://example.com/health?access_token=home-sentinel&view=detail'
  );
  expect(
    screen.getByText(/HTTP drafts autosave with recognized credentials redacted/)
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem(httpDraftStorageKey) ?? '{}').url).toContain('/health')
  );
  const assertPrivate = () => {
    const raw = localStorage.getItem(httpDraftStorageKey) ?? '';
    expect(raw).not.toContain('home-sentinel');
    const saved = new URL(JSON.parse(raw).url);
    expect(saved.searchParams.get('access_token')).toBe('[redacted]');
    expect(saved.searchParams.get('view')).toBe('detail');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('home-sentinel');
  };
  const writes = () => draftWrites.mock.calls.filter(([key]) => key === httpDraftStorageKey);
  assertPrivate();
  const autosaves = writes().length;
  expect(autosaves).toBeGreaterThan(0);
  fireEvent(window, new Event('pagehide'));
  expect(writes()).toHaveLength(autosaves + 1);
  assertPrivate();
  rendered.unmount();
  expect(writes()).toHaveLength(autosaves + 2);
  assertPrivate();
  expect(writes().every(([, raw]) => !raw.includes('home-sentinel'))).toBe(true);
  expect(
    fetchMock.mock.calls.every(([url]) => new URL(String(url)).pathname.endsWith('/api/bootstrap'))
  ).toBe(true);
});
