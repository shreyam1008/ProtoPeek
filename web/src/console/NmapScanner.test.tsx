import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NmapScanner } from './NmapScanner';

const openScan = vi.fn();
vi.mock('./ProtocolShellContext', () => ({ useProtocolShell: () => ({ openScan }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  openScan.mockClear();
  localStorage.clear();
});
const capabilities = {
  available: true,
  message: 'Installed Nmap available',
  path: '/usr/bin/nmap',
};
const scan = {
  plan: {
    target: '127.0.0.1',
    ports: [8080],
    hosts: 1,
    detectServices: false,
    arguments: ['-sT', '127.0.0.1'],
  },
  observedAt: '2026-09-06T12:00:00Z',
  inventory: {
    complete: true,
    hosts: [
      {
        id: 1,
        addresses: [{ type: 'ipv4', address: '127.0.0.1' }],
        ports: [
          {
            port: 8080,
            protocol: 'tcp',
            state: 'open',
            service: { name: 'http', method: 'table' },
          },
        ],
      },
    ],
  },
};

it('checks availability without launching a scan and explains a missing installation', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ ...capabilities, available: false, message: 'Nmap was not found.' })
  );
  vi.stubGlobal('fetch', fetch);
  render(<NmapScanner />);
  expect(await screen.findByText('Nmap was not found.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run Nmap' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Use built-in port scanner' })).toHaveAttribute(
    'href',
    '/network/ports'
  );
});

it('runs an explicit plan and hands open endpoints into inspection without probing them automatically', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) =>
    Response.json(String(input).endsWith('/scan') ? scan : capabilities)
  );
  vi.stubGlobal('fetch', fetch);
  render(<NmapScanner />);
  await screen.findByText('Installed Nmap available');
  fireEvent.change(screen.getByRole('textbox', { name: 'TCP ports' }), {
    target: { value: '8080' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /I authorize/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Run Nmap' }));
  expect(await screen.findByText('Nmap scan complete.')).toBeInTheDocument();
  expect(screen.getByText(/http · port hint/)).toBeInTheDocument();
  expect(openScan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect service' }));
  expect(openScan).toHaveBeenCalledWith({ initialTarget: '127.0.0.1:8080' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('cancels a running process request and rejects its late response', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined | null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/scan')) {
        signal = init?.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return Response.json(capabilities);
    })
  );
  render(<NmapScanner />);
  await screen.findByText('Installed Nmap available');
  fireEvent.click(screen.getByRole('checkbox', { name: /I authorize/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Run Nmap' }));
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Nmap scan' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json(scan)));
  expect(screen.getByText('Scan cancelled. Previous results are retained.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Inspect service' })).not.toBeInTheDocument();
});
