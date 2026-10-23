import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalTransfer } from './LocalTransfer';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
const stopped = {
  running: false,
  name: '',
  directory: '',
  fingerprint: '',
  addresses: [],
  peers: [],
  jobs: [],
  warning: '',
};
const running = {
  ...stopped,
  running: true,
  name: 'Workstation',
  directory: '/downloads',
  fingerprint: 'a'.repeat(64),
  peers: [{ id: 'b'.repeat(64), name: 'Laptop', address: '192.168.1.2:53318' }],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('stays off until a receive folder is chosen and sharing is enabled', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    json: async () => (JSON.parse(String(init.body)).directory ? running : stopped),
  }));
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  const enable = await screen.findByRole('button', { name: 'Enable local transfer' });
  expect(enable).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Receive folder'), { target: { value: '/downloads' } });
  fireEvent.click(enable);
  expect(await screen.findByText('Discoverable')).toBeVisible();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/start'))).toBe(true);
});

it('shows an incoming offer and sends the explicit acceptance', async () => {
  const offer = {
    id: 'offer1',
    name: 'trace.pcap',
    peer: 'Laptop (192.168.1.2)',
    size: 100,
    bytes: 0,
    direction: 'receive',
    state: 'pending',
    started: new Date().toISOString(),
  };
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...running, jobs: [offer] }),
  }));
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept file' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/decide'),
      expect.objectContaining({ body: JSON.stringify({ id: 'offer1', accept: true }) })
    )
  );
});

it('streams selected File bytes only after a receiver is chosen', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => running }));
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await screen.findByText('Discoverable');
  const file = new File(['evidence'], 'capture.txt');
  fireEvent.change(screen.getByLabelText(/Select files to send/), { target: { files: [file] } });
  expect(screen.getByRole('button', { name: 'Send 1 file' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Laptop 192/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send 1 file' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/send?'),
      expect.objectContaining({ body: file, method: 'POST' })
    )
  );
  expect(await screen.findByText('Files received and checksums matched.')).toBeVisible();
});

it('recovers an unavailable initial snapshot without pretending sharing is enabled', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('Local transfer is disabled for this host.'))
    .mockResolvedValue({ ok: true, json: async () => stopped });
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Local transfer is disabled');
  expect(screen.getByText('Unavailable')).toBeVisible();
  expect(screen.queryByText('Loading local transfer…')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enable local transfer' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByRole('button', { name: 'Enable local transfer' })).toBeDisabled();
  expect(screen.getByText('Offline')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetch.mock.calls).toHaveLength(2);
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/snapshot'))).toBe(true);
});

it('cancels the active file upload and keeps unsent files available to retry', async () => {
  let uploadSignal: AbortSignal | undefined;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/send?')) {
      uploadSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        uploadSignal?.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError'))
        );
      });
    }
    return { ok: true, json: async () => running };
  });
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await screen.findByText('Discoverable');
  fireEvent.click(screen.getByRole('button', { name: /Laptop 192/ }));
  fireEvent.change(screen.getByLabelText(/Select files to send/), {
    target: { files: [new File(['owned fixture'], 'trace.pcap')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send 1 file' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel sending' }));
  expect(uploadSignal?.aborted).toBe(true);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Sending cancelled. Completed files remain on the receiver.'
  );
  expect(screen.getByRole('button', { name: 'Send 1 file' })).toBeEnabled();
  expect(fetch.mock.calls.filter(([url]) => url.includes('/send?'))).toHaveLength(1);
  expect(screen.queryByText('Files received and checksums matched.')).not.toBeInTheDocument();
});

it('rejects ambiguous manual invitations without contacting a peer', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => running }));
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await screen.findByText('Discoverable');
  fireEvent.change(screen.getByLabelText('Receiver connection'), {
    target: { value: `127.0.0.1:53318#${'b'.repeat(64)}#unexpected` },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect device' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Paste the receiver’s connection text');
  expect(fetch.mock.calls).toHaveLength(1);
});
