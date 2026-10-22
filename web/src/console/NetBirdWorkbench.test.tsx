import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NetBirdWorkbench } from './NetBirdWorkbench';
import type { NetBirdSnapshot } from './netbird-api';

const openScan = vi.fn();
vi.mock('./ProtocolShellContext', () => ({ useProtocolShell: () => ({ openScan }) }));
const snapshot: NetBirdSnapshot = {
  available: true,
  path: '/fixture/netbird',
  observedAt: '2026-10-22T12:00:00Z',
  revision: 'fresh',
  cliVersion: '0.81.3',
  daemonVersion: '0.81.3',
  state: 'Connected',
  profile: 'Work',
  ips: ['100.64.0.1'],
  fqdn: 'this.test',
  management: { url: 'https://management.test', connected: true, hasError: false },
  signal: { url: 'https://signal.test', connected: true, hasError: false },
  peers: [
    {
      id: 'peer',
      name: 'peer.test',
      ips: ['100.64.0.2'],
      state: 'Connected',
      connectionType: 'P2P',
      ice: { local: 'host', remote: 'srflx' },
      endpoints: { local: '192.0.2.1:123', remote: '198.51.100.1:456' },
      relay: '',
      latencyMs: 12.5,
      received: '9223372036854775807',
      sent: '0',
      networks: [],
    },
  ],
  peerTotal: 1,
  relays: [{ uri: 'rels://relay.test', available: true, transport: 'quic', hasError: false }],
  dns: [{ servers: ['100.64.0.1:53'], domains: ['private.test'], enabled: true, hasError: false }],
  warnings: [],
  connectAllowed: false,
  disconnectAllowed: true,
  controlReason: '',
  environment: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  openScan.mockClear();
});

it('stays quiet and preserves separate native evidence with only an unsent peer handoff', async () => {
  const fetch = vi.fn(async () => Response.json(snapshot));
  vi.stubGlobal('fetch', fetch);
  render(<NetBirdWorkbench />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  await screen.findByRole('heading', { name: 'Management' });
  expect(screen.getByRole('heading', { name: 'Signal' })).toBeInTheDocument();
  expect(screen.getByText(/12.50 ms/)).toBeInTheDocument();
  expect(screen.getByText(/host \/ srflx/)).toBeInTheDocument();
  expect(screen.getByText(/quic/)).toBeInTheDocument();
  expect(screen.getByText(/private.test/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect peer service' }));
  expect(openScan).toHaveBeenCalledWith({ initialTarget: '100.64.0.2:80' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('requires review and consent, sends the observed revision, and shows reobserved daemon state', async () => {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/action')
        ? {
            outcome: 'completed',
            message: 'Daemon observed after CLI completion.',
            snapshot: {
              ...snapshot,
              state: 'Idle',
              connectAllowed: true,
              disconnectAllowed: false,
            },
          }
        : snapshot
    )
  );
  vi.stubGlobal('fetch', fetch);
  render(<NetBirdWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review disconnect' }));
  expect(screen.getByRole('button', { name: 'Run selected operation' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  await screen.findByText('Daemon observed after CLI completion.');
  expect(
    JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))
  ).toEqual({ action: 'disconnect', revision: 'fresh', consent: true });
  expect(screen.getByText('Idle')).toBeInTheDocument();
});

it('aborts an action, invalidates controls and discards a late daemon response', async () => {
  let complete!: (value: Response) => void;
  let signal!: AbortSignal;
  const fetch = vi.fn((url: string, init: RequestInit) =>
    url.endsWith('/action')
      ? new Promise<Response>((resolve) => {
          complete = resolve;
          signal = init.signal as AbortSignal;
        })
      : Promise.resolve(Response.json(snapshot))
  );
  vi.stubGlobal('fetch', fetch);
  render(<NetBirdWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review disconnect' }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I authorize this operation on this computer.' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run selected operation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel operation' }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent(
    'accepted daemon action may already have applied'
  );
  expect(screen.queryByRole('button', { name: 'Review disconnect' })).not.toBeInTheDocument();
  await act(async () =>
    complete(Response.json({ outcome: 'completed', message: 'stale-result', snapshot }))
  );
  expect(screen.queryByText('stale-result')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect NetBird' })).toBeEnabled();
});

it('cancels inspection without implying a daemon action and ignores its late observation', async () => {
  let complete!: (value: Response) => void;
  let signal!: AbortSignal;
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(<NetBirdWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel operation' }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Inspection cancelled locally. No daemon action was requested.'
  );
  await act(async () => complete(Response.json(snapshot)));
  expect(screen.queryByRole('heading', { name: 'Management' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps unavailable clients and environment-conflicted controls explicit', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...snapshot,
        connectAllowed: false,
        disconnectAllowed: false,
        environment: ['NB_DAEMON_ADDR'],
        controlReason: 'Restart without environment overrides.',
      })
    )
  );
  render(<NetBirdWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  expect(await screen.findByRole('button', { name: 'Review disconnect' })).toBeDisabled();
  expect(screen.getByText('Restart without environment overrides.')).toBeInTheDocument();
  expect(screen.getByText(/NB_DAEMON_ADDR/)).toBeInTheDocument();
});

it('shows a real missing-client state without exposing connection controls', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...snapshot, available: false }))
  );
  render(<NetBirdWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect NetBird' }));
  expect(
    await screen.findByRole('link', { name: 'Install the official NetBird client' })
  ).toHaveAttribute('href', 'https://docs.netbird.io/get-started/install');
  expect(screen.queryByRole('button', { name: 'Review reconnect' })).not.toBeInTheDocument();
  expect(screen.getByText('NetBird client unavailable. No background refresh.')).toBeVisible();
  expect(screen.queryByText(/daemon observed/)).not.toBeInTheDocument();
});
