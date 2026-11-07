import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityExtensionSetup } from './CommunityExtension';

const entry = {
  id: 'jq',
  name: 'jq',
  description: 'Inspect JSON.',
  group: 'Inspect traffic & services',
  source: 'https://github.com/jqlang/jq',
  license: 'MIT',
};
const available = {
  id: 'jq',
  status: 'available',
  version: '1.8.1',
  installBytes: 1024,
  canInstall: true,
  canRemove: false,
  message: 'Available for this host.',
  sourceUrl: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq.exe',
};
const installed = {
  ...available,
  status: 'installed',
  canInstall: false,
  canRemove: true,
  path: 'C:/isolated/protopeek/jq.exe',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('managed community companion', () => {
  it('checks only local status, installs on request and confirms removal', async () => {
    const fetch = vi
      .fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json(available)))
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(Response.json(installed))
      .mockResolvedValueOnce(Response.json(available));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityExtensionSetup entry={entry} />);

    const install = await screen.findByRole('button', { name: 'Install jq' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/api/extensions/managed?id=jq');
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    fireEvent.click(install);
    expect(await screen.findByText('C:/isolated/protopeek/jq.exe')).toBeInTheDocument();
    expect(screen.getByText('pp extensions run jq --help')).toBeInTheDocument();
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ id: 'jq' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove jq' }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Confirm remove' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Remove jq' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove jq' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: 'Install jq' })).toBeInTheDocument();
  });

  it('rejects malformed status and lets the user retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...available, sourceUrl: 'javascript:alert(1)' }))
      .mockResolvedValueOnce(Response.json(available));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityExtensionSetup entry={entry} />);
    expect(await screen.findByText('Could not read companion status.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install jq' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    expect(await screen.findByRole('button', { name: 'Install jq' })).toBeInTheDocument();
  });

  it('ignores a cancelled status response and allows a fresh check', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
      .mockResolvedValueOnce(Response.json(available));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityExtensionSetup entry={entry} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting' }));
    resolve(Response.json(available));
    expect(await screen.findByText(/Stopped waiting/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install jq' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    expect(await screen.findByRole('button', { name: 'Install jq' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('requires a status refresh after an install fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(new Response('Network unavailable', { status: 502 }))
      .mockResolvedValueOnce(Response.json(available));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityExtensionSetup entry={entry} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install jq' }));
    expect(await screen.findByText(/Check status before trying again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install jq' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check companion status' }));
    expect(await screen.findByRole('button', { name: 'Install jq' })).toBeEnabled();
  });

  it('shows a safe recovery path for a changed file without allowing actions', async () => {
    const recoveryPath = 'C:/isolated/protopeek/jq.exe';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...available,
          status: 'invalid',
          canInstall: false,
          message: 'Preserve the file before installing again.',
          recoveryPath,
        })
      )
    );
    render(<CommunityExtensionSetup entry={entry} />);
    expect(
      await screen.findByText('Preserve the file before installing again.')
    ).toBeInTheDocument();
    expect(screen.getByText('Expected path on the ProtoPeek host')).toBeInTheDocument();
    expect(screen.getByText(recoveryPath)).toBeInTheDocument();
    expect(screen.queryByText('pp extensions run jq --help')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install jq' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove jq' })).not.toBeInTheDocument();
  });

  it('rejects an unsafe recovery path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...available,
          status: 'invalid',
          canInstall: false,
          recoveryPath: 'bad\npath',
        })
      )
    );
    render(<CommunityExtensionSetup entry={entry} />);
    expect(await screen.findByText('Could not read companion status.')).toBeInTheDocument();
  });
});
