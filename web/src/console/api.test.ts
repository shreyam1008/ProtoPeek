import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserProtoFolderSelection } from '@/shared/proto-folder';
import type { WorkspaceTargetConfig } from '@/shared/types';

import {
  checkHealth,
  connectWorkspaceTarget,
  normalizeBootstrap,
  normalizeHTTPResponse,
  normalizeInvokeResponse,
  normalizeProtoCatalog,
  scanAddresses,
  sendHTTPRequest,
  watchHealth,
} from './api';

function workspaceTarget(overrides: Partial<WorkspaceTargetConfig> = {}): WorkspaceTargetConfig {
  return {
    address: 'localhost:50051',
    plaintext: true,
    insecure: false,
    authority: '',
    cacertPath: '',
    certPath: '',
    keyPath: '',
    schemaSource: 'reflection',
    protoFiles: [],
    importPaths: [],
    protosets: [],
    ...overrides,
  };
}

function connectResponse() {
  return {
    ok: true,
    json: async () => ({
      sessionId: 'session-upload',
      bootstrap: { services: [], defaultMetadata: [], targetDefaults: {} },
    }),
    text: async () => '',
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('API response normalization', () => {
  it('accepts bounded HTTP evidence and rejects malformed successful relay payloads', async () => {
    const response = normalizeHTTPResponse({
      status: '200 OK',
      statusCode: 200,
      proto: 'HTTP/1.1',
      headers: [{ name: 'Content-Type', value: 'text/plain' }],
      body: 'hello',
      bodyEncoding: 'text',
      bytes: 5,
      truncated: false,
      redirects: [],
      remoteIp: '127.0.0.1:8080',
      tls: null,
      timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
    });
    expect(response).toMatchObject({ statusCode: 200, body: 'hello', bytes: 5 });
    expect(
      normalizeHTTPResponse({ ...response, status: '700 Custom', statusCode: 700 })
    ).toMatchObject({ status: '700 Custom', statusCode: 700 });

    expect(() =>
      normalizeHTTPResponse({
        ...response,
        timings: { ...response.timings, totalMs: Number.NaN },
      })
    ).toThrow(/malformed HTTP response evidence/i);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...response, headers: 'not-an-array' }))
    );
    await expect(
      sendHTTPRequest({
        method: 'GET',
        url: 'http://localhost:8080',
        headers: [],
        body: '',
        timeoutMs: 30_000,
        followRedirects: false,
      })
    ).rejects.toThrow(/malformed HTTP response evidence/i);
  });

  it('normalizes all scan evidence truncation flags to explicit booleans', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          { address: 'first:1' },
          {
            address: 'second:2',
            servicesTruncated: true,
            detailsTruncated: true,
            errorTruncated: true,
            httpProtocolTruncated: true,
            httpStatusTruncated: true,
            httpServerTruncated: true,
          },
        ])
      )
    );

    const results = await scanAddresses(['first:1', 'second:2']);

    expect(results[0]).toMatchObject({
      servicesTruncated: false,
      detailsTruncated: false,
      errorTruncated: false,
      httpProtocolTruncated: false,
      httpStatusTruncated: false,
      httpServerTruncated: false,
    });
    expect(results[1]).toMatchObject({
      servicesTruncated: true,
      detailsTruncated: true,
      errorTruncated: true,
      httpProtocolTruncated: true,
      httpStatusTruncated: true,
      httpServerTruncated: true,
    });
  });

  it('turns nullable invoke collections into arrays', () => {
    const response = normalizeInvokeResponse({
      headers: null,
      error: { code: 3, name: 'InvalidArgument', message: 'boom', details: null },
      responses: null,
      requests: { total: 1, sent: 1 },
      trailers: null,
    });
    expect(response.headers).toEqual([]);
    expect(response.responses).toEqual([]);
    expect(response.trailers).toEqual([]);
    expect(response.error?.details).toEqual([]);
    expect(response.timings).toBeNull();
  });

  it('keeps only measured invoke timing evidence and leaves unavailable phases null', () => {
    const response = normalizeInvokeResponse({
      headers: [],
      error: null,
      responses: [
        { isError: false, message: { value: 1 }, sequence: 1 },
        { isError: false, message: { value: 2 }, sequence: 2, elapsedMs: 0 },
        { isError: false, message: { value: 3 }, sequence: 3, elapsedMs: -1 },
      ],
      requests: null,
      trailers: [],
      timings: {
        headersMs: 4.25,
        firstMessageMs: null,
        trailersMs: Number.NaN,
        totalMs: 19.5,
      },
    });

    expect(response.responses.map((entry) => entry.elapsedMs)).toEqual([null, 0, null]);
    expect(response.timings).toEqual({
      headersMs: 4.25,
      firstMessageMs: null,
      trailersMs: null,
      totalMs: 19.5,
    });
    expect(normalizeInvokeResponse({ timings: { totalMs: -1 } }).timings).toBeNull();
  });

  it('normalizes local invoke limits without turning malformed evidence into server success', () => {
    const valid = normalizeInvokeResponse({
      localLimit: {
        reason: 'response-bytes',
        message: 'ProtoPeek stopped before retaining the next response.',
        retainedResponses: 2,
        retainedResponseBytes: 6_000_000,
        maxResponses: 512,
        maxResponseBytes: 8_388_608,
        maxDurationSeconds: 60,
      },
    });
    expect(valid.localLimit).toEqual({
      reason: 'response-bytes',
      message: 'ProtoPeek stopped before retaining the next response.',
      retainedResponses: 2,
      retainedResponseBytes: 6_000_000,
      maxResponses: 512,
      maxResponseBytes: 8_388_608,
      maxDurationSeconds: 60,
    });

    expect(normalizeInvokeResponse({}).localLimit).toBeNull();
    expect(
      normalizeInvokeResponse({ localLimit: { reason: 'server-said-ok' } }).localLimit
    ).toEqual(
      expect.objectContaining({
        reason: 'invalid',
        message: expect.stringMatching(/malformed local-limit evidence/i),
      })
    );
  });

  it('normalizes sparse proto catalogs recursively', () => {
    const catalog = normalizeProtoCatalog({
      files: [
        {
          name: 'empty.proto',
          package: 'test',
          dependencies: null,
          services: null,
          messages: [
            { name: 'Empty', fullName: 'test.Empty', fields: null, messages: null, enums: null },
          ],
          enums: null,
          protoText: 'message Empty {}',
          wellKnown: false,
        },
      ],
    });
    expect(catalog.files[0].dependencies).toEqual([]);
    expect(catalog.files[0].services).toEqual([]);
    expect(catalog.files[0].messages[0].fields).toEqual([]);
    expect(catalog.files[0].messages[0].messages).toEqual([]);
    expect(catalog.files[0].messages[0].enums).toEqual([]);
  });

  it('normalizes launcher target defaults', () => {
    const result = normalizeBootstrap({
      launcherMode: true,
      services: null,
      defaultMetadata: null,
      targetDefaults: {
        schemaSource: 'reflection',
        protoFiles: null,
        importPaths: null,
        protosets: null,
      },
    });
    expect(result.services).toEqual([]);
    expect(result.defaultMetadata).toEqual([]);
    expect(result.initialScanTarget).toBe('');
    expect(result.targetDefaults.protoFiles).toEqual([]);
    expect(result.targetDefaults.importPaths).toEqual([]);
    expect(result.targetDefaults.protosets).toEqual([]);
  });
});

describe('workspace connect request encoding', () => {
  it('keeps reflection and host-path targets on the existing JSON request path', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      connectResponse()
    );
    vi.stubGlobal('fetch', fetchMock);
    const target = workspaceTarget({
      schemaSource: 'proto-files',
      protoFiles: ['/host/api.proto'],
      importPaths: ['/host'],
    });

    await connectWorkspaceTarget(target);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ target });
  });

  it('sends browser folders as ordered multipart fields without reading or copying file bytes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      connectResponse()
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = new File(['first'], 'first.proto', { type: 'text/plain' });
    const second = new File(['second'], 'second.proto', { type: 'text/plain' });
    const readFirst = vi.spyOn(first, 'arrayBuffer');
    const readSecond = vi.spyOn(second, 'arrayBuffer');
    const append = vi.spyOn(FormData.prototype, 'append');
    const folder = buildBrowserProtoFolderSelection('checkout', [
      { path: 'v1/second.proto', file: second },
      { path: 'first.proto', file: first },
    ]);
    const target = workspaceTarget({ schemaSource: 'browser-proto-folder' });

    await connectWorkspaceTarget(target, undefined, folder);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    const entries = Array.from((init.body as FormData).entries());
    expect(entries.map(([name]) => name)).toEqual(['target', 'manifest', 'file.0', 'file.1']);
    expect(JSON.parse(String(entries[0][1]))).toEqual(target);
    expect(JSON.parse(String(entries[1][1]))).toEqual({
      version: 1,
      files: [
        { path: 'first.proto', size: 5 },
        { path: 'v1/second.proto', size: 6 },
      ],
    });
    expect(append).toHaveBeenCalledWith('file.0', first, 'proto');
    expect(append).toHaveBeenCalledWith('file.1', second, 'proto');
    expect(readFirst).not.toHaveBeenCalled();
    expect(readSecond).not.toHaveBeenCalled();
  });

  it('refuses a browser-folder connect without a transient folder manifest', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      connectResponse()
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      connectWorkspaceTarget(workspaceTarget({ schemaSource: 'browser-proto-folder' }))
    ).rejects.toThrow(/Folder required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('gRPC Health API', () => {
  const startedAt = '2026-08-20T12:00:00.000Z';

  it('posts a direct Check with live metadata and structurally validates the response', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            service: 'catalog.v1.Catalog',
            startedAt,
            handlerInvokeMs: 3.25,
            servingStatus: { code: 1, name: 'SERVING' },
            grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
            headers: [{ name: 'x-backend', value: 'blue' }],
            trailers: [],
            headersTruncated: false,
            trailersTruncated: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkHealth(
      '',
      {
        service: 'catalog.v1.Catalog',
        timeout_seconds: 5,
        metadata: [{ name: 'authorization', value: 'secret' }],
      },
      controller.signal
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/health/check');
    expect(init?.signal).toBe(controller.signal);
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init?.headers).has('x-protopeek-csrf-token')).toBe(true);
    expect(JSON.parse(String(init?.body))).toEqual({
      service: 'catalog.v1.Catalog',
      timeout_seconds: 5,
      metadata: [{ name: 'authorization', value: 'secret' }],
    });
    expect(result).toMatchObject({
      service: 'catalog.v1.Catalog',
      handlerInvokeMs: 3.25,
      servingStatus: { code: 1, name: 'SERVING' },
    });
    expect(result).not.toHaveProperty('metadata');
  });

  it('streams a workspace Watch through the bounded parser at the session-scoped path', async () => {
    const lines = [
      {
        type: 'started',
        service: '',
        startedAt,
        observedOffsetMs: 0,
        durationSeconds: 60,
        metadataCount: 1,
      },
      {
        type: 'status-observed',
        service: '',
        startedAt,
        observedOffsetMs: 2,
        sequence: 1,
        servingStatus: { code: 3, name: 'SERVICE_UNKNOWN' },
      },
      {
        type: 'ended',
        service: '',
        startedAt,
        observedOffsetMs: 60000,
        reason: 'duration-limit',
        observationCount: 1,
        grpcStatus: {
          code: 4,
          name: 'DeadlineExceeded',
          message: 'watch duration reached',
          messageTruncated: false,
        },
        trailers: [],
        trailersTruncated: false,
      },
    ];
    const bytes = new TextEncoder().encode(
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
    );
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(bytes.slice(0, 17));
        stream.enqueue(bytes.slice(17));
        stream.close();
      },
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];

    await watchHealth(
      'session / one',
      { service: '', duration_seconds: 60, metadata: [{ name: 'x-env', value: 'prod' }] },
      (event) => events.push(event)
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/workspace/health/watch?session_id=session%20%2F%20one');
    expect(JSON.parse(String(init?.body))).toEqual({
      service: '',
      duration_seconds: 60,
      metadata: [{ name: 'x-env', value: 'prod' }],
    });
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('x-protopeek-csrf-token')).toBe(true);
    expect(events).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'ended', reason: 'duration-limit' });
  });

  it('classifies HTTP and truncated Watch responses as relay/protocol failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('watch capacity reached', { status: 429 }))
    );
    await expect(
      watchHealth('', { service: '', duration_seconds: 60, metadata: [] }, () => undefined)
    ).rejects.toThrow(/watch capacity reached/i);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>proxy login</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
      )
    );
    await expect(
      watchHealth('', { service: '', duration_seconds: 60, metadata: [] }, () => undefined)
    ).rejects.toThrow(/application\/x-ndjson/i);

    const incomplete = new TextEncoder().encode(
      `${JSON.stringify({
        type: 'started',
        service: '',
        startedAt,
        observedOffsetMs: 0,
        durationSeconds: 60,
        metadataCount: 0,
      })}\n`
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(incomplete, {
            status: 200,
            headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
          })
      )
    );
    await expect(
      watchHealth('', { service: '', duration_seconds: 60, metadata: [] }, () => undefined)
    ).rejects.toThrow(/without a terminal/i);
  });
});
