import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addTransfer,
  addTransferBatch,
  fetchTransferSnapshot,
  importGoBarryState,
  mutateTransferJob,
  mutateTransferQueue,
  normalizeGoBarryMigrationPreview,
  normalizeTransferBatchResult,
  normalizeTransferSnapshot,
  previewGoBarryMigration,
  rollbackGoBarryState,
  saveTransferHostConfig,
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
          retryAvailable: true,
          retryUnavailableReason: 'x'.repeat(3_000),
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
    expect(snapshot.jobs[0]?.retryAvailable).toBe(true);
    expect(snapshot.jobs[0]?.retryUnavailableReason).toHaveLength(2_048);
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

  it('saves an allowlisted host patch with JSON, revision, and CSRF protection', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=host-token; path=/';
    const config = {
      version: 1,
      aria2Path: '/usr/bin/aria2c',
      downloadDirectory: '/downloads',
      maxActiveJobs: 4,
      maxQueuedJobs: 128,
      maxTrackedJobs: 512,
      maxConnectionsPerHost: 8,
      split: 8,
      minSplitSizeBytes: 1 << 20,
      maxDownloadBytesPerSecond: 0,
      minimumFreeDiskBytes: 512 << 20,
      continuePartialDownloads: true,
      alwaysResume: true,
      fileAllocation: 'prealloc',
      autoRenameConflictingFiles: true,
      allowOverwriteExistingFiles: false,
      allowInsecureTls: false,
      userAgent: 'ProtoPeek',
    };
    const revision = 'a'.repeat(64);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ...config, configRevision: 'b'.repeat(64) })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      saveTransferHostConfig(revision, { maxActiveJobs: 6, maxDownloadBytesPerSecond: 123456 })
    ).resolves.toMatchObject({
      ...config,
      configRevision: 'b'.repeat(64),
      warning: '',
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(input)).pathname).toMatch(/\/api\/transfers\/config$/);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init?.headers).get('x-protopeek-csrf-token')).toBe('host-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedRevision: revision,
      maxActiveJobs: 6,
      maxDownloadBytesPerSecond: 123456,
    });
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

  it('sends independent batch jobs with write-only per-job options and preserves partial success', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=batch-token; path=/';
    const secret = 'Bearer private-credential';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          requestedCount: 2,
          queuedCount: 1,
          failedCount: 1,
          results: [
            { index: 0, queued: true, id: 'aabbccdd' },
            { index: 1, queued: false, failureCode: 'queue_full' },
          ],
        },
        { status: 207 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await addTransferBatch([
      {
        source: 'https://example.test/one',
        destinationDirectory: '/tmp/downloads',
        userAgent: 'One job/1',
        headers: [{ name: 'Authorization', value: secret }],
      },
      { source: 'https://example.test/two' },
    ]);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toMatch(
      /\/api\/transfers\/batch$/
    );
    expect(JSON.parse(String(init.body))).toEqual({
      jobs: [
        {
          sources: ['https://example.test/one'],
          destinationDirectory: '/tmp/downloads',
          headers: [{ name: 'Authorization', value: secret }],
          userAgent: 'One job/1',
        },
        { sources: ['https://example.test/two'] },
      ],
    });
    expect(new Headers(init.headers).get('x-protopeek-csrf-token')).toBe('batch-token');
    expect(result.queuedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.results[1]?.failureCode).toBe('queue_full');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('example.test');
  });

  it('derives bounded batch counts from safe item results', () => {
    const result = normalizeTransferBatchResult({
      requestedCount: 999,
      queuedCount: 999,
      results: [
        { index: 999, queued: true, id: 'aabbccdd' },
        { index: 1, queued: false, failureCode: 'invented', persistenceWarning: 'ignore' },
      ],
      persistenceWarning: 'x'.repeat(3_000),
    });
    expect(result.requestedCount).toBe(32);
    expect(result.queuedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.results[0]?.index).toBe(31);
    expect(result.results[1]?.failureCode).toBe('');
    expect(result.results[1]?.persistenceWarning).toBe('');
    expect(result.persistenceWarning).toHaveLength(2_048);
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

  it.each([
    'pause-all',
    'resume-all',
  ] as const)('uses an empty explicit mutation for %s', async (action) => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=transfer-token; path=/';
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(mutateTransferQueue(action)).resolves.toEqual({
      id: '',
      persistenceWarning: '',
    });
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(input)).pathname).toMatch(new RegExp(`/api/transfers/${action}$`));
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('x-protopeek-csrf-token')).toBe('transfer-token');
  });

  it('bounds an oversized streamed error response', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('x'.repeat(16 * 1024), { status: 502 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTransferSnapshot()).rejects.toThrow(`${'x'.repeat(8 * 1024)}…`);
  });

  it('bounds untrusted GoBarryGo preview records and sends an explicit empty preview', async () => {
    const normalized = normalizeGoBarryMigrationPreview({
      available: true,
      preferencesFound: true,
      sessionFound: true,
      sessionBytes: Number.MAX_SAFE_INTEGER,
      sessionEntries: 99_999,
      settingChanges: [
        { key: 'downloadDirectory', before: 'a'.repeat(5_000), after: '/tmp', note: 'safe' },
        { before: 'missing key' },
      ],
      warnings: Array.from({ length: 100 }, (_, index) => `warning-${index}`),
      lastReceiptId: 'r'.repeat(200),
      previewRevision: 'a'.repeat(64),
    });
    expect(normalized.sessionBytes).toBe(16 << 20);
    expect(normalized.sessionEntries).toBe(4096);
    expect(normalized.settingChanges).toHaveLength(1);
    expect(normalized.settingChanges[0]?.before).toHaveLength(4 * 1024);
    expect(normalized.warnings).toHaveLength(64);
    expect(normalized.lastReceiptId).toHaveLength(96);
    expect(normalized.previewRevision).toBe('a'.repeat(64));
    expect(() => normalizeGoBarryMigrationPreview({ available: true })).toThrow(
      /valid GoBarryGo migration preview revision/i
    );
    expect(() =>
      normalizeGoBarryMigrationPreview({ available: true, previewRevision: 'A'.repeat(64) })
    ).toThrow(/valid GoBarryGo migration preview revision/i);
    expect(() =>
      normalizeGoBarryMigrationPreview({
        available: true,
        previewRevision: `${'a'.repeat(64)}x`,
      })
    ).toThrow(/valid GoBarryGo migration preview revision/i);
    expect(() =>
      normalizeGoBarryMigrationPreview({ available: true, previewRevision: 'z'.repeat(64) })
    ).toThrow(/valid GoBarryGo migration preview revision/i);

    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ available: true, previewRevision: 'b'.repeat(64) })
    );
    vi.stubGlobal('fetch', fetchMock);
    await previewGoBarryMigration();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('x-protopeek-csrf-token')).toBe('migration-token');
  });

  it('uses explicit preservation acknowledgements for import and guarded rollback', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not expose Cookie Store.
    document.cookie = '_protopeek_csrf_token=migration-token; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ sourcePreserved: true })
    );
    vi.stubGlobal('fetch', fetchMock);

    await importGoBarryState({
      importPreferences: true,
      importSession: false,
      expectedRevision: 'a'.repeat(64),
    });
    await rollbackGoBarryState('20260823T120000.000000000Z-aabbccddeeff');

    const [importCall, rollbackCall] = fetchMock.mock.calls;
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      importPreferences: true,
      importSession: false,
      acknowledgeSourcePreserved: true,
      expectedRevision: 'a'.repeat(64),
    });
    expect(JSON.parse(String(rollbackCall?.[1]?.body))).toEqual({
      receiptId: '20260823T120000.000000000Z-aabbccddeeff',
      acknowledgeCurrentStateCheck: true,
    });
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get('x-protopeek-csrf-token')).toBe('migration-token');
    }
  });
});
