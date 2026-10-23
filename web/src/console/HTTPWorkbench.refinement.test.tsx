import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { HTTPResponse } from '@/shared/types';
import { clearPendingHandoff, storePendingHandoff } from './app/handoff-store';
import { HTTPWorkbench } from './HTTPWorkbench';
import { emptyHTTPDraft, httpDraftStorageKey, writeHTTPDraft } from './http-draft-store';
import { saveHTTPRecipe } from './http-library';
import { protocolShellEvents } from './ProtocolShellContext';

afterEach(() => {
  cleanup();
  clearPendingHandoff();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function paste(value: string) {
  return fireEvent.paste(screen.getByLabelText('Request URL'), {
    clipboardData: { getData: () => value },
  });
}

function stage(url: string) {
  const stored = storePendingHandoff({
    provenance: { source: 'home', quality: 'manual', observedAt: new Date().toISOString() },
    draft: { kind: 'http-url-draft', target: { kind: 'http-url', url } },
  });
  if (!stored.ok) throw new Error(stored.error);
}

function editBody(value: string) {
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  );
  fireEvent.change(screen.getByLabelText('Body type'), { target: { value: 'text' } });
  fireEvent.change(screen.getByLabelText('HTTP request body'), { target: { value } });
}

const response: HTTPResponse = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [],
  body: 'retained-response',
  bodyEncoding: 'text',
  bytes: 17,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 1, totalMs: 2 },
};

it('keeps an oversized mobile cURL paste notice outside Response and preserves the prior sent evidence', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  const request = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', request);
  render(<HTTPWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'HTTP response evidence' })).toHaveTextContent(
      'retained-response'
    )
  );
  const panes = within(screen.getByRole('tablist', { name: 'HTTP workbench pane' }));
  fireEvent.click(panes.getByRole('tab', { name: 'Request' }));
  paste(`curl https://oversized.test/ ${'x'.repeat(512 * 1024)}`);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('512 KiB');
  expect(alert.closest('#http-mobile-pane-panel-response')).toBeNull();
  expect(panes.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(panes.getByRole('tab', { name: 'Response 200' }));
  expect(screen.getByRole('region', { name: 'HTTP response evidence' })).toHaveTextContent(
    'retained-response'
  );
  expect(screen.getByRole('region', { name: 'HTTP response evidence' })).not.toHaveTextContent(
    '512 KiB'
  );
  expect(request).toHaveBeenCalledOnce();
});

it('clears an old cURL import notice after editing or explicitly sending the current request', async () => {
  const request = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', request);
  render(<HTTPWorkbench />);
  const command = `curl https://oversized.test/ ${'x'.repeat(512 * 1024)}`;
  paste(command);
  expect(screen.getByRole('alert')).toHaveTextContent('512 KiB');
  fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'POST' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  paste(command);
  expect(screen.getByRole('alert')).toHaveTextContent('512 KiB');
  fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'HTTP response evidence' })).toHaveTextContent(
      'retained-response'
    )
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledOnce();
});

it('reviews a pasted cURL command without replacing or sending the current draft until Load', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  render(<HTTPWorkbench />);
  fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'POST' } });
  fireEvent.change(screen.getByLabelText('Request URL'), {
    target: { value: 'https://original.test/' },
  });
  editBody('original body');
  const command = `curl https://imported.test/items -X PUT -H 'Authorization: Bearer import-secret' --data-raw 'imported body'`;
  expect(paste(command)).toBe(false);
  const input = await screen.findByLabelText('cURL command');
  expect(input).toHaveValue(command);
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://original.test/');
  expect(screen.getByLabelText('HTTP request body')).toHaveValue('original body');
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }));
  expect(screen.getByRole('group', { name: 'cURL request preview' })).not.toHaveTextContent(
    'import-secret'
  );
  expect(screen.getByLabelText('HTTP method')).toHaveValue('POST');
  fireEvent.click(screen.getByRole('button', { name: 'Load into editor' }));
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://imported.test/items');
  expect(screen.getByLabelText('HTTP method')).toHaveValue('PUT');
  expect(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  ).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  );
  expect(screen.getByLabelText('HTTP request body')).toHaveValue('imported body');
  expect(request).not.toHaveBeenCalled();
});

it('keeps an invalid pasted command editable and resets an existing review on a repeated paste', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<HTTPWorkbench />);
  const command = 'curl https://fixture.test --proxy http://proxy.test';
  paste(command);
  const input = await screen.findByLabelText('cURL command');
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(input).toHaveValue(command);
  expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/');
  fireEvent.change(input, { target: { value: 'curl https://edited.test/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }));
  paste(command);
  expect(await screen.findByLabelText('cURL command')).toHaveValue(command);
  expect(screen.queryByRole('group', { name: 'cURL request preview' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves ordinary URL paste behavior and refuses oversized cURL bytes without truncation', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<HTTPWorkbench />);
  expect(paste('https://fixture.test/path?q=1')).toBe(true);
  expect(screen.queryByLabelText('cURL command')).not.toBeInTheDocument();
  const prefix = 'curl https://fixture.test/ ';
  for (const command of [prefix + 'x'.repeat(512 * 1024), prefix + 'é'.repeat(256 * 1024)]) {
    expect(paste(command)).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('512 KiB');
    expect(screen.queryByLabelText('cURL command')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/');
  }
  const exact = prefix + 'x'.repeat(512 * 1024 - prefix.length);
  paste(exact);
  expect(await screen.findByLabelText('cURL command')).toHaveValue(exact);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('recovers a previous persisted POST draft after a direct handoff on remount without sending', () => {
  vi.stubGlobal('fetch', vi.fn());
  writeHTTPDraft({
    ...emptyHTTPDraft(),
    method: 'POST',
    url: 'https://previous.test/',
    bodyMode: 'json',
    body: '{"retained":true}',
    rememberBody: true,
    timeoutSeconds: 7,
    followRedirects: true,
  });
  stage('https://next.test/path');
  render(<HTTPWorkbench />);
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://next.test/path');
  fireEvent.click(screen.getByRole('button', { name: 'Restore previous draft' }));
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://previous.test/');
  expect(screen.getByLabelText('HTTP method')).toHaveValue('POST');
  expect(screen.getByLabelText(/Timeout/)).toHaveValue(7);
  expect(screen.getByLabelText('Follow redirects')).toBeChecked();
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  );
  expect(screen.getByLabelText('HTTP request body')).toHaveValue('{"retained":true}');
  expect(screen.queryByRole('button', { name: 'Restore previous draft' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('recovers live-only body and auth in memory while keeping late responses invalidated', async () => {
  let finish!: (value: Response) => void;
  const request = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', request);
  render(<HTTPWorkbench />);
  fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'POST' } });
  fireEvent.change(screen.getByLabelText('Request URL'), {
    target: { value: 'https://previous.test/live' },
  });
  editBody('private-body');
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Auth',
    })
  );
  fireEvent.change(screen.getByLabelText('Auth type'), { target: { value: 'bearer' } });
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'private-token' } });
  fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
  const signal = request.mock.calls[0][1]?.signal;
  stage('https://next.test/');
  fireEvent(window, new Event(protocolShellEvents.pendingHandoff));
  expect(signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Restore previous draft' }));
  expect(screen.getByLabelText('Token')).toHaveValue('private-token');
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  );
  expect(screen.getByLabelText('HTTP request body')).toHaveValue('private-body');
  await act(async () =>
    finish({
      ok: true,
      json: async () => {
        throw new Error('Stale response consumed');
      },
    } as unknown as Response)
  );
  expect(request).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: 'Sent HTTP request' })).not.toBeInTheDocument();
  await waitFor(() =>
    expect(localStorage.getItem(httpDraftStorageKey)).toContain('https://previous.test/live')
  );
  expect(localStorage.getItem(httpDraftStorageKey)).not.toContain('private-body');
  expect(localStorage.getItem(httpDraftStorageKey)).not.toContain('private-token');
  fireEvent.click(screen.getByRole('button', { name: 'New request' }));
  expect(screen.queryByRole('button', { name: 'Restore previous draft' })).not.toBeInTheDocument();
});

it('keeps all50 long-named saved requests usable on mobile and closes Saved before showing Response', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  vi.stubGlobal('fetch', vi.fn());
  for (let index = 0; index < 50; index++)
    saveHTTPRecipe(`Request ${index} ${'long name '.repeat(6)}`, {
      ...emptyHTTPDraft(),
      url: `https://fixture.test/${index}`,
    });
  render(<HTTPWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
  const library = await screen.findByRole('complementary', { name: 'Saved HTTP requests' });
  expect(within(library).getAllByRole('button', { name: /^Load Request/ })).toHaveLength(50);
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP workbench pane' })).getByRole('tab', {
      name: 'Response',
    })
  );
  expect(
    screen.queryByRole('complementary', { name: 'Saved HTTP requests' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Load Request 49 / }));
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://fixture.test/49');
  expect(
    screen.queryByRole('complementary', { name: 'Saved HTTP requests' })
  ).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('discards the secret-bearing recovery after sending and only restores the next current draft', async () => {
  const request = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', request);
  render(<HTTPWorkbench />);
  editBody('discarded-private-body');
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Auth',
    })
  );
  fireEvent.change(screen.getByLabelText('Auth type'), { target: { value: 'bearer' } });
  fireEvent.change(screen.getByLabelText('Token'), {
    target: { value: 'discarded-private-token' },
  });
  stage('https://current.test/');
  fireEvent(window, new Event(protocolShellEvents.pendingHandoff));
  expect(screen.getByRole('button', { name: 'Restore previous draft' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'HTTP response evidence' })).toHaveTextContent(
      'retained-response'
    )
  );
  expect(screen.queryByRole('button', { name: 'Restore previous draft' })).not.toBeInTheDocument();
  stage('https://next.test/');
  fireEvent(window, new Event(protocolShellEvents.pendingHandoff));
  fireEvent.click(screen.getByRole('button', { name: 'Restore previous draft' }));
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://current.test/');
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Auth',
    })
  );
  expect(screen.getByLabelText('Auth type')).toHaveValue('none');
  expect(screen.queryByDisplayValue('discarded-private-token')).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Body',
    })
  );
  expect(screen.getByLabelText('HTTP request body')).toHaveValue('');
  expect(request).toHaveBeenCalledOnce();
});
