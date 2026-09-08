import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type UpdateState, Updates } from './Updates';

const initial: UpdateState = {
  installation: {
    version: 'v0.6.1',
    revision: 'a'.repeat(40),
    channel: 'stable',
    os: 'windows',
    arch: 'amd64',
    executable: 'C:/Programs/ProtoPeek/protopeek.exe',
    manager: 'direct',
    canUpdate: true,
    reason: '',
    commands: [],
  },
  plan: null,
  phase: 'idle',
  error: '',
  restartRequired: false,
  notice: '',
};
const checked: UpdateState = {
  ...initial,
  phase: 'checked',
  plan: {
    id: 'reviewed-release',
    version: 'v0.7.0',
    revision: '',
    channel: 'stable',
    url: 'https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.7.0',
    available: true,
    checkedAt: '2026-09-08T00:00:00Z',
    archive: 'release.zip',
    size: 30 * 1048576,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('Updates', () => {
  it('requires an explicit check and confirmation before installing; explains server restart', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        calls.push({ url: path, body: init?.body ? JSON.parse(String(init.body)) : null });
        return Response.json(
          path.endsWith('/check')
            ? checked
            : path.endsWith('/apply')
              ? { ...checked, phase: 'installed', restartRequired: true }
              : initial
        );
      })
    );
    render(<Updates />);
    await screen.findByText('ProtoPeek v0.6.1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/state');
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('Update available: v0.7.0');
    const install = screen.getByRole('button', { name: 'Install update' });
    expect(install).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(install).toBeEnabled();
    fireEvent.click(install);
    await screen.findByText('Update installed · restart required');
    expect(screen.getByText(/Reloading this browser tab alone/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/apply'))?.body).toEqual({
      id: 'reviewed-release',
      confirm: true,
    });
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
  });
  it('invalidates a preview when the channel changes and warns about edge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(String(url).endsWith('/state') ? initial : checked)
      )
    );
    render(<Updates />);
    await screen.findByText('ProtoPeek v0.6.1');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('Update available: v0.7.0');
    fireEvent.change(screen.getByLabelText('Release channel'), { target: { value: 'edge' } });
    expect(screen.getByText(/Edge is a rolling prerelease/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
    expect(screen.getByText('pp update --channel edge')).toBeInTheDocument();
  });
  it('shows package-manager instructions without offering direct replacement', async () => {
    const managed = {
      ...checked,
      installation: {
        ...initial.installation,
        manager: 'Scoop',
        canUpdate: false,
        reason: 'Managed by Scoop.',
        commands: ['scoop update protopeek'],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(managed))
    );
    render(<Updates />);
    await screen.findByText('scoop update protopeek');
    expect(screen.getByText('Managed by Scoop.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
  });
  it('cancels the request and recovers the server state', async () => {
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).endsWith('/check')) return Response.json(initial);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        });
      })
    );
    render(<Updates />);
    await screen.findByText('ProtoPeek v0.6.1');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled()
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Update check cancelled');
  });
  it('keeps a failed download retryable and does not claim success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/apply')
          ? new Response('Checksum verification failed', { status: 409 })
          : Response.json(checked)
      )
    );
    render(<Updates />);
    await screen.findByText('Update available: v0.7.0');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));
    await screen.findByText('Checksum verification failed');
    expect(screen.queryByText('Update installed · restart required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install update' })).toBeDisabled();
  });
});
