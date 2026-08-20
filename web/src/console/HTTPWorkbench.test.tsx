import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HTTPResponse } from '@/shared/types';
import { appStorageKeys } from '@/shared/utils';

import { HTTPWorkbench } from './HTTPWorkbench';

const response: HTTPResponse = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: '{"ok":true}',
  bodyEncoding: 'text',
  bytes: 11,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
};

function renderWorkbench() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HTTPWorkbench />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('HTTPWorkbench', () => {
  it('sends live auth but redacts it from automatic local history', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=test-token; path=/';
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        ({
          ok: true,
          json: async () => response,
          text: async () => '',
        }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWorkbench();

    fireEvent.click(screen.getByRole('tab', { name: 'Auth' }));
    fireEvent.change(screen.getByLabelText('Auth type'), { target: { value: 'bearer' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'super-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));

    await waitFor(() => expect(screen.getAllByText('200 OK').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(String(init?.body)) as {
      headers: Array<{ name: string; value: string }>;
    };
    expect(sent.headers).toContainEqual({ name: 'Authorization', value: 'Bearer super-secret' });

    const stored = window.localStorage.getItem(appStorageKeys.httpHistory) ?? '';
    expect(stored).not.toContain('super-secret');
    expect(stored).toContain('[redacted]');
  });

  it('exposes request and response tabs with matching tab panels', () => {
    renderWorkbench();
    const paramsTab = screen.getByRole('tab', { name: 'Params' });
    expect(paramsTab).toHaveAttribute('aria-controls', 'http-request-panel-params');
    expect(document.getElementById('http-request-panel-params')).toHaveAttribute(
      'aria-labelledby',
      'http-request-tab-params'
    );
    expect(screen.getByText('TLS verification on')).toBeInTheDocument();
  });

  it('closes HTTP history after loading an entry', () => {
    window.localStorage.setItem(
      appStorageKeys.httpHistory,
      JSON.stringify([
        {
          id: 'history-1',
          createdAt: '2026-08-20T00:00:00.000Z',
          method: 'GET',
          url: 'http://localhost:8080/from-history',
          requestHeaders: [],
          status: '200 OK',
          statusCode: 200,
          totalMs: 3,
        },
      ])
    );
    renderWorkbench();

    const historyURL = screen.getByText('http://localhost:8080/from-history');
    const details = historyURL.closest('details');
    const entry = historyURL.closest('button');
    expect(details).not.toBeNull();
    expect(entry).not.toBeNull();
    if (!details || !entry) return;
    details.open = true;
    fireEvent.click(entry);

    expect(details.open).toBe(false);
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/from-history');
  });
});
