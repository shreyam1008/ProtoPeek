import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storePendingHandoff } from './app/handoff-store';
import { Dashboard } from './Dashboard';

const state = vi.hoisted(() => ({
  openScan: vi.fn(),
  claimInitialScan: (_target: unknown): boolean => false,
  openGRPCDiscovery: vi.fn(),
  openHTTPDiscovery: vi.fn(),
  discoveries: [] as Array<{ address: string; discoveredAt: string; grpc: boolean; http: boolean }>,
  bootstrap: { version: 'test', initialScanTarget: '' },
}));
vi.mock('./ProtocolShellContext', () => ({ useProtocolShell: () => state }));
vi.mock('./api', () => ({ fetchBootstrap: async () => state.bootstrap }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  const claimed = new Set<unknown>();
  state.claimInitialScan = (target) => {
    if (!target || claimed.has(target)) return false;
    claimed.add(target);
    return true;
  };
  state.openScan = vi.fn();
  state.openGRPCDiscovery = vi.fn();
  state.openHTTPDiscovery = vi.fn();
  state.discoveries = [];
  state.bootstrap = { version: 'test', initialScanTarget: '' };
});

describe('Home starts useful work explicitly', () => {
  it('offers an explicit scan recovery when the real broker rejects an old recent service', () => {
    const observedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    state.discoveries = [
      { address: 'localhost:50051', discoveredAt: observedAt, grpc: true, http: false },
    ];
    state.openGRPCDiscovery.mockImplementation(() =>
      storePendingHandoff({
        provenance: { source: 'bounded-discovery', quality: 'observed', observedAt },
        draft: {
          kind: 'grpc-target-draft',
          target: { kind: 'grpc-target', address: 'localhost:50051', plaintext: true },
        },
      })
    );
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Open localhost:50051 in gRPC' }));
    expect(screen.getByRole('alert')).toHaveTextContent('evidence is stale');
    expect(state.openScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(state.openScan).toHaveBeenCalledExactlyOnceWith({
      initialTarget: 'localhost:50051',
      autoStart: false,
    });
  });
  it('leaves traffic quiet while typing, then submits only the pasted URL authority', async () => {
    render(<Dashboard />);
    await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: 'Service address' }), {
      target: { value: 'https://api.example.com:8443/users?token=private' },
    });
    expect(state.openScan).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('form', { name: 'Find a service' }));
    expect(state.openScan).toHaveBeenCalledExactlyOnceWith({
      initialTarget: 'https://api.example.com:8443',
      autoStart: true,
    });
  });

  it('opens discovery setup for an empty submission without starting a probe', () => {
    render(<Dashboard />);
    fireEvent.submit(screen.getByRole('form', { name: 'Find a service' }));
    expect(state.openScan).toHaveBeenCalledExactlyOnceWith();
  });

  it('rejects credentials with a useful error and retains focus for correction', () => {
    render(<Dashboard />);
    const input = screen.getByRole('textbox', { name: 'Service address' });
    fireEvent.change(input, { target: { value: 'https://user:private@example.com/' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Find a service' }));
    expect(state.openScan).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Remove credentials');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('opens protocol workbenches directly and can focus the starting address from the empty state', () => {
    render(<Dashboard />);
    expect(screen.getByRole('link', { name: /HTTP request/ })).toHaveAttribute(
      'href',
      '/protocols/http'
    );
    expect(screen.getByRole('link', { name: /gRPC call/ })).toHaveAttribute(
      'href',
      '/protocols/grpc'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check an address' }));
    expect(screen.getByRole('textbox', { name: 'Service address' })).toHaveFocus();
  });

  it('honors an explicit CLI target once across Home remounts within the same shell', async () => {
    state.bootstrap.initialScanTarget = 'localhost:50051';
    const view = render(<Dashboard />);
    await waitFor(() =>
      expect(state.openScan).toHaveBeenCalledExactlyOnceWith({
        initialTarget: 'localhost:50051',
        autoStart: true,
      })
    );
    view.unmount();
    await act(async () => {
      render(<Dashboard />);
    });
    expect(state.openScan).toHaveBeenCalledTimes(1);
  });

  it('clears a failed recent handoff after the next successful choice', () => {
    state.discoveries = [
      { address: 'localhost:8080', discoveredAt: '2026-10-18T11:00:00Z', grpc: true, http: true },
    ];
    state.openGRPCDiscovery.mockReturnValue({ ok: false, error: 'Could not prepare gRPC.' });
    state.openHTTPDiscovery.mockReturnValue({ ok: true });
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Open localhost:8080 in gRPC' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not prepare gRPC.');
    fireEvent.click(screen.getByRole('button', { name: 'Open localhost:8080 in HTTP' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
