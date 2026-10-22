import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HTTPResponse } from '@/shared/types';
import { appStorageKeys } from '@/shared/utils';
import { storePendingHandoff } from './app/handoff-store';
import { HTTPWorkbench } from './HTTPWorkbench';
import { emptyHTTPDraft } from './http-draft-store';
import { readHTTPLibrary, saveHTTPRecipe } from './http-library';
import type { OpenAPICollection } from './openapi';
import * as openAPIImport from './openapi-import';
import { protocolShellEvents } from './ProtocolShellContext';

const response: HTTPResponse = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [],
  body: 'fixture response',
  bodyEncoding: 'text',
  bytes: 16,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function collection(title = 'Fixture API'): OpenAPICollection {
  return {
    title,
    version: '1',
    source: 'fixture.json',
    baseURL: 'https://fixture.test',
    operations: [
      {
        id: `${title}-health`,
        tag: 'Health',
        method: 'GET',
        path: '/health',
        summary: 'Get health',
        url: 'https://fixture.test/health',
        query: [],
        headers: [],
        body: null,
      },
    ],
  };
}

function relayResult(value = response) {
  return { ok: true, json: async () => value, text: async () => '' } as Response;
}

async function startURLImport() {
  fireEvent.click(screen.getByRole('button', { name: 'Import OpenAPI' }));
  fireEvent.change(await screen.findByLabelText('Swagger, Scalar, or definition URL'), {
    target: { value: 'https://fixture.test/openapi.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import URL' }));
}

function loadHistoryFixture() {
  localStorage.setItem(
    appStorageKeys.httpHistory,
    JSON.stringify([
      {
        id: 'fixture-history',
        createdAt: new Date().toISOString(),
        method: 'GET',
        url: 'http://localhost:8080/history',
        requestHeaders: [],
        status: '200 History',
        statusCode: 200,
        totalMs: 1,
      },
    ])
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('HTTP request lifecycle', () => {
  it('does not reparse or remeasure a large JSON body for unrelated UI changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => relayResult())
    );
    render(<HTTPWorkbench />);
    const body = JSON.stringify({ message: 'request body fixture '.repeat(4096) });
    const tabs = screen.getByRole('tablist', { name: 'HTTP request settings' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Body' }));
    fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('HTTP request body'), { target: { value: body } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await screen.findByText('fixture response');
    const parse = vi.spyOn(JSON, 'parse');
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
    await screen.findByRole('complementary', { name: 'Saved HTTP requests' });
    fireEvent.click(screen.getByRole('button', { name: 'Close saved requests' }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Headers' }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Body' }));
    expect(parse.mock.calls.filter(([input]) => input === body)).toHaveLength(0);
    expect(encode.mock.calls.filter(([input]) => input === body)).toHaveLength(0);
    const changed = '{"message":"changed"}';
    fireEvent.change(screen.getByLabelText('HTTP request body'), { target: { value: changed } });
    expect(parse.mock.calls.some(([input]) => input === changed)).toBe(true);
    expect(encode.mock.calls.some(([input]) => input === changed)).toBe(true);
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).toHaveTextContent(
      'Editor changed'
    );
  });

  it('does not repeatedly serialize a large sent body while using unrelated workbench controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => relayResult())
    );
    render(<HTTPWorkbench />);
    const body = 'request body fixture '.repeat(4096);
    const tabs = screen.getByRole('tablist', { name: 'HTTP request settings' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Body' }));
    fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'text' } });
    fireEvent.change(screen.getByLabelText('HTTP request body'), { target: { value: body } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await screen.findByText('fixture response');
    const stringify = vi.spyOn(JSON, 'stringify');
    const fullBodySerializations = () =>
      stringify.mock.calls.filter(
        ([value]) =>
          value !== null && typeof value === 'object' && 'body' in value && value.body === body
      ).length;
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Headers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
    await screen.findByRole('complementary', { name: 'Saved HTTP requests' });
    fireEvent.click(screen.getByRole('button', { name: 'Close saved requests' }));
    expect(fullBodySerializations()).toBe(0);
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Body' }));
    fireEvent.change(screen.getByLabelText('HTTP request body'), {
      target: { value: `${body}changed` },
    });
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).toHaveTextContent(
      'Editor changed'
    );
    fireEvent.change(screen.getByLabelText('HTTP request body'), { target: { value: body } });
    expect(fullBodySerializations()).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).not.toHaveTextContent(
      'Editor changed'
    );
  });

  it('keeps the actual sent method and composed URL beside results after edits, without rendering secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => relayResult())
    );
    render(<HTTPWorkbench />);
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://fixture.test/items?token=one-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Query parameters name 1'), {
      target: { value: 'page' },
    });
    fireEvent.change(screen.getByLabelText('Query parameters value 1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await screen.findByText('fixture response');
    const evidence = screen.getByRole('region', { name: 'Sent HTTP request' });
    expect(evidence).toHaveTextContent('Requested GET');
    expect(evidence).toHaveTextContent('page=2');
    expect(evidence.textContent).not.toContain('one-secret');
    expect(evidence.querySelector('code')?.title).not.toContain('one-secret');
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://fixture.test/items?token=two-secret' },
    });
    expect(evidence).toHaveTextContent('Editor changed');
    expect(screen.getByText('fixture response')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://fixture.test/items?token=one-secret' },
    });
    expect(evidence).not.toHaveTextContent('Editor changed');
    fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'POST' } });
    expect(evidence).toHaveTextContent('Editor changed');
    expect(evidence).toHaveTextContent('Requested GET');
  });

  it('compares auth and body execution privately and clears evidence together on validation failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => relayResult())
    );
    render(<HTTPWorkbench />);
    const tabs = screen.getByRole('tablist', { name: 'HTTP request settings' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Auth' }));
    fireEvent.change(screen.getByLabelText('Auth type'), { target: { value: 'bearer' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'first-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await screen.findByText('fixture response');
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'second-secret' } });
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).toHaveTextContent(
      'Editor changed'
    );
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'first-secret' } });
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).not.toHaveTextContent(
      'Editor changed'
    );
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Body' }));
    fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'text' } });
    fireEvent.change(screen.getByLabelText('HTTP request body'), {
      target: { value: 'different-body' },
    });
    expect(screen.getByRole('region', { name: 'Sent HTTP request' })).toHaveTextContent(
      'Editor changed'
    );
    fireEvent.change(screen.getByLabelText('Request URL'), { target: { value: 'invalid remote' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(screen.queryByRole('region', { name: 'Sent HTTP request' })).not.toBeInTheDocument();
    expect(screen.queryByText('fixture response')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(localStorage.getItem(appStorageKeys.httpHistory)).not.toContain('first-secret');
  });

  it('detaches saved request identity on history replay so Update cannot overwrite it', async () => {
    saveHTTPRecipe('Original request', emptyHTTPDraft());
    loadHistoryFixture();
    render(<HTTPWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load Original request' }));
    expect(screen.getByRole('button', { name: 'Update selected' })).toBeEnabled();
    fireEvent.click(
      screen.getByText('http://localhost:8080/history').closest('button') as HTMLButtonElement
    );
    expect(screen.getByRole('button', { name: 'Update selected' })).toBeDisabled();
    expect(screen.queryByText(/Loaded “Original request”/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'History copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new' }));
    expect(readHTTPLibrary().requests).toHaveLength(2);
    expect(
      readHTTPLibrary().requests.find((item) => item.name === 'Original request')?.draft.url
    ).toBe('http://localhost:8080/');
  });

  it('loads imported operations without overwriting edits and discards a response after choosing an operation', async () => {
    const importResult = deferred<OpenAPICollection>();
    const oldResponse = deferred<Response>();
    const importer = vi
      .spyOn(openAPIImport, 'importOpenAPIFromURL')
      .mockReturnValue(importResult.promise);
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => oldResponse.promise
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<HTTPWorkbench />);
    await startURLImport();
    await waitFor(() => expect(importer).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://fixture.test/edited' },
    });
    await act(async () => importResult.resolve(collection()));
    expect(screen.getByLabelText('Request URL')).toHaveValue('https://fixture.test/edited');
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(screen.getByText('Leaving this tool cancels the request.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'GET Get health /health' }));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: /^Send/ })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Sent HTTP request' })).not.toBeInTheDocument();
    await act(async () => oldResponse.resolve(relayResult()));
    expect(screen.queryByText('fixture response')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Request URL')).toHaveValue('https://fixture.test/health');
    expect(screen.getByRole('button', { name: 'GET Get health /health' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'New request' }));
    expect(screen.getByRole('button', { name: 'GET Get health /health' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('shares import generations between URL and file, including pending state and late errors', async () => {
    const urlResult = deferred<OpenAPICollection>();
    const fileResult = deferred<OpenAPICollection>();
    const importer = vi
      .spyOn(openAPIImport, 'importOpenAPIFromURL')
      .mockReturnValue(urlResult.promise);
    const fileImporter = vi
      .spyOn(openAPIImport, 'importOpenAPIFromFile')
      .mockReturnValue(fileResult.promise);
    render(<HTTPWorkbench />);
    await startURLImport();
    await waitFor(() => expect(importer).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Choose JSON file'), {
      target: { files: [new File(['{}'], 'newer.json')] },
    });
    await waitFor(() => expect(fileImporter).toHaveBeenCalledOnce());
    expect(importer.mock.calls[0][1].aborted).toBe(true);
    await act(async () => urlResult.reject(new Error('Old URL failed')));
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    expect(screen.queryByText('Old URL failed')).not.toBeInTheDocument();
    await act(async () => fileResult.resolve(collection('Newer API')));
    expect(screen.getByRole('complementary', { name: 'Newer API operations' })).toBeVisible();
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/');
  });

  it('ignores an unabortable file result after a later URL import completes', async () => {
    const fileResult = deferred<OpenAPICollection>();
    const fileImporter = vi
      .spyOn(openAPIImport, 'importOpenAPIFromFile')
      .mockReturnValue(fileResult.promise);
    vi.spyOn(openAPIImport, 'importOpenAPIFromURL').mockResolvedValue(collection('Current API'));
    render(<HTTPWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Import OpenAPI' }));
    fireEvent.change(await screen.findByLabelText('Choose JSON file'), {
      target: { files: [new File(['{}'], 'old.json')] },
    });
    await waitFor(() => expect(fileImporter).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close API definition import' }));
    await startURLImport();
    await screen.findByRole('complementary', { name: 'Current API operations' });
    await act(async () => fileResult.resolve(collection('Old file API')));
    expect(screen.getByRole('complementary', { name: 'Current API operations' })).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Old file API operations' })
    ).not.toBeInTheDocument();
  });

  it.each([
    'history',
    'saved request',
    'handoff',
  ] as const)('invalidates pending imports when replacing the draft through %s', async (source) => {
    loadHistoryFixture();
    saveHTTPRecipe('Saved fixture', { ...emptyHTTPDraft(), url: 'https://fixture.test/saved' });
    const result = deferred<OpenAPICollection>();
    const importer = vi
      .spyOn(openAPIImport, 'importOpenAPIFromURL')
      .mockReturnValue(result.promise);
    render(<HTTPWorkbench />);
    await startURLImport();
    await waitFor(() => expect(importer).toHaveBeenCalledOnce());
    if (source === 'history') {
      fireEvent.click(
        screen.getByText('http://localhost:8080/history').closest('button') as HTMLButtonElement
      );
    } else if (source === 'saved request') {
      fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Load Saved fixture' }));
    } else {
      storePendingHandoff({
        provenance: {
          source: 'bounded-discovery',
          quality: 'observed',
          observedAt: new Date().toISOString(),
        },
        draft: {
          kind: 'http-url-draft',
          target: { kind: 'http-url', url: 'https://fixture.test/handoff' },
        },
      });
      fireEvent(window, new Event(protocolShellEvents.pendingHandoff));
    }
    const expectedURL = screen.getByLabelText<HTMLInputElement>('Request URL').value;
    expect(importer.mock.calls[0][1].aborted).toBe(true);
    await act(async () => result.resolve(collection('Outdated import')));
    expect(screen.getByLabelText('Request URL')).toHaveValue(expectedURL);
    expect(
      screen.queryByRole('complementary', { name: 'Outdated import operations' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/API definition loaded/)).not.toBeInTheDocument();
  });

  it.each([
    'close',
    'escape',
    'new request',
    'unmount',
  ] as const)('ignores a late import after %s', async (action) => {
    const result = deferred<OpenAPICollection>();
    const importer = vi
      .spyOn(openAPIImport, 'importOpenAPIFromURL')
      .mockReturnValue(result.promise);
    const view = render(<HTTPWorkbench />);
    await startURLImport();
    await waitFor(() => expect(importer).toHaveBeenCalledOnce());
    if (action === 'close')
      fireEvent.click(screen.getByRole('button', { name: 'Close API definition import' }));
    if (action === 'escape')
      fireEvent.keyDown(screen.getByLabelText('Swagger, Scalar, or definition URL'), {
        key: 'Escape',
      });
    if (action === 'new request')
      fireEvent.click(screen.getByRole('button', { name: 'New request' }));
    if (action === 'unmount') view.unmount();
    expect(importer.mock.calls[0][1].aborted).toBe(true);
    await act(async () => result.resolve(collection('Late API')));
    expect(
      screen.queryByRole('complementary', { name: 'Late API operations' })
    ).not.toBeInTheDocument();
    if (action !== 'unmount')
      expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/');
  });

  it('runs shortcuts only from request controls and ignores repeat, composition and overlays', async () => {
    const result = deferred<Response>();
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => result.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<HTTPWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Import OpenAPI' }));
    const importURL = await screen.findByLabelText('Swagger, Scalar, or definition URL');
    fireEvent.keyDown(importURL, { key: 'Enter', ctrlKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close API definition import' }));
    const url = screen.getByLabelText('Request URL');
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true, repeat: true });
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.keyDown(url, { key: 'Enter', ctrlKey: true, repeat: true });
    fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
    fireEvent.keyDown(await screen.findByLabelText('Request name'), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => result.resolve(relayResult()));
    await screen.findByText('fixture response');
  });

  it.each([
    true,
    false,
  ])('dismisses the operation drawer on selection and Send only in the drawer layout: %s', async (drawerLayout) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: drawerLayout,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    vi.spyOn(openAPIImport, 'importOpenAPIFromURL').mockResolvedValue(collection());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => relayResult())
    );
    render(<HTTPWorkbench />);
    await startURLImport();
    await screen.findByRole('complementary', { name: 'Fixture API operations' });
    fireEvent.click(screen.getByRole('button', { name: 'GET Get health /health' }));
    const trigger = screen.getByRole('button', { name: 'Fixture API operations' });
    if (drawerLayout) {
      expect(
        screen.queryByRole('complementary', { name: 'Fixture API operations' })
      ).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await waitFor(() => expect(screen.getByLabelText('Request URL')).toHaveFocus());
      fireEvent.click(trigger);
    }
    expect(screen.getByRole('complementary', { name: 'Fixture API operations' })).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', 'http-openapi-operations');
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await screen.findByText('fixture response');
    expect(trigger).toHaveAttribute('aria-expanded', String(!drawerLayout));
    expect(screen.queryByRole('complementary', { name: 'Fixture API operations' }) !== null).toBe(
      !drawerLayout
    );
  });

  it('dismisses an open desktop operation list when resizing into a drawer and returns its focus', async () => {
    let layoutChange: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          layoutChange = listener;
        },
        removeEventListener: vi.fn(),
      }))
    );
    vi.spyOn(openAPIImport, 'importOpenAPIFromURL').mockResolvedValue(collection());
    render(<HTTPWorkbench />);
    await startURLImport();
    await screen.findByRole('complementary', { name: 'Fixture API operations' });
    screen.getByLabelText('Filter imported API operations').focus();
    act(() => layoutChange?.({ matches: true } as MediaQueryListEvent));
    expect(
      screen.queryByRole('complementary', { name: 'Fixture API operations' })
    ).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Fixture API operations' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
