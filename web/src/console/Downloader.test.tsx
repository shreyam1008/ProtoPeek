import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Downloader, safeSourceLabel } from './Downloader';

const stoppedSnapshot = {
  observedAt: '2026-08-23T12:00:00Z',
  health: { ready: false, status: 'stopped', message: 'Downloader is stopped.' },
  config: {
    version: 1,
    downloadDirectory: '/home/shre/Downloads',
    maxActiveJobs: 4,
    maxQueuedJobs: 128,
    maxTrackedJobs: 512,
    maxConnectionsPerHost: 8,
    split: 8,
    minSplitSizeBytes: 1_048_576,
    maxDownloadBytesPerSecond: 0,
    minimumFreeDiskBytes: 536_870_912,
    continuePartialDownloads: true,
    autoRenameConflictingFiles: true,
    allowOverwriteExistingFiles: false,
    allowInsecureTls: false,
    userAgent: 'ProtoPeek',
  },
  metrics: {},
  jobs: [],
};

const runningSnapshot = {
  ...stoppedSnapshot,
  health: {
    ready: true,
    status: 'running',
    message: 'Downloader is ready.',
    engineVersion: '1.37.0',
  },
  metrics: { activeCount: 1, totalCount: 1, bytesPerSecond: 1_048_576 },
  jobs: [
    {
      id: 'abcdef1234',
      name: 'archive.tar.gz',
      status: 'downloading',
      source: 'https://example.test/archive.tar.gz?token=secret&part=1',
      outputPath: '/home/shre/Downloads/archive.tar.gz',
      totalBytes: 10_485_760,
      completedBytes: 5_242_880,
      progressPercent: 50,
      bytesPerSecond: 1_048_576,
      connections: 4,
      etaSeconds: 5,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('Downloader', () => {
  it('renders the truthful stopped state without starting the engine on load', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(stoppedSnapshot)
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<Downloader />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Downloader' })).toBeVisible();
    expect(screen.getByText('Downloader starts only when requested')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('uses one explicit submit to start the external engine, add the URL, and show real queue state', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=download-token; path=/';
    let snapshotReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/transfers/snapshot')) {
        snapshotReads += 1;
        return Response.json(snapshotReads === 1 ? stoppedSnapshot : runningSnapshot);
      }
      if (path.endsWith('/api/transfers/start')) return Response.json({});
      if (path.endsWith('/api/transfers/add')) return Response.json({ id: 'abcdef1234' });
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Downloader />);
    await screen.findByText('Downloader starts only when requested');
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.test/archive.tar.gz?token=secret&part=1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Downloader' }));

    expect(await screen.findAllByText('archive.tar.gz')).toHaveLength(2);
    expect(screen.getAllByText(/token=%5Bredacted%5D/).length).toBeGreaterThan(0);
    const mutationCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST'
    );
    expect(mutationCalls).toHaveLength(2);
    for (const call of mutationCalls) {
      expect(new Headers((call[1] as RequestInit).headers).get('x-protopeek-csrf-token')).toBe(
        'download-token'
      );
    }
    expect(JSON.parse(String((mutationCalls[1]?.[1] as RequestInit).body))).toEqual({
      sources: ['https://example.test/archive.tar.gz?token=secret&part=1'],
    });
    expect(within(screen.getByRole('complementary')).getByText('50%')).toBeVisible();
  });

  it('redacts credentials and credential-like query values before display', () => {
    expect(safeSourceLabel('https://user:pass@example.test/a?token=secret&part=1')).toBe(
      'https://example.test/a?token=%5Bredacted%5D&part=1'
    );
  });

  it('does not offer Resume for an ordinary queued job', async () => {
    const queuedSnapshot = {
      ...runningSnapshot,
      metrics: { activeCount: 0, queuedCount: 1, totalCount: 1, bytesPerSecond: 0 },
      jobs: [{ ...runningSnapshot.jobs[0], status: 'queued', bytesPerSecond: 0 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(queuedSnapshot))
    );

    render(<Downloader />);
    await screen.findAllByText('archive.tar.gz');

    expect(screen.queryByRole('button', { name: 'Resume archive.tar.gz' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel archive.tar.gz' })).toBeVisible();
  });

  it('surfaces a queued-but-not-durable warning without pretending the add failed', async () => {
    let snapshotReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/api/transfers/snapshot')) {
          snapshotReads += 1;
          return Response.json(snapshotReads === 1 ? stoppedSnapshot : runningSnapshot);
        }
        if (path.endsWith('/api/transfers/start')) return Response.json({});
        if (path.endsWith('/api/transfers/add')) {
          return Response.json({
            id: 'abcdef1234',
            persistenceWarning: 'Transfer queued, but resumable state was not saved.',
          });
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    render(<Downloader />);
    await screen.findByText('Downloader starts only when requested');
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.test/archive.tar.gz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Downloader' }));

    expect(
      await screen.findByText('Transfer queued, but resumable state was not saved.')
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a pause persistence warning after refreshing the real queue state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/api/transfers/snapshot')) return Response.json(runningSnapshot);
        if (path.endsWith('/api/transfers/pause') && init?.method === 'POST') {
          return Response.json({
            persistenceWarning: 'Queue changed, but resumable state was not saved.',
          });
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    render(<Downloader />);
    await screen.findAllByText('archive.tar.gz');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(
      await screen.findByText('Queue changed, but resumable state was not saved.')
    ).toBeVisible();
  });

  it('surfaces a bounded API failure instead of inventing queue data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response('transfer service unavailable', { status: 503 })
      )
    );

    render(<Downloader />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('transfer service unavailable')
    );
    expect(screen.getByText('Downloader starts only when requested')).toBeVisible();
  });
});
