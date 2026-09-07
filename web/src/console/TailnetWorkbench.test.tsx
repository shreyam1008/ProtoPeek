import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TailnetWorkbench } from './TailnetWorkbench';
import type { TailSnapshot } from './tailnet-api';

const openScan = vi.fn();
vi.mock('./ProtocolShellContext', () => ({ useProtocolShell: () => ({ openScan }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  openScan.mockClear();
  localStorage.clear();
});
const snapshot: TailSnapshot = {
  available: true,
  path: '/usr/bin/tailscale',
  observedAt: '2026-09-06T12:00:00Z',
  revision: 'revision1',
  version: '1.fixture',
  state: 'Running',
  tailnet: 'example.test',
  magicDNS: 'fixture.ts.net',
  self: null,
  peers: [
    {
      id: 'peer1',
      name: 'Dev peer',
      dnsName: 'dev.fixture.ts.net',
      os: 'linux',
      ips: ['100.64.0.2'],
      routes: [],
      online: true,
      active: false,
      connection: 'idle',
      endpoint: '',
      relay: 'nyc',
      exitNode: false,
      exitNodeOption: true,
      taildropAvailable: false,
      fileSharingReason: '',
      lastSeen: '',
      lastHandshake: '',
      keyExpiry: '',
      rxBytes: '10',
      txBytes: '20',
    },
  ],
  profiles: [
    {
      id: 'work',
      nickname: 'Work',
      account: 'user@example.test',
      tailnet: 'example.test',
      selected: true,
    },
  ],
  warnings: [],
};

it('stays quiet until inspection and prepares a service handoff without probing it', async () => {
  const fetch = vi.fn(async () => Response.json(snapshot));
  vi.stubGlobal('fetch', fetch);
  render(<TailnetWorkbench />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  await screen.findByRole('button', { name: 'Dev peer' });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect peer service' }));
  expect(openScan).toHaveBeenCalledWith({ initialTarget: '100.64.0.2:80' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('requires an explicit reviewed action and sends the observed revision', async () => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    Response.json(url.endsWith('/action') ? { output: 'done', arguments: ['down'] } : snapshot)
  );
  vi.stubGlobal('fetch', fetch);
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(screen.getByRole('button', { name: 'Run selected operation' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  await screen.findByText('done');
  const init = fetch.mock.calls[1][1] as RequestInit;
  expect(JSON.parse(String(init.body))).toEqual({
    action: 'disconnect',
    target: '',
    path: '',
    revision: 'revision1',
    consent: true,
  });
});

it('aborts inspection and discards its late response', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    })
  );
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel operation' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json(snapshot)));
  expect(screen.queryByRole('button', { name: 'Dev peer' })).not.toBeInTheDocument();
});

it('explains a missing client without showing available network controls', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ ...snapshot, available: false, warnings: ['Tailscale was not found.'] })
    )
  );
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  expect(await screen.findByRole('link', { name: 'Install Tailscale' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Accounts' })).not.toBeInTheDocument();
});
