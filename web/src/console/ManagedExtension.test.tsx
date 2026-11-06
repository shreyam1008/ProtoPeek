import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedExtension } from './ManagedExtension';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const available = {
  id: 'cloudflared',
  status: 'available',
  version: '2026.10.7',
  installBytes: 55390512,
  canInstall: true,
  canRemove: false,
  message: 'Available on this host.',
  sourceUrl:
    'https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-amd64',
};

describe('managed companion', () => {
  it('requires an explicit confirmation and sends only the allowlisted id', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('_protopeek_csrf_token=test-token');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(
        Response.json({
          ...available,
          status: 'installed',
          canInstall: false,
          canRemove: true,
          installBytes: 0,
        })
      );
    vi.stubGlobal('fetch', fetch);
    render(<ManagedExtension id="cloudflared" />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install companion' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/52.8 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/github.com\/cloudflare\/cloudflared/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm install' }));
    await screen.findByRole('button', { name: 'Remove companion' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: '{"id":"cloudflared"}',
      headers: { 'Content-Type': 'application/json', 'x-protopeek-csrf-token': 'test-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed status and never offers to remove an external tool', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...available, status: 'external', canRemove: true }))
      .mockResolvedValueOnce(Response.json({ ...available, status: 'external', canRemove: false }));
    vi.stubGlobal('fetch', fetch);
    render(<ManagedExtension id="cloudflared" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    await screen.findByText('Invalid companion status.');
    expect(screen.queryByRole('button', { name: 'Remove companion' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    await screen.findByText('External tool found');
    expect(screen.queryByRole('button', { name: 'Remove companion' })).not.toBeInTheDocument();
  });
  it('distinguishes a lightweight aria2 download from preparing a local companion', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...available,
          id: 'aria2',
          version: '1.37.0',
          installBytes: 2480000,
          sourceUrl: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2.zip',
        })
      )
      .mockResolvedValueOnce(
        Response.json({ ...available, id: 'aria2', installBytes: 0, sourceUrl: undefined })
      );
    vi.stubGlobal('fetch', fetch);
    render(<ManagedExtension id="aria2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install companion' }));
    expect(screen.getByText(/Download 2.4 MiB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Install companion' }));
    expect(screen.getByText(/no download is needed/)).toBeInTheDocument();
  });
  it('ignores a result arriving after cancellation', async () => {
    let resolve: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
    );
    render(<ManagedExtension id="cloudflared" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    resolve(Response.json(available));
    await waitFor(() => expect(screen.getByText(/Stopped waiting/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Install companion' })).not.toBeInTheDocument();
  });
});
