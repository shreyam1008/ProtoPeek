import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HTTPResponse } from '@/shared/types';
import { clearPendingHandoff } from './app/handoff-store';
import { createProtoPeekRouter } from './router';

const response: HTTPResponse = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [],
  body: 'shell shortcut response',
  bodyEncoding: 'text',
  bytes: 23,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearPendingHandoff();
  localStorage.clear();
  sessionStorage.clear();
  for (const attribute of [
    'data-density',
    'data-keyboard-hints',
    'data-theme',
    'data-theme-mode',
    'data-palette',
  ]) {
    document.documentElement.removeAttribute(attribute);
  }
});

describe('HTTP run shortcut in the real shell', () => {
  it.each([
    'navigation',
    'commands',
    'help',
    'scan',
  ] as const)('sends with closed overlays, blocks an active %s modal, and resumes after closing it', async (overlay) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/api/http/request'))
        throw new Error('Unexpected shell request.');
      return { ok: true, json: async () => response, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: ['/protocols/http'] })
    );
    render(<RouterProvider router={router} />);
    const url = await screen.findByRole('textbox', { name: 'Request URL' });
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true });
    await screen.findByText('shell shortcut response');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    let dialog: HTMLElement;
    let closeLabel: string;
    if (overlay === 'navigation') {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
      dialog = await screen.findByRole('dialog', { name: 'ProtoPeek' });
      closeLabel = 'Close navigation menu';
    } else if (overlay === 'scan') {
      fireEvent.click(screen.getByRole('button', { name: 'Inspect target' }));
      dialog = await screen.findByRole('dialog', { name: 'Scan target' });
      closeLabel = 'Close scan target dialog';
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Open global command menu' }));
      dialog = await screen.findByRole('dialog', { name: 'ProtoPeek commands' });
      closeLabel = 'Close command palette';
      if (overlay === 'help') {
        fireEvent.click(within(dialog).getByRole('option', { name: 'Open protocol checklist' }));
        dialog = await screen.findByRole('dialog', { name: 'Debug what is actually on the wire.' });
        closeLabel = 'Close help';
      }
    }
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Exercise the global modal guard even if focus has not reached the modal yet.
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: closeLabel }));
    await waitFor(() => expect(document.querySelector('[aria-modal="true"]')).toBeNull());
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText('shell shortcut response');
    expect(router.state.location.pathname).toBe('/protocols/http');
  });
});
