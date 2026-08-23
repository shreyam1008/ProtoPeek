import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addTransfer,
  fetchTransferSnapshot,
  mutateTransferJob,
  normalizeTransferSnapshot,
} from './transfer-api';

afterEach(() => {
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
  document.cookie = '_protopeek_csrf_token=; Max-Age=0; path=/';
});

describe('transfer API', () => {
  it('bounds and normalizes an untrusted snapshot', () => {
    const snapshot = normalizeTransferSnapshot({
      observedAt: '2026-08-23T00:00:00Z',
      health: { ready: true, status: 'invented', message: 'x'.repeat(3_000) },
      config: { version: 1, maxActiveJobs: 99, maxTrackedJobs: 99_999 },
      metrics: { totalCount: -1, bytesPerSecond: Number.POSITIVE_INFINITY },
      jobs: [
        {
          id: 'job-1',
          name: 'archive.tar.gz',
          status: 'downloading',
          progressPercent: 250,
          totalBytes: 10,
          completedBytes: 20,
        },
        { status: 'completed' },
      ],
    });

    expect(snapshot.health.status).toBe('unavailable');
    expect(snapshot.health.message).toHaveLength(2_048);
    expect(snapshot.config.maxActiveJobs).toBe(16);
    expect(snapshot.config.maxTrackedJobs).toBe(4_096);
    expect(snapshot.metrics.totalCount).toBe(0);
    expect(snapshot.metrics.bytesPerSecond).toBe(0);
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]?.progressPercent).toBe(100);
  });

  it('uses same-origin credentials for a read-only snapshot without a CSRF mutation header', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ health: {}, config: {}, metrics: {}, jobs: [] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchTransferSnapshot();

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).has('x-protopeek-csrf-token')).toBe(false);
  });

  it('sends optional output and checksum values only after an explicit add', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=transfer-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: 'abcdef1234' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await addTransfer('https://example.test/artifact', {
      outputName: 'artifact.bin',
      sha256: 'a'.repeat(64),
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      sources: ['https://example.test/artifact'],
      outputName: 'artifact.bin',
      sha256: 'a'.repeat(64),
    });
    expect(new Headers(init.headers).get('x-protopeek-csrf-token')).toBe('transfer-token');
    expect(result).toEqual({ id: 'abcdef1234', persistenceWarning: '' });
  });

  it.each([
    'pause',
    'resume',
    'cancel',
  ] as const)('preserves a partial-success warning returned by %s', async (action) => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=transfer-token; path=/';
    const fetchMock = vi.fn(async () =>
      Response.json({ persistenceWarning: 'Queue changed, but resumable state was not saved.' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(mutateTransferJob(action, 'abcdef1234')).resolves.toEqual({
      id: '',
      persistenceWarning: 'Queue changed, but resumable state was not saved.',
    });
  });

  it('bounds an oversized streamed error response', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('x'.repeat(16 * 1024), { status: 502 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTransferSnapshot()).rejects.toThrow(`${'x'.repeat(8 * 1024)}…`);
  });
});
