import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { appStorageKeys } from '@/shared/utils';
import { HTTPWorkbench } from './HTTPWorkbench';
import { saveHTTPEnvironments } from './http-environments';

const response = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [],
  body: 'fixture',
  bodyEncoding: 'text',
  bytes: 7,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
};
function seedEnvironment() {
  saveHTTPEnvironments({
    selectedId: 'local',
    profiles: [
      {
        id: 'local',
        name: 'Local',
        variables: [
          { name: 'base_url', value: 'http://127.0.0.1:43111', secret: false },
          { name: 'credential', value: '', secret: true },
        ],
      },
    ],
  });
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

it('uses a selected environment for an explicit send and never stores or exports custom-header secret values', async () => {
  seedEnvironment();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = render(<HTTPWorkbench />);
  await screen.findByLabelText('HTTP environment');
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Manage environments' }));
  fireEvent.click(screen.getByRole('button', { name: /^Local$/ }));
  fireEvent.change(screen.getByLabelText('Variable value 2'), {
    target: { value: 'sentinel-private-value' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save environment' }));
  fireEvent.change(screen.getByLabelText('Request URL'), {
    target: { value: '{{base_url}}/echo' },
  });
  fireEvent.click(
    within(screen.getByRole('tablist', { name: 'HTTP request settings' })).getByRole('tab', {
      name: 'Headers',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.change(screen.getByLabelText('Request headers name 1'), {
    target: { value: 'Accept' },
  });
  fireEvent.change(screen.getByLabelText('Request headers value 1'), {
    target: { value: '{{credential}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    url: 'http://127.0.0.1:43111/echo',
    headers: [{ name: 'Accept', value: 'sentinel-private-value' }],
  });
  await screen.findByText('fixture');
  fireEvent.click(screen.getByRole('button', { name: 'Copy as cURL' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).not.toContain('sentinel-private-value');
  expect(localStorage.getItem(appStorageKeys.httpHistory)).not.toContain('sentinel-private-value');
  view.unmount();
  expect(JSON.stringify({ ...localStorage })).not.toContain('sentinel-private-value');
  render(<HTTPWorkbench />);
  expect(screen.getByLabelText('Request URL')).toHaveValue('{{base_url}}/echo');
  await screen.findByLabelText('HTTP environment');
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Re-enter secret variable credential');
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('previews cURL without sending, cancels the replaced request and ignores its late result', async () => {
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<HTTPWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Import cURL' }));
  const command = await screen.findByLabelText('cURL command');
  fireEvent.change(command, {
    target: {
      value:
        "curl https://example.test/items -X POST -H 'Authorization: Bearer sentinel-import-auth' --data-raw 'unsaved-body'",
    },
  });
  fireEvent.keyDown(command, { key: 'Enter', ctrlKey: true });
  expect(fetchMock).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }));
  expect(screen.getByRole('group', { name: 'cURL request preview' })).toHaveTextContent('POST');
  expect(firstSignal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Load into editor' }));
  expect(firstSignal.aborted).toBe(true);
  expect(screen.getByLabelText('Request URL')).toHaveValue('https://example.test/items');
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => {
    resolveFirst({ ok: true, json: async () => ({ ...response, body: 'stale-result' }) });
    await first;
  });
  expect(screen.queryByText('stale-result')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
    method: 'POST',
    body: 'unsaved-body',
    headers: expect.arrayContaining([
      { name: 'Authorization', value: 'Bearer sentinel-import-auth' },
    ]),
  });
  view.unmount();
  const stored = JSON.stringify({ ...localStorage });
  expect(stored).not.toContain('sentinel-import-auth');
  expect(stored).not.toContain('unsaved-body');
});

it('missing variables fail locally and profile controls never trigger the run shortcut', async () => {
  seedEnvironment();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<HTTPWorkbench />);
  await screen.findByLabelText('HTTP environment');
  fireEvent.click(screen.getByRole('button', { name: 'Manage environments' }));
  fireEvent.click(screen.getByRole('button', { name: /^Local$/ }));
  fireEvent.keyDown(screen.getByLabelText('Variable value 1'), { key: 'Enter', ctrlKey: true });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Request URL'), {
    target: { value: '{{missing}}/items' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Set the missing variable');
  expect(fetchMock).not.toHaveBeenCalled();
});
