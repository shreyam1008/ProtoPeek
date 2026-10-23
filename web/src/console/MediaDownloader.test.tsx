import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Media downloader', () => {
  it('redacts URLs echoed by failed snapshot reads, vendor messages and action or inspection errors', async () => {
    let snapshots = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/inspect')) {
          return new Response(
            'Get "https://example.org/page?token=inspect-secret": connection refused',
            { status: 400 }
          );
        }
        if (url.endsWith('/action')) {
          expect(JSON.parse(String(init?.body))).toEqual({ id: 'failed', action: 'retry' });
          return new Response(
            'Get "https://example.org/retry?token=action-secret": connection refused',
            { status: 409 }
          );
        }
        snapshots++;
        if (snapshots === 1)
          return new Response(
            'Get "https://user:fetch-password@example.org/snapshot?token=fetch-secret": unavailable',
            { status: 503 }
          );
        return Response.json({
          ...snapshot,
          jobs: [
            {
              id: 'failed',
              request: {
                url: 'https://example.org/movie?token=source-secret',
                engine: 'native-go',
              },
              message:
                'ERROR: unable to download https://cdn.example.org/movie?Signature=vendor-secret (HTTP 403)',
              status: 'failed',
              bytes: 0,
              total: 0,
              files: 0,
              directory: '/tmp/output',
            },
          ],
        });
      })
    );
    const { container } = render(<MediaDownloader />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Get "https://example.org/snapshot": unavailable'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh media queue' }));
    await screen.findByText('ERROR: unable to download https://cdn.example.org/movie (HTTP 403)');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Get "https://example.org/retry": connection refused'
    );
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find media on this page' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Get "https://example.org/page": connection refused'
      )
    );
    expect(container.textContent).not.toMatch(
      /fetch-password|fetch-secret|vendor-secret|action-secret|inspect-secret|source-secret/
    );
  });

  it('redacts queue and preview source credentials, queries and fragments from display and accessible names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/inspect')) {
          return Response.json({
            title: 'Inspected page',
            truncated: false,
            items: [
              {
                kind: 'image',
                url: 'https://user:password@cdn.example.org/image.png?token=preview-secret#private',
              },
            ],
          });
        }
        return Response.json({
          ...snapshot,
          jobs: [
            {
              id: 'active',
              request: {
                url: 'https://example.org/movie.mp4?token=queue-secret#private',
                engine: 'native-go',
              },
              status: 'downloading',
              bytes: 1,
              total: 100,
              files: 0,
              directory: '/tmp/output',
            },
          ],
        });
      })
    );
    const { container } = render(<MediaDownloader />);
    await screen.findByRole('progressbar', {
      name: 'Download progress for https://example.org/movie.mp4',
    });
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find media on this page' }));
    await screen.findByText('image · https://cdn.example.org/image.png');
    expect(container.textContent).not.toMatch(/queue-secret|preview-secret|password|#private/);
    expect(screen.getByText('https://example.org/movie.mp4')).toBeVisible();
  });

  it('clears recovered snapshot errors while retaining a failed action through successful polls', async () => {
    vi.useFakeTimers();
    let snapshots = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/action')) return new Response('Cancel was rejected.', { status: 409 });
        snapshots++;
        if (snapshots === 2) return new Response('Queue temporarily unavailable.', { status: 503 });
        return Response.json({
          ...snapshot,
          jobs: [
            {
              id: 'active',
              request: { url: 'https://example.org/movie', engine: 'native-go' },
              status: 'downloading',
              bytes: 1,
              total: 100,
              files: 0,
              directory: '/tmp/output',
            },
          ],
        });
      })
    );
    render(<MediaDownloader />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Queue temporarily unavailable.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Cancel was rejected.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(snapshots).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('alert')).toHaveTextContent('Cancel was rejected.');
  });

  it('only reads local metadata on mount and recovers an unavailable queue through Refresh', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('Media downloads are unavailable.', { status: 503 }))
      .mockResolvedValueOnce(Response.json(snapshot));
    vi.stubGlobal('fetch', fetcher);
    render(<MediaDownloader />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Media downloads are unavailable.');
    expect(screen.getByRole('button', { name: 'Queue download' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh media queue' }));
    await screen.findByDisplayValue('/tmp/downloads');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url.endsWith('/snapshot'))).toBe(true);
  });

  it('aborts an inspected URL when edited and ignores its late preview', async () => {
    let resolveInspection: (response: Response) => void = () => {};
    let inspectionSignal: AbortSignal | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveInspection = resolve;
    });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/inspect')) {
        inspectionSignal = init?.signal ?? undefined;
        expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://example.org/first' });
        return pending;
      }
      return Response.json(snapshot);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<MediaDownloader />);
    await screen.findByDisplayValue('/tmp/downloads');
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/first' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find media on this page' }));
    await waitFor(() => expect(inspectionSignal).toBeDefined());
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/second' },
    });
    expect(inspectionSignal?.aborted).toBe(true);
    await act(async () => {
      resolveInspection(Response.json({ title: 'First page', items: [], truncated: false }));
      await pending;
    });
    expect(screen.queryByText(/First page/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Link to save')).toHaveValue('https://example.org/second');
    expect(screen.getByRole('button', { name: 'Queue download' })).toBeEnabled();
  });

  it('aborts inspection on engine selection and suppresses its late failure', async () => {
    let rejectInspection: (error: Error) => void = () => {};
    let inspectionSignal: AbortSignal | undefined;
    const pending = new Promise<Response>((_resolve, reject) => {
      rejectInspection = reject;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/inspect')) {
          inspectionSignal = init?.signal ?? undefined;
          return pending;
        }
        return Response.json(snapshot);
      })
    );
    render(<MediaDownloader />);
    await screen.findByDisplayValue('/tmp/downloads');
    fireEvent.change(screen.getByLabelText('Link to save'), {
      target: { value: 'https://example.org/page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find media on this page' }));
    await waitFor(() => expect(inspectionSignal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Video & audio/ }));
    expect(inspectionSignal?.aborted).toBe(true);
    await act(async () => {
      rejectInspection(new Error('Old page failed'));
      await pending.catch(() => {});
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Install yt-dlp/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel operation' })).not.toBeInTheDocument();
  });

  it('requires the missing engine before Retry and preserves a rejected retry error', async () => {
    let enginePresent = false;
    const job = {
      id: 'job',
      request: { url: 'https://example.org/movie', engine: 'yt-dlp' },
      status: 'failed',
      bytes: 0,
      total: 0,
      files: 0,
      directory: '/tmp/output',
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/action')) {
        expect(JSON.parse(String(init?.body))).toEqual({ id: 'job', action: 'retry' });
        return new Response('Wait for the previous process to stop.', { status: 409 });
      }
      return Response.json({
        ...snapshot,
        jobs: [job],
        tools: snapshot.tools.map((tool) =>
          tool.name === 'yt-dlp' && enginePresent ? { ...tool, path: '/tools/yt-dlp' } : tool
        ),
      });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<MediaDownloader />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByText('Install yt-dlp before retrying this download.')).toBeVisible();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/action'))).toBe(false);
    enginePresent = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh media queue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wait for the previous process to stop.'
    );
    expect(screen.queryByText(/Queued\. Downloads continue/)).not.toBeInTheDocument();
  });

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
