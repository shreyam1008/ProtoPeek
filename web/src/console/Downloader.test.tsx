import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { batchResultMessage, Downloader, parseBatchSources, safeSourceLabel } from './Downloader';

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
    expect(await screen.findByText('Downloader starts only when requested')).toBeVisible();
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
      if (path.endsWith('/api/transfers/batch')) {
        return Response.json({
          requestedCount: 1,
          queuedCount: 1,
          failedCount: 0,
          results: [{ index: 0, queued: true, id: 'abcdef1234' }],
        });
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Downloader />);
    await screen.findByText('Downloader starts only when requested');
    fireEvent.change(screen.getByLabelText(/URLs/), {
      target: { value: 'https://example.test/archive.tar.gz?token=secret&part=1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Downloader' }));

    expect(await screen.findAllByText('archive.tar.gz')).toHaveLength(2);
    expect(screen.getAllByText('https://example.test/archive.tar.gz').length).toBeGreaterThan(0);
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
      jobs: [{ sources: ['https://example.test/archive.tar.gz?token=secret&part=1'] }],
    });
    expect(within(screen.getByRole('complementary')).getByText('50%')).toBeVisible();
  });

  it('withholds credentials, every query value, fragments, and malformed sources before display', () => {
    expect(safeSourceLabel('https://user:pass@example.test/a?token=secret&part=1')).toBe(
      'https://example.test/a'
    );
    expect(safeSourceLabel('not-a-url private-secret')).toBe(
      'Source hidden because the engine returned an invalid URL.'
    );
  });

  it('disables retry when exact private options are unavailable and explains the safe next step', async () => {
    const failedSnapshot = {
      ...runningSnapshot,
      metrics: { failedCount: 1, totalCount: 1 },
      jobs: [
        {
          ...runningSnapshot.jobs[0],
          status: 'failed',
          retryAvailable: false,
          retryUnavailableReason:
            'Exact retry options are unavailable. Queue a new job and re-enter any required headers.',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(failedSnapshot))
    );

    render(<Downloader />);
    await screen.findAllByText('archive.tar.gz');

    expect(screen.getByRole('button', { name: 'Retry archive.tar.gz' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(
      screen.getByText(
        'Exact retry options are unavailable. Queue a new job and re-enter any required headers.'
      )
    ).toBeVisible();
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
        if (path.endsWith('/api/transfers/batch')) {
          return Response.json({
            requestedCount: 1,
            queuedCount: 1,
            failedCount: 0,
            results: [{ index: 0, queued: true, id: 'abcdef1234' }],
            persistenceWarning: 'Transfer queued, but resumable state was not saved.',
          });
        }
        return new Response('unexpected request', { status: 500 });
      })
    );

    render(<Downloader />);
    await screen.findByText('Downloader starts only when requested');
    fireEvent.change(screen.getByLabelText(/URLs/), {
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

  it('lazily reveals advanced batch options, masks headers, and reports partial success safely', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=batch-token; path=/';
    let snapshotReads = 0;
    const secret = 'Bearer private-credential';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/transfers/snapshot')) {
        snapshotReads += 1;
        return Response.json(snapshotReads === 1 ? stoppedSnapshot : runningSnapshot);
      }
      if (path.endsWith('/api/transfers/start')) return Response.json({});
      if (path.endsWith('/api/transfers/batch')) {
        return Response.json(
          {
            requestedCount: 2,
            queuedCount: 1,
            failedCount: 1,
            results: [
              { index: 0, queued: true, id: 'abcdef1234' },
              { index: 1, queued: false, failureCode: 'queue_full' },
            ],
          },
          { status: 207 }
        );
      }
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Downloader />);
    await screen.findByText('Downloader starts only when requested');
    expect(screen.queryByLabelText('Absolute destination directory')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced per-job options'));
    expect(await screen.findByLabelText('Absolute destination directory')).toBeVisible();
    expect(
      screen.getByText(
        /Exact retry and resume state stays only in private local transfer storage and is never returned by queue or API results\./
      )
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/URLs/), {
      target: { value: 'https://example.test/one\nhttps://example.test/two' },
    });
    fireEvent.change(screen.getByLabelText('Absolute destination directory'), {
      target: { value: '/tmp/downloads' },
    });
    fireEvent.change(screen.getByLabelText('User-Agent override'), {
      target: { value: 'ProtoPeek batch/1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.change(screen.getByLabelText('Header 1 name'), {
      target: { value: 'Authorization' },
    });
    const valueInput = screen.getByLabelText('Header 1 value');
    expect(valueInput).toHaveAttribute('type', 'password');
    fireEvent.change(valueInput, { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Downloader + 2 jobs' }));

    expect(
      await screen.findByText(
        'Queued 1 of 2 independent downloads. 1 not queued: queue capacity reached (1).'
      )
    ).toBeVisible();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Header 1 value')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/URLs/)).toHaveValue('https://example.test/two');
    const batchCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/api/transfers/batch')
    );
    const body = JSON.parse(String(batchCall?.[1]?.body));
    expect(body.jobs).toEqual([
      {
        sources: ['https://example.test/one'],
        destinationDirectory: '/tmp/downloads',
        headers: [{ name: 'Authorization', value: secret }],
        userAgent: 'ProtoPeek batch/1',
      },
      {
        sources: ['https://example.test/two'],
        destinationDirectory: '/tmp/downloads',
        headers: [{ name: 'Authorization', value: secret }],
        userAgent: 'ProtoPeek batch/1',
      },
    ]);
  });

  it('backs Pause all with the explicit global queue endpoint', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=queue-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/transfers/snapshot')) return Response.json(runningSnapshot);
      if (path.endsWith('/api/transfers/pause-all')) return new Response(null, { status: 204 });
      return new Response('unexpected request', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Downloader />);
    await screen.findAllByText('archive.tar.gz');
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          new URL(String(input)).pathname.endsWith('/api/transfers/pause-all')
        )
      ).toBe(true)
    );
    const pauseCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/api/transfers/pause-all')
    );
    expect(pauseCall?.[1]?.body).toBeUndefined();
    expect(new Headers(pauseCall?.[1]?.headers).get('x-protopeek-csrf-token')).toBe('queue-token');
  });
});

describe('Downloader batch helpers', () => {
  it('keeps each non-empty line independent and produces credential-free summaries', () => {
    expect(parseBatchSources(' https://example.test/one \n\nhttps://example.test/two ')).toEqual([
      'https://example.test/one',
      'https://example.test/two',
    ]);
    const message = batchResultMessage({
      requestedCount: 2,
      queuedCount: 1,
      failedCount: 1,
      persistenceWarning: '',
      results: [
        { index: 0, queued: true, id: 'aabbccdd', failureCode: '', persistenceWarning: '' },
        { index: 1, queued: false, id: '', failureCode: 'engine_rejected', persistenceWarning: '' },
      ],
    });
    expect(message).toBe(
      'Queued 1 of 2 independent downloads. 1 not queued: aria2c rejected the job (1).'
    );
    expect(message).not.toContain('example.test');
  });
});
