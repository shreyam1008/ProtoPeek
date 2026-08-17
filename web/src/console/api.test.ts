import { describe, expect, it } from 'vitest';

import { normalizeBootstrap, normalizeInvokeResponse, normalizeProtoCatalog } from './api';

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
    expect(result.targetDefaults.protoFiles).toEqual([]);
    expect(result.targetDefaults.importPaths).toEqual([]);
    expect(result.targetDefaults.protosets).toEqual([]);
  });
});
