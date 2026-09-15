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
