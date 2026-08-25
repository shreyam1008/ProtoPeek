import { describe, expect, it } from 'vitest';

import { discoverOpenAPISpecURL, parseOpenAPIText } from './openapi';

describe('OpenAPI import', () => {
  it('turns an OpenAPI 3 definition into bounded request drafts', () => {
    const collection = parseOpenAPIText(
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Bookstore', version: '1.2.0' },
        servers: [
          { url: 'https://{region}.example.test/api', variables: { region: { default: 'eu' } } },
        ],
        components: {
          schemas: {
            Book: {
              type: 'object',
              properties: {
                title: { type: 'string', example: 'ProtoPeek' },
                pages: { type: 'integer' },
              },
            },
          },
        },
        paths: {
          '/books/{id}': {
            get: {
              operationId: 'getBook',
              tags: ['Books'],
              summary: 'Get a book',
              parameters: [
                { name: 'id', in: 'path', required: true, example: 'book-1' },
                { name: 'expand', in: 'query', schema: { type: 'string', default: 'author' } },
                { name: 'X-Trace', in: 'header', example: 'trace-1' },
              ],
            },
            post: {
              operationId: 'updateBook',
              tags: ['Books'],
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Book' } } },
              },
            },
          },
        },
      }),
      'https://docs.example.test/openapi.json'
    );

    expect(collection).toMatchObject({
      title: 'Bookstore',
      version: '1.2.0',
      baseURL: 'https://eu.example.test/api',
    });
    expect(collection.operations[0]).toMatchObject({
      id: 'getBook',
      tag: 'Books',
      method: 'GET',
      url: 'https://eu.example.test/api/books/book-1',
      query: [{ name: 'expand', value: 'author' }],
      headers: [{ name: 'X-Trace', value: 'trace-1' }],
    });
    expect(collection.operations[1]?.body).toContain('"title": "ProtoPeek"');
  });

  it('supports Swagger 2 host, base path, and body schemas', () => {
    const collection = parseOpenAPIText(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Legacy API', version: '2' },
        schemes: ['https'],
        host: 'legacy.example.test',
        basePath: '/v2',
        paths: {
          '/items': {
            post: {
              tags: ['Items'],
              parameters: [
                {
                  name: 'body',
                  in: 'body',
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              ],
            },
          },
        },
      })
    );

    expect(collection.operations[0]).toMatchObject({
      method: 'POST',
      url: 'https://legacy.example.test/v2/items',
    });
    expect(collection.operations[0]?.body).toBe('{\n  "name": ""\n}');
  });

  it('finds linked definitions on Swagger UI and Scalar pages', () => {
    expect(
      discoverOpenAPISpecURL(
        '<script>SwaggerUIBundle({ url: "/openapi.json" })</script>',
        'https://api.example.test/docs'
      )
    ).toBe('https://api.example.test/openapi.json');
    expect(
      discoverOpenAPISpecURL(
        '<script id="api-reference" data-url="./spec.json"></script>',
        'https://api.example.test/docs/'
      )
    ).toBe('https://api.example.test/docs/spec.json');
  });

  it('rejects YAML and unrelated JSON with actionable errors', () => {
    expect(() => parseOpenAPIText('openapi: 3.1.0')).toThrow(/direct JSON definition URL/i);
    expect(() => parseOpenAPIText('{"hello":"world"}')).toThrow(/OpenAPI 3.x or Swagger 2.0/i);
  });
});
