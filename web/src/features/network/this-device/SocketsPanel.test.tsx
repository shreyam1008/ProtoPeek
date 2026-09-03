import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { ThisPCActivity, ThisPCCapabilities, ThisPCSocket } from '@/console/this-pc-api';

import { SocketsPanel } from './SocketsPanel';

const tcp: ThisPCSocket = {
  protocol: 'tcp4',
  state: 'LISTEN',
  local: { address: '0.0.0.0', port: 8080, wildcard: true },
  remote: { address: '0.0.0.0', port: 0, wildcard: true },
  exposure: 'all-interfaces',
  ownerStatus: 'observed',
  processes: [{ pid: 7, comm: 'demo' }],
  ownersTruncated: false,
};

const udp: ThisPCSocket = {
  ...tcp,
  protocol: 'udp4',
  state: 'UNCONNECTED',
  local: { address: '127.0.0.1', port: 5353, wildcard: false },
  exposure: 'loopback-only',
};

const capabilities = {
  status: 'ready' as const,
  value: {
    schemaVersion: 1,
    scope: 'process-network-namespace',
    scopeNotice: 'Local process/network namespace.',
    snapshot: { supported: true, reason: '' },
    activity: { supported: true, reason: '', requiresAcknowledgement: true },
    trafficSample: { supported: true, reason: '', durationsMs: [500, 1000, 2000] },
    publicIdentity: {
      supported: true,
      reason: '',
      requiresAcknowledgement: true,
      provider: 'ipify',
      bgpOriginProvider: 'Team Cymru',
      dnsResolverDisclosure: 'A DNS lookup may occur.',
    },
  } satisfies ThisPCCapabilities,
};

const activity = {
  status: 'ready' as const,
  value: {
    schemaVersion: 1,
    status: 'ok',
    scope: 'process-network-namespace',
    scopeNotice: 'Local process/network namespace.',
    observedAt: '2026-09-03T12:00:00Z',
    listeners: [tcp, udp],
    connections: [],
    truncated: false,
    limits: { maxSockets: 4096, maxProcesses: 512, maxFileDescriptors: 16384, wallTimeMs: 2000 },
    notes: [],
  } satisfies ThisPCActivity,
};

it('offers draft-only destinations for TCP listeners and leaves UDP as evidence', () => {
  const onHandoff = vi.fn();
  render(
    <SocketsPanel
      kind="listeners"
      capabilities={capabilities}
      activity={activity}
      consentOpen={false}
      acknowledged={false}
      onOpen={vi.fn()}
      onAcknowledged={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onHandoff={onHandoff}
    />
  );

  expect(screen.getByText(/TCP binds can prefill drafts/i)).toBeVisible();
  expect(screen.getByText('UDP evidence only')).toBeVisible();
  const menu = screen.getByText('Open draft').closest('details');
  expect(menu).not.toBeNull();
  if (!menu) return;
  fireEvent.click(within(menu).getByText('Open draft'));

  for (const [label, kind] of [
    ['HTTP', 'http-url-draft'],
    ['gRPC', 'grpc-target-draft'],
    ['Route', 'next-hop-target-draft'],
    ['Publish', 'publish-origin-draft'],
  ] as const) {
    fireEvent.click(within(menu).getByRole('button', { name: label }));
    expect(onHandoff).toHaveBeenLastCalledWith(tcp, kind);
  }
  expect(onHandoff).toHaveBeenCalledTimes(4);
});

it('does not offer URL-shaped drafts for a scoped IPv6 listener', () => {
  const scoped = {
    ...tcp,
    protocol: 'tcp6' as const,
    local: { address: 'fe80::1234%12', port: 8080, wildcard: false },
    remote: { address: '::', port: 0, wildcard: true },
    exposure: 'interface-bound' as const,
  };
  render(
    <SocketsPanel
      kind="listeners"
      capabilities={capabilities}
      activity={{ ...activity, value: { ...activity.value, listeners: [scoped] } }}
      consentOpen={false}
      acknowledged={false}
      onOpen={vi.fn()}
      onAcknowledged={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onHandoff={vi.fn()}
    />
  );

  const menu = screen.getByText('Open gRPC / Route draft').closest('details');
  expect(menu).not.toBeNull();
  if (!menu) return;
  expect(within(menu).queryByRole('button', { name: 'HTTP' })).not.toBeInTheDocument();
  expect(within(menu).queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  expect(within(menu).getByRole('button', { name: 'gRPC' })).toBeInTheDocument();
  expect(within(menu).getByRole('button', { name: 'Route' })).toBeInTheDocument();
});

it('does not offer drafts when link-local IPv6 evidence lacks an interface scope', () => {
  const missingScope = {
    ...tcp,
    protocol: 'tcp6' as const,
    local: { address: 'fe80::1234', port: 8080, wildcard: false },
    remote: { address: '::', port: 0, wildcard: true },
    exposure: 'interface-bound' as const,
  };
  render(
    <SocketsPanel
      kind="listeners"
      capabilities={capabilities}
      activity={{ ...activity, value: { ...activity.value, listeners: [missingScope] } }}
      consentOpen={false}
      acknowledged={false}
      onOpen={vi.fn()}
      onAcknowledged={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onHandoff={vi.fn()}
    />
  );

  expect(screen.getByText('IPv6 scope missing')).toBeVisible();
  expect(screen.queryByText('Open draft')).not.toBeInTheDocument();
  expect(screen.queryByText('Open gRPC / Route draft')).not.toBeInTheDocument();
});
