import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HTTPResponse } from '@/shared/types';
import { appStorageKeys } from '@/shared/utils';

import { HTTPWorkbench } from './HTTPWorkbench';
import { protocolShellEvents } from './ProtocolShellContext';

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
  vi.restoreAllMocks();
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

  it('deterministically clears non-persisted request and response state on history replay', async () => {
    window.localStorage.setItem(
      appStorageKeys.httpHistory,
      JSON.stringify([
        {
          id: 'history-reset',
          createdAt: '2026-08-20T00:00:00.000Z',
          method: 'GET',
          url: 'http://localhost:8080/reset-target',
          requestHeaders: [],
          status: '204 No Content',
          statusCode: 204,
          totalMs: 3,
        },
      ])
    );
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

    fireEvent.change(screen.getByLabelText(/Timeout/), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Follow redirects'));
    fireEvent.click(
      within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
        name: 'Body',
      })
    );
    fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('HTTP request body'), {
      target: { value: '{"stale":true}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Response 200' })).toBeInTheDocument()
    );
    await waitFor(() => {
      const storedHistory = window.localStorage.getItem(appStorageKeys.httpHistory) ?? '[]';
      expect(JSON.parse(storedHistory)).toHaveLength(2);
      expect(storedHistory).not.toContain('stale');
    });

    const resetEntry = screen.getByText('http://localhost:8080/reset-target').closest('button');
    expect(resetEntry).not.toBeNull();
    if (!resetEntry) return;
    fireEvent.click(resetEntry);

    expect(screen.getByLabelText(/Timeout/)).toHaveValue(30);
    expect(screen.getByLabelText('Follow redirects')).not.toBeChecked();
    expect(screen.getByLabelText('Body type')).toHaveValue('none');
    expect(screen.getByLabelText('HTTP request body')).toBeDisabled();
    expect(screen.getByLabelText('HTTP request body')).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'Response' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      body: '',
      timeoutMs: 30000,
      followRedirects: false,
    });
  });

  it('never replays redacted query or header placeholders', async () => {
    window.localStorage.setItem(
      appStorageKeys.httpHistory,
      JSON.stringify([
        {
          id: 'history-redacted',
          createdAt: '2026-08-20T00:00:00.000Z',
          method: 'GET',
          url: 'https://example.test/items?token=%5Bredacted%5D&page=2',
          requestHeaders: [
            { name: 'Authorization', value: '[redacted]' },
            { name: 'Accept', value: 'application/json' },
          ],
          status: '200 OK',
          statusCode: 200,
          totalMs: 3,
        },
      ])
    );
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        ({ ok: true, json: async () => response, text: async () => '' }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWorkbench();

    fireEvent.click(
      screen.getByText(/example\.test\/items/).closest('button') as HTMLButtonElement
    );
    expect(screen.getByRole('status')).toHaveTextContent(/redacted values were omitted/i);
    expect(screen.getByLabelText('Request URL')).toHaveValue(
      'https://example.test/items?token=&page=2'
    );
    expect(screen.getByLabelText('Request URL')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      url: string;
      headers: Array<{ name: string; value: string }>;
    };
    expect(sent.url).not.toContain('[redacted]');
    expect(sent.url).not.toContain('%5Bredacted%5D');
    expect(sent.headers).toEqual([{ name: 'Accept', value: 'application/json' }]);
  });

  it('aborts and ignores stale work when history is loaded during an in-flight request', async () => {
    window.localStorage.setItem(
      appStorageKeys.httpHistory,
      JSON.stringify([
        {
          id: 'history-race',
          createdAt: '2026-08-20T00:00:00.000Z',
          method: 'GET',
          url: 'http://localhost:8080/from-history',
          requestHeaders: [],
          status: '204 No Content',
          statusCode: 204,
          totalMs: 3,
        },
      ])
    );
    const resolvers: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => resolvers.push(resolve))
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    fireEvent.click(
      screen.getByText('http://localhost:8080/from-history').closest('button') as HTMLButtonElement
    );
    expect(firstSignal.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolvers[0]?.({
      ok: true,
      json: async () => ({ ...response, status: '201 Old', statusCode: 201 }),
      text: async () => '',
    } as Response);
    await Promise.resolve();
    expect(screen.queryByText('201 Old')).not.toBeInTheDocument();

    resolvers[1]?.({
      ok: true,
      json: async () => ({ ...response, status: '202 Current', statusCode: 202 }),
      text: async () => '',
    } as Response);
    await waitFor(() => expect(screen.getAllByText('202 Current').length).toBeGreaterThan(0));
    expect(screen.queryByText('201 Old')).not.toBeInTheDocument();
    const stored = window.localStorage.getItem(appStorageKeys.httpHistory) ?? '';
    expect(stored).toContain('202 Current');
    expect(stored).not.toContain('201 Old');
  });

  it('turns a rapid second send into cancellation instead of overlap', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>(() => {
          // Keep the first request pending so the second click exercises cancellation.
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWorkbench();

    const send = screen.getByRole('button', { name: /^Send/ });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toHaveProperty('aborted', true);
  });

  it('sanitizes malformed and credential-bearing stored history without crashing', async () => {
    window.localStorage.setItem(appStorageKeys.httpHistory, JSON.stringify({ invalid: true }));
    const { unmount } = renderWorkbench();
    expect(screen.getByText(/Send a request to build local history/)).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(
      appStorageKeys.httpHistory,
      JSON.stringify([
        {
          id: 'history-secret-header',
          createdAt: '2026-08-20T00:00:00.000Z',
          method: 'GET',
          url: 'https://example.test/',
          requestHeaders: [
            { name: 'X-Password', value: 'hunter2' },
            { name: 'X-Credential', value: 'credential' },
          ],
          status: '200 OK',
          statusCode: 200,
          totalMs: 3,
        },
      ])
    );
    renderWorkbench();
    await waitFor(() => {
      const stored = window.localStorage.getItem(appStorageKeys.httpHistory) ?? '';
      expect(stored).not.toContain('hunter2');
      expect(stored).not.toContain('credential"');
      expect(stored).toContain('[redacted]');
    });
  });

  it('reports when HTTP history cannot be persisted', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    renderWorkbench();
    expect(await screen.findByRole('status')).toHaveTextContent(/session-only.*Quota exceeded/i);
  });

  it('accepts a discovery handoff while the HTTP workbench is already mounted', () => {
    window.localStorage.setItem(
      appStorageKeys.pendingHTTPURL,
      JSON.stringify('https://127.0.0.1:8443/')
    );
    renderWorkbench();

    window.localStorage.setItem(
      appStorageKeys.pendingHTTPURL,
      JSON.stringify('http://127.0.0.1:8081/')
    );
    fireEvent(
      window,
      new CustomEvent<string>(protocolShellEvents.openHTTPDiscovery, {
        detail: 'http://127.0.0.1:8081/',
      })
    );

    expect(screen.getByLabelText('Request URL')).toHaveValue('http://127.0.0.1:8081/');
    expect(window.localStorage.getItem(appStorageKeys.pendingHTTPURL)).toBeNull();
  });

  it('treats mounted discovery as a clean origin boundary and ignores prior work', async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    let resolveNew: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return new Promise<Response>((resolve) => {
        resolveNew = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkbench();

    fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'POST' } });
    const paramsPanel = document.getElementById('http-request-panel-params');
    expect(paramsPanel).not.toBeNull();
    if (!paramsPanel) return;
    fireEvent.click(within(paramsPanel).getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Query parameters name 1'), {
      target: { value: 'old-param' },
    });
    fireEvent.change(screen.getByLabelText('Query parameters value 1'), {
      target: { value: 'old-value' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Auth' }));
    fireEvent.change(screen.getByLabelText('Auth type'), { target: { value: 'bearer' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'old-secret' } });
    fireEvent.click(
      within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
        name: 'Body',
      })
    );
    fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('HTTP request body'), {
      target: { value: '{"old":true}' },
    });
    fireEvent.change(screen.getByLabelText(/Timeout/), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Follow redirects'));
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;

    window.localStorage.setItem(
      appStorageKeys.pendingHTTPURL,
      JSON.stringify('http://127.0.0.1:8082/new')
    );
    fireEvent(
      window,
      new CustomEvent<string>(protocolShellEvents.openHTTPDiscovery, {
        detail: 'http://127.0.0.1:8082/new',
      })
    );

    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByLabelText('HTTP method')).toHaveValue('GET');
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://127.0.0.1:8082/new');
    expect(screen.getByLabelText(/Timeout/)).toHaveValue(30);
    expect(screen.getByLabelText('Follow redirects')).not.toBeChecked();
    expect(screen.getByLabelText('Body type')).toHaveValue('none');
    expect(screen.getByLabelText('HTTP request body')).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'Params' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Response' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Request URL')).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      method: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
      body: string;
      timeoutMs: number;
      followRedirects: boolean;
    };
    expect(sent).toMatchObject({
      method: 'GET',
      url: 'http://127.0.0.1:8082/new',
      headers: [],
      body: '',
      timeoutMs: 30000,
      followRedirects: false,
    });
    resolveOld?.({
      ok: true,
      json: async () => ({ ...response, status: '201 Old', statusCode: 201 }),
      text: async () => '',
    } as Response);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Cancel/ })).toBeInTheDocument()
    );
    expect(screen.queryByText('201 Old')).not.toBeInTheDocument();

    resolveNew?.({
      ok: true,
      json: async () => ({ ...response, status: '202 Current', statusCode: 202 }),
      text: async () => '',
    } as Response);
    await waitFor(() => expect(screen.getAllByText('202 Current').length).toBeGreaterThan(0));
    const stored = window.localStorage.getItem(appStorageKeys.httpHistory) ?? '';
    expect(stored).toContain('202 Current');
    expect(stored).not.toContain('201 Old');
    expect(stored).not.toContain('old-secret');
    expect(stored).not.toContain('old-param');
  });

  it('keeps browser-storage failure evidence visible across discovery handoffs', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.stubGlobal('fetch', vi.fn());
    renderWorkbench();
    expect(await screen.findByText(/HTTP history is session-only.*Quota exceeded/i)).toBeVisible();

    fireEvent(
      window,
      new CustomEvent<string>(protocolShellEvents.openHTTPDiscovery, {
        detail: 'http://127.0.0.1:8083/new',
      })
    );
    expect(screen.getByText(/HTTP history is session-only.*Quota exceeded/i)).toBeVisible();
    expect(screen.queryByLabelText('Dismiss HTTP history notice')).not.toBeInTheDocument();
  });
});
