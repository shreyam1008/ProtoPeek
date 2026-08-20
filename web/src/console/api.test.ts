import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserProtoFolderSelection } from '@/shared/proto-folder';
import type { WorkspaceTargetConfig } from '@/shared/types';

import {
  connectWorkspaceTarget,
  normalizeBootstrap,
  normalizeInvokeResponse,
  normalizeProtoCatalog,
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
