import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  vi.useRealTimers();
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

it('backs off idle polling and refreshes active offers and transfers every second', async () => {
  vi.useFakeTimers();
  const job = {
    id: 'offer1',
    name: 'capture.pcap',
    peer: 'Laptop',
    size: 100,
    bytes: 0,
    direction: 'receive',
    state: 'pending',
    started: new Date().toISOString(),
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => running })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...running, jobs: [job] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...running, jobs: [{ ...job, state: 'receiving' }] }),
    })
    .mockResolvedValue({
      ok: true,
      json: async () => ({ ...running, jobs: [{ ...job, state: 'completed' }] }),
    });
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(3999));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole('button', { name: 'Accept file' })).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('button', { name: 'Cancel capture.pcap' })).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(fetch).toHaveBeenCalledTimes(4);
  await act(async () => vi.advanceTimersByTimeAsync(3999));
  expect(fetch).toHaveBeenCalledTimes(4);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(fetch).toHaveBeenCalledTimes(5);
});

it('stays Offline after Stop aborts an in-flight poll and ignores its late snapshot', async () => {
  vi.useFakeTimers();
  let pollSignal: AbortSignal | undefined;
  let resolvePoll!: (response: object) => void;
  let snapshots = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/stop')) return { ok: true, json: async () => stopped };
    if (++snapshots === 1) return { ok: true, json: async () => running };
    pollSignal = init.signal as AbortSignal;
    return new Promise((resolve) => {
      resolvePoll = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(snapshots).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
  await act(async () => {});
  expect(pollSignal?.aborted).toBe(true);
  expect(screen.getByText('Offline')).toBeVisible();
  expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
  await act(async () => resolvePoll({ ok: true, json: async () => running }));
  expect(screen.getByRole('button', { name: 'Enable local transfer' })).toBeDisabled();
  expect(screen.getByText('Offline')).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(12000));
  expect(snapshots).toBe(2);
});

it('ignores a delayed send-cleanup snapshot that arrives after Stop sharing', async () => {
  vi.useFakeTimers();
  let resolveCleanup!: (response: object) => void;
  let cleanupSignal: AbortSignal | null | undefined;
  let snapshots = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/stop')) return { ok: true, json: async () => stopped };
    if (url.includes('/send?')) return { ok: true, json: async () => ({}) };
    if (++snapshots === 1) return { ok: true, json: async () => running };
    cleanupSignal = init.signal;
    return new Promise((resolve) => {
      resolveCleanup = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Laptop 192/ }));
  fireEvent.change(screen.getByLabelText(/Select files to send/), {
    target: { files: [new File(['owned fixture'], 'capture.txt')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send 1 file' }));
  await act(async () => {});
  expect(screen.getByText('Files received and checksums matched.')).toBeVisible();
  expect(snapshots).toBe(2);
  expect(cleanupSignal).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
  await act(async () => {});
  expect(screen.getByText('Offline')).toBeVisible();
  await act(async () => resolveCleanup({ ok: true, json: async () => running }));
  expect(screen.getByText('Offline')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Stop sharing' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enable local transfer' })).toBeDisabled();
  await act(async () => vi.advanceTimersByTimeAsync(12000));
  expect(snapshots).toBe(2);
});

it('keeps sub-kilobyte transfer speeds readable without long fractional bytes', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...running,
      jobs: [
        {
          id: 'active1',
          name: 'capture.pcap',
          peer: 'Laptop',
          size: 2048,
          bytes: 512,
          direction: 'receive',
          state: 'receiving',
          started: new Date(Date.now() - 3000).toISOString(),
        },
      ],
    }),
  }));
  vi.stubGlobal('fetch', fetch);
  render(<LocalTransfer />);
  await act(async () => {});
  expect(screen.getByText('512 B / 2.0 KB · 171 B/s average')).toBeVisible();
});
