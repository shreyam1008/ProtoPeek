import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaDownloader from './MediaDownloader';

const snapshot = {
  tools: [
    {
      name: 'native-go',
      path: 'Built in',
      help: 'Native media',
      canInstall: false,
      installBytes: 0,
    },
    { name: 'yt-dlp', path: '', help: 'Video setup', canInstall: true, installBytes: 20 * 1048576 },
  ],
  directory: '/tmp/downloads',
  jobs: [],
};
afterEach(() => vi.unstubAllGlobals());

describe('Media downloader', () => {
  it('installs a site engine with one action and enables its queue', async () => {
    let installed = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/install')) {
        expect(JSON.parse(String(init?.body))).toEqual({ engine: 'yt-dlp' });
        installed = true;
      }
      return new Response(
        JSON.stringify({
          ...snapshot,
          tools: snapshot.tools.map((tool) =>
            tool.name === 'yt-dlp' && installed ? { ...tool, path: '/tools/yt-dlp' } : tool
          ),
        })
      );
    });
    vi.stubGlobal('fetch', fetcher);
    render(<MediaDownloader />);
    fireEvent.click(screen.getByRole('button', { name: /Video & audio/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install yt-dlp · 20.0 MiB' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Queue download' })).toBeEnabled()
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/install'))).toHaveLength(1);
  });

  it('queues the selected native range and destination', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetcher);
    render(<MediaDownloader />);
    await screen.findByDisplayValue('/tmp/downloads');
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/album' },
    });
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'images' } });
    fireEvent.change(screen.getByLabelText('Last item'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue download' }));
    await screen.findByText(/Queued. Downloads continue/);
    const call = (fetcher.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
      url.endsWith('/add')
    );
    expect(JSON.parse(String(call?.[1].body))).toEqual({
      url: 'https://example.org/album',
      engine: 'native-go',
      format: 'images',
      directory: '/tmp/downloads',
      start: 1,
      end: 10,
    });
  });

  it('does not show a completed percentage while media is processing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...snapshot,
              jobs: [
                {
                  id: 'job',
                  request: { url: 'https://example.org/movie', engine: 'yt-dlp' },
                  status: 'processing',
                  bytes: 100,
                  total: 100,
                  files: 0,
                  directory: '/tmp/output',
                },
              ],
            })
          )
      )
    );
    render(<MediaDownloader />);
    const progress = await screen.findByRole('progressbar');
    expect(progress).not.toHaveAttribute('value');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByText('Processing media…')).toBeInTheDocument();
  });
});
