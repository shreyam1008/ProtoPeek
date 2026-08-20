import { describe, expect, it, vi } from 'vitest';

import {
  buildWorkspaceExport,
  commandPreview,
  displayBuildVersion,
  evaluateAssertions,
  filterMetadataForInvoke,
  generateRequestTemplate,
  loadStoredWorkspaceSection,
  matchesMethodFilter,
  normalizeHTTPHistory,
  percentile,
  prepareMetadataForReplay,
  prepareURLForReplay,
  safeParseJson,
  sanitizeAssertionForPersistence,
  sanitizeHTTPHeadersForPersistence,
  sanitizeInvokeResponseForExport,
  sanitizeMetadataForPersistence,
  sanitizeURLForPersistence,
  serializeWorkspaceExport,
  simulationSummary,
  storeValuesAtomically,
  validateWorkspaceImport,
  workspaceImportLimits,
  workspaceImportMaxBytes,
} from './utils';

describe('displayBuildVersion', () => {
  it('keeps internal linker placeholders out of the product UI', () => {
    expect(displayBuildVersion('dev build <no version set>')).toBe('development');
    expect(displayBuildVersion('v0.3.0')).toBe('v0.3.0');
  });
});

describe('persistence redaction', () => {
  it('redacts auth, cookies, binary values, and token-like metadata', () => {
    const sanitized = sanitizeMetadataForPersistence([
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'Cookie', value: 'session=secret' },
      { name: 'Set-Cookie', value: 'session=secret' },
      { name: 'Proxy-Authorization', value: 'Basic secret' },
      { name: 'trace-bin', value: 'binary' },
      { name: 'x-api-key', value: 'api-secret' },
      { name: 'x-auth-token', value: 'token-secret' },
      { name: 'x-request-id', value: 'safe' },
    ]);

    expect(sanitized.slice(0, 7).every((entry) => entry.value === '[redacted]')).toBe(true);
    expect(sanitized[7].value).toBe('safe');
  });

  it('recognizes common camel-case and vendor credential aliases without hiding nearby fields', () => {
    const secretNames = [
      'xApiKey',
      'authToken',
      'clientSecret',
      'x-authorization',
      'x-jwt',
      'sessionId',
      'AWSAccessKeyId',
      'X-Amz-Credential',
      'X-Amz-Signature',
      'X-Amz-Security-Token',
      'Ocp-Apim-Subscription-Key',
      'X-Functions-Key',
      'code_verifier',
      'SAMLResponse',
      'XAPIKey',
      'xapikey',
      'XAUTHTOKEN',
      'xauthtoken',
      'awssecretaccesskey',
      'id_token_hint',
      'auth_token_v2',
    ];
    const safeNames = [
      'client_id',
      'public_key',
      'sort_key',
      'status_code',
      'promo_code',
      'token_type',
      'session_mode',
      'signature_version',
      'code_challenge',
      'X-Request-ID',
    ];
    const sanitized = sanitizeMetadataForPersistence([
      ...secretNames.map((name) => ({ name, value: 'secret' })),
      ...safeNames.map((name) => ({ name, value: 'visible' })),
    ]);
    expect(
      sanitized.slice(0, secretNames.length).every((entry) => entry.value === '[redacted]')
    ).toBe(true);
    expect(sanitized.slice(secretNames.length).every((entry) => entry.value === 'visible')).toBe(
      true
    );
  });

  it('redacts token-like query parameters in persisted HTTP URLs', () => {
    const sanitized = sanitizeURLForPersistence(
      'https://example.test/items?access_token=secret&id_token_hint=id-secret&auth_token_v2=versioned-secret&page=2&password=hunter2'
    );
    const parsed = new URL(sanitized);
    expect(parsed.searchParams.get('access_token')).toBe('[redacted]');
    expect(parsed.searchParams.get('password')).toBe('[redacted]');
    expect(parsed.searchParams.get('id_token_hint')).toBe('[redacted]');
    expect(parsed.searchParams.get('auth_token_v2')).toBe('[redacted]');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('removes URL userinfo and redacts signature-style query credentials', () => {
    const sanitized = sanitizeURLForPersistence(
      'https://user:hunter2@example.test/items?sig=azure-secret&X-Amz-Signature=aws-secret&page=2'
    );
    const parsed = new URL(sanitized);
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.searchParams.get('sig')).toBe('[redacted]');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBe('[redacted]');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('preserves duplicate query shape, removes fragments, and avoids safe-name false positives', () => {
    const sanitized = sanitizeURLForPersistence(
      'https://user:password@example.test/items?token=one&token=two&auth=three&jwt=four&sessionid=five&code=six&key=seven&session=eight&sort_key=name&public_key=id&status_code=200&promo_code=SAVE&token_type=bearer&session_mode=quiet&signature_version=4&code_challenge=abc#access_token=fragment-secret'
    );
    const parsed = new URL(sanitized);
    expect(parsed.hash).toBe('');
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.searchParams.getAll('token')).toEqual(['[redacted]', '[redacted]']);
    for (const name of ['auth', 'jwt', 'sessionid', 'code', 'key', 'session']) {
      expect(parsed.searchParams.get(name)).toBe('[redacted]');
    }
    for (const name of [
      'sort_key',
      'public_key',
      'status_code',
      'promo_code',
      'token_type',
      'session_mode',
      'signature_version',
      'code_challenge',
    ]) {
      expect(parsed.searchParams.get(name)).not.toBe('[redacted]');
    }

    const replay = prepareURLForReplay(sanitized);
    expect(replay.redactedCount).toBe(8);
    expect(new URL(replay.url).searchParams.getAll('token')).toEqual(['', '']);
  });

  it('keeps only an explicit safe-header allowlist in automatic HTTP history', () => {
    expect(
      sanitizeHTTPHeadersForPersistence([
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Request-ID', value: 'request-1' },
        { name: 'X-Password', value: 'hunter2' },
        { name: 'X-Credential', value: 'credential' },
        { name: 'X-Amz-Signature', value: 'signature' },
        { name: 'X-Custom', value: 'possibly-private' },
      ])
    ).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Request-ID', value: 'request-1' },
      { name: 'X-Password', value: '[redacted]' },
      { name: 'X-Credential', value: '[redacted]' },
      { name: 'X-Amz-Signature', value: '[redacted]' },
      { name: 'X-Custom', value: '[redacted]' },
    ]);
  });

  it('redacts sensitive response metadata and persisted header assertions', () => {
    const response = sanitizeInvokeResponseForExport({
      headers: [{ name: 'Set-Cookie', value: 'session=secret' }],
      error: null,
      responses: [],
      requests: null,
      trailers: [{ name: 'trace-bin', value: 'binary' }],
    });
    expect(response.headers[0]?.value).toBe('[redacted]');
    expect(response.trailers[0]?.value).toBe('[redacted]');

    expect(
      sanitizeAssertionForPersistence({
        id: 'secret-assertion',
        name: 'Token matches',
        kind: 'header',
        comparator: 'equals',
        target: 'x-auth-token',
        value: 'secret',
      }).value
    ).toBe('[redacted]');
  });

  it('clears persisted sentinels on replay and filters them from invocation metadata', () => {
    const replay = prepareMetadataForReplay([
      { name: 'authorization', value: '[redacted]' },
      { name: 'x-visible', value: '[redacted]' },
      { name: 'x-request-id', value: 'request-1' },
    ]);

    expect(replay).toEqual({
      redactedCount: 2,
      metadata: [
        { name: 'authorization', value: '' },
        { name: 'x-visible', value: '' },
        { name: 'x-request-id', value: 'request-1' },
      ],
    });
    expect(filterMetadataForInvoke(replay.metadata)).toEqual([
      { name: 'x-visible', value: '' },
      { name: 'x-request-id', value: 'request-1' },
    ]);
    expect(filterMetadataForInvoke([{ name: 'authorization', value: '[redacted]' }])).toEqual([]);
    expect(
      filterMetadataForInvoke([
        { name: 'authorization', value: '   ' },
        { name: 'cookie', value: '[REDACTED]' },
        { name: 'x-visible', value: ' [redacted] ' },
      ])
    ).toEqual([]);
  });

  it('blanks redacted query markers before replay', () => {
    const replay = prepareURLForReplay('https://example.test/items?token=%5Bredacted%5D&page=2');
    expect(replay.redactedCount).toBe(1);
    const parsed = new URL(replay.url);
    expect(parsed.searchParams.get('token')).toBe('');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(replay.url).not.toContain('%5Bredacted%5D');
  });

  it('drops malformed or oversized stored HTTP history entries non-fatally', () => {
    expect(normalizeHTTPHistory({})).toEqual([]);
    expect(
      normalizeHTTPHistory([
        {
          id: 'bad-date',
          createdAt: 'not-a-date',
          method: 'GET',
          url: 'https://example.test/',
          requestHeaders: [],
          status: '200 OK',
          statusCode: 200,
          totalMs: 1,
        },
      ])
    ).toEqual([]);
  });
});

describe('workspace transfer validation', () => {
  const emptyV1 = {
    format: 'protopeek-workspace',
    version: 1,
    exportedAt: '2026-08-20T00:00:00.000Z',
    assertions: [],
    collections: [],
    environments: [],
    targets: [],
  };
  const collection = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    name: id,
    notes: '',
    service: 'demo.Echo',
    method: 'demo.Echo/Echo',
    metadata: [],
    timeoutSeconds: 15,
    requestText: '{}',
    ...overrides,
  });

  it('builds a versioned default export without automatic history', () => {
    const exported = buildWorkspaceExport({
      assertions: [],
      collections: [],
      environments: [],
      targets: [],
    });
    expect(exported).toMatchObject({ format: 'protopeek-workspace', version: 1 });
    expect(exported).not.toHaveProperty('history');
  });

  it('serializes only self-importable workspaces within the exact UTF-8 file limit', () => {
    const content = serializeWorkspaceExport({
      assertions: [],
      collections: [collection('portable')],
      environments: [],
      targets: [],
    });
    expect(new TextEncoder().encode(content).length).toBeLessThanOrEqual(workspaceImportMaxBytes);
    expect(validateWorkspaceImport(JSON.parse(content)).error).toBeNull();

    expect(() =>
      buildWorkspaceExport({
        assertions: [],
        collections: Array.from({ length: workspaceImportLimits.collections + 1 }, (_, index) =>
          collection(`collection-${index}`)
        ),
        environments: [],
        targets: [],
      })
    ).toThrow(/cannot be exported.*100-item limit/i);

    expect(() =>
      serializeWorkspaceExport({
        assertions: [],
        collections: Array.from({ length: 9 }, (_, index) =>
          collection(`large-${index}`, { requestText: '界'.repeat(512 * 1024) })
        ),
        environments: [],
        targets: [],
      })
    ).toThrow(/exceed the 4 MiB import limit/i);
  });

  it('refuses an export whose saved request cannot resolve a target on import', () => {
    expect(() =>
      serializeWorkspaceExport({
        assertions: [],
        collections: [collection('orphan', { targetId: 'deleted-target' })],
        environments: [],
        targets: [],
      })
    ).toThrow(/unavailable target.*no address fallback/i);
  });

  it('refuses a saved request whose profile ID and address contradict each other', () => {
    expect(() =>
      serializeWorkspaceExport({
        assertions: [],
        collections: [
          collection('conflicting-scope', {
            targetId: 'target-a',
            targetAddress: 'elsewhere:50051',
          }),
        ],
        environments: [],
        targets: [
          {
            id: 'target-a',
            name: 'Target A',
            notes: '',
            updatedAt: '2026-08-20T00:00:00.000Z',
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
          },
        ],
      })
    ).toThrow(/target address conflicts with profile target-a/i);
  });

  it('rolls back every prior workspace key when an atomic write fails', () => {
    const firstKey = 'protopeek.test.atomic-first';
    const secondKey = 'protopeek.test.atomic-second';
    window.localStorage.setItem(firstKey, 'old-first');
    window.localStorage.setItem(secondKey, 'old-second');
    const nativeSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === secondKey && value === JSON.stringify('new-second')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      nativeSetItem.call(this, key, value);
    });

    expect(
      storeValuesAtomically([
        [firstKey, 'new-first'],
        [secondKey, 'new-second'],
      ])
    ).toMatchObject({ ok: false });
    expect(window.localStorage.getItem(firstKey)).toBe('old-first');
    expect(window.localStorage.getItem(secondKey)).toBe('old-second');
    vi.restoreAllMocks();
    window.localStorage.removeItem(firstKey);
    window.localStorage.removeItem(secondKey);
  });

  it('marks a browser read failure as uncaptured while leaving the key untouched', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Read blocked', 'SecurityError');
    });
    const loaded = loadStoredWorkspaceSection('protopeek.test.unreadable', 'collections', []);
    expect(loaded.value).toEqual([]);
    expect(loaded.recovery).toMatchObject({ raw: null });
    expect(loaded.recovery?.reason).toMatch(/could not be read/i);
    vi.restoreAllMocks();
  });

  it('salvages valid stored records while leaving the exact original quarantined', () => {
    const key = 'protopeek.test.collections';
    const raw = JSON.stringify([
      collection('valid-a'),
      collection('invalid', { createdAt: 'not-a-date' }),
      collection('valid-b'),
      collection('valid-a', { name: 'duplicate' }),
    ]);
    window.localStorage.setItem(key, raw);
    const loaded = loadStoredWorkspaceSection(key, 'collections', []);
    expect(loaded.value.map((entry) => entry.id)).toEqual(['valid-a', 'valid-b']);
    expect(loaded.recovery).toMatchObject({ key, section: 'collections', raw });
    expect(loaded.recovery?.reason).toMatch(/2 invalid or duplicate entries/i);
    expect(window.localStorage.getItem(key)).toBe(raw);
    window.localStorage.removeItem(key);
  });

  it('recovers only the bounded newest stored records without overwriting overflow', () => {
    const key = 'protopeek.test.collection-overflow';
    const raw = JSON.stringify(
      Array.from({ length: workspaceImportLimits.collections + 1 }, (_, index) =>
        collection(`collection-${index}`)
      )
    );
    window.localStorage.setItem(key, raw);
    const loaded = loadStoredWorkspaceSection(key, 'collections', []);
    expect(loaded.value).toHaveLength(workspaceImportLimits.collections);
    expect(loaded.recovery?.reason).toMatch(/1 entry was beyond the 100-item limit/i);
    expect(window.localStorage.getItem(key)).toBe(raw);
    window.localStorage.removeItem(key);
  });

  it('rejects non-object and non-array workspace shapes', () => {
    expect(validateWorkspaceImport([]).error).toContain('must be an object');
    expect(validateWorkspaceImport({ ...emptyV1, collections: {} }).error).toContain(
      'collections must be an array'
    );
  });

  it('enforces collection counts before accepting a workspace', () => {
    expect(
      validateWorkspaceImport({
        ...emptyV1,
        collections: Array.from(
          { length: workspaceImportLimits.collections + 1 },
          (_, index) => index
        ),
      }).error
    ).toContain(`${workspaceImportLimits.collections}-item limit`);
  });

  it('rejects unsupported versions and oversized target path strings', () => {
    expect(validateWorkspaceImport({ ...emptyV1, version: 2 }).error).toContain(
      'version 2 is not supported'
    );
    expect(
      validateWorkspaceImport({
        assertions: [],
        collections: [],
        environments: [],
        history: [],
        targets: [
          {
            id: 'target-long-path',
            name: 'Local',
            notes: '',
            updatedAt: '2026-08-20T00:00:00.000Z',
            address: 'localhost:50051',
            plaintext: true,
            insecure: false,
            authority: '',
            cacertPath: '',
            certPath: '',
            keyPath: '',
            schemaSource: 'proto-files',
            protoFiles: ['x'.repeat(4097)],
            importPaths: [],
            protosets: [],
          },
        ],
      }).error
    ).toContain('4096-character limit');
  });

  it('accepts bounded legacy exports and reports host file paths', () => {
    const legacy = validateWorkspaceImport({
      assertions: [],
      collections: [],
      environments: [],
      history: [],
      targets: [
        {
          id: 'target-1',
          name: 'Local',
          notes: '',
          updatedAt: '2026-08-20T00:00:00.000Z',
          address: 'localhost:50051',
          plaintext: false,
          insecure: false,
          authority: '',
          cacertPath: '/certs/ca.pem',
          certPath: '',
          keyPath: '',
          schemaSource: 'proto-files',
          protoFiles: ['/protos/service.proto'],
          importPaths: ['/protos'],
          protosets: [],
        },
      ],
    });

    expect(legacy.error).toBeNull();
    expect(legacy.value).toMatchObject({ legacy: true, hasHostFilePaths: true });
  });

  it('retains which legacy sections were actually present', () => {
    const legacy = validateWorkspaceImport({ history: [] });
    expect(legacy.error).toBeNull();
    expect(legacy.value?.sections).toEqual({
      assertions: false,
      collections: false,
      environments: false,
      history: true,
      targets: false,
    });
  });

  it('rejects invalid imported timestamps before History can render them', () => {
    expect(
      validateWorkspaceImport({
        collections: [
          {
            id: 'bad-date',
            createdAt: 'not-a-date',
            updatedAt: '2026-08-20T00:00:00.000Z',
            name: 'Bad date',
            notes: '',
            service: 'demo.Echo',
            method: 'demo.Echo/Echo',
            metadata: [],
            timeoutSeconds: 15,
            requestText: '{}',
          },
        ],
      }).error
    ).toContain('valid timestamp');
  });
});

describe('safeParseJson', () => {
  it('returns a parse error for invalid JSON', () => {
    const result = safeParseJson('{');
    expect(result.error).toBeTruthy();
    expect(result.value).toBeNull();
  });
});

describe('generateRequestTemplate', () => {
  it('creates nested payloads from schema metadata', () => {
    const schema = {
      requestType: 'demo.Request',
      requestStream: false,
      enumTypes: {
        'demo.Status': [{ num: 0, name: 'STATUS_UNKNOWN' }],
      },
      messageTypes: {
        'demo.Request': [
          {
            name: 'id',
            protoName: 'id',
            type: 'string',
            oneOfFields: [],
            isMessage: false,
            isEnum: false,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
          {
            name: 'child',
            protoName: 'child',
            type: 'demo.Child',
            oneOfFields: [],
            isMessage: true,
            isEnum: false,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
        ],
        'demo.Child': [
          {
            name: 'status',
            protoName: 'status',
            type: 'demo.Status',
            oneOfFields: [],
            isMessage: false,
            isEnum: true,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
        ],
      },
    };

    expect(generateRequestTemplate(schema)).toEqual({
      child: {
        status: 'STATUS_UNKNOWN',
      },
      id: '',
    });
  });
});

describe('percentile', () => {
  it('returns the correct percentile for a sorted window', () => {
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });
});

describe('simulationSummary', () => {
  it('computes throughput and tail latencies', () => {
    const summary = simulationSummary(
      'demo.Service.Echo',
      { runs: 5, concurrency: 2, thinkTimeMs: 0 },
      [10, 20, 30, 40, 50],
      5,
      0,
      100
    );

    expect(summary.p95).toBe(50);
    expect(summary.successCount).toBe(5);
    expect(summary.throughputRps).toBe(50);
  });
});

describe('commandPreview', () => {
  it('builds a grpcurl command preview', () => {
    expect(
      commandPreview({
        target: 'localhost:50051',
        method: 'demo.Service.Echo',
        metadata: [{ name: 'authorization', value: 'Bearer token' }],
        timeoutSeconds: 5,
        requestText: '{"id":"123"}',
        grpcurlOptions: '-plaintext',
      })
    ).toContain('grpcurl -plaintext -max-time 5');
  });
});

describe('matchesMethodFilter', () => {
  const bidiMethod = {
    name: 'Watch',
    fullName: 'demo.Service.Watch',
    description: '',
    clientStreaming: true,
    serverStreaming: true,
    requestType: 'demo.Request',
    responseType: 'demo.Response',
  };

  it('matches bidirectional streams correctly', () => {
    expect(matchesMethodFilter(bidiMethod, 'bidirectional')).toBe(true);
    expect(matchesMethodFilter(bidiMethod, 'unary')).toBe(false);
  });
});

describe('evaluateAssertions', () => {
  it('checks status, latency, and payload assertions', () => {
    const assertions = evaluateAssertions({
      rules: [
        {
          id: '1',
          name: 'Status OK',
          kind: 'status',
          comparator: 'equals',
          target: '',
          value: 'OK',
        },
        {
          id: '2',
          name: 'Latency under 250 ms',
          kind: 'latency_ms',
          comparator: 'lte',
          target: '',
          value: '250',
        },
        {
          id: '3',
          name: 'Payload mentions pong',
          kind: 'body_text',
          comparator: 'contains',
          target: '',
          value: 'pong',
        },
      ],
      latencyMs: 120,
      result: {
        headers: [{ name: 'content-type', value: 'application/grpc' }],
        error: null,
        responses: [{ isError: false, message: { text: 'pong' }, sequence: 1, elapsedMs: 12 }],
        requests: null,
        trailers: [],
      },
    });

    expect(assertions.every((item) => item.passed)).toBe(true);
  });
});
