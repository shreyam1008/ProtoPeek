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
  expect(await screen.findByRole('button', { name: 'Run selected operation' })).toBeDisabled();
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

it('previews a separate HTTPS Headscale login and offers a reviewed switch back', async () => {
  const accounts = [
    ...snapshot.profiles,
    {
      id: 'custom',
      nickname: 'Headscale',
      account: 'headscale-user',
      tailnet: 'private.test',
      selected: true,
    },
  ];
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    Response.json(
      url.endsWith('/action')
        ? {
            outcome: 'completed',
            output: 'Login completed privately.',
            observedAt: snapshot.observedAt,
            previousProfileId: 'work',
            snapshot: {
              ...snapshot,
              accountsObserved: true,
              profiles: accounts.map((profile) => ({
                ...profile,
                selected: profile.id === 'custom',
              })),
            },
          }
        : { ...snapshot, accountsObserved: true }
    )
  );
  vi.stubGlobal('fetch', fetch);
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
  const server = await screen.findByLabelText('Control-server URL');
  fireEvent.change(server, { target: { value: 'https://headscale.example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review custom login' }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(await screen.findByRole('button', { name: 'Run selected operation' })).toBeDisabled();
  expect(screen.getByText('Finish sign-in on this computer')).toBeInTheDocument();
  expect(screen.getByText(/native terminal prints the private browser/)).toBeInTheDocument();
  expect(screen.getByText(/On Linux, login may require sudo/)).toBeInTheDocument();
  expect(
    screen.getAllByText("tailscale login '--login-server=https://headscale.example.test/'")
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  expect(
    await screen.findByRole('button', { name: 'Review switch back to previous account' })
  ).toBeInTheDocument();
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
    action: 'login-server',
    target: 'https://headscale.example.test/',
    revision: 'revision1',
    consent: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review switch back to previous account' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Run selected operation' })).toBeDisabled();
});

it('normalizes Unicode control-server URL quotes before showing shell-safe native commands', async () => {
  const fetch = vi.fn(async () => Response.json({ ...snapshot, accountsObserved: true }));
  vi.stubGlobal('fetch', fetch);
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
  fireEvent.change(await screen.findByLabelText('Control-server URL'), {
    target: { value: "https://headscale.example.test/it’s/o'neal" },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review custom login' }));
  await screen.findByText('Finish sign-in on this computer');
  expect(
    screen.getByText(
      "tailscale login '--login-server=https://headscale.example.test/it%E2%80%99s/o''neal'"
    )
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "tailscale login '--login-server=https://headscale.example.test/it%E2%80%99s/o'\"'\"'neal'"
    )
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
});

it('retains the failed409 outcome and newly observed daemon state without reporting success', async () => {
  const fetch = vi.fn(async (url: URL | string) =>
    String(url).endsWith('/action')
      ? Response.json(
          {
            action: 'disconnect',
            outcome: 'failed',
            output: 'The native client reported a permission restriction.',
            observedAt: snapshot.observedAt,
            snapshot: { ...snapshot, state: 'Stopped', revision: 'revision2' },
          },
          { status: 409 }
        )
      : Response.json(snapshot)
  );
  vi.stubGlobal('fetch', fetch);
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  expect(
    await screen.findByText(
      'Operation did not complete. Review the observed state before retrying.'
    )
  ).toBeVisible();
  expect(screen.getByText('Stopped')).toBeVisible();
  expect(screen.getByText('The native client reported a permission restriction.')).toBeVisible();
  expect(
    screen.queryByText('CLI completed. Current daemon state was observed again.')
  ).not.toBeInTheDocument();
});

it('clears stale controls but retains failed409 output when native reobservation is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) =>
      String(url).endsWith('/action')
        ? Response.json(
            {
              action: 'disconnect',
              outcome: 'failed',
              output: 'The native client reported a permission restriction.',
              observedAt: snapshot.observedAt,
            },
            { status: 409 }
          )
        : Response.json(snapshot)
    )
  );
  render(<TailnetWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Tailscale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  expect(
    await screen.findByText('The native client reported a permission restriction.')
  ).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Operation did not complete');
  expect(screen.queryByRole('button', { name: 'Accounts' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect Tailscale' })).toBeEnabled();
});
