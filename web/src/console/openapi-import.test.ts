import { expect, it, vi } from 'vitest';
import { maxOpenAPIDocumentBytes } from './openapi';
import { importOpenAPIFromFile } from './openapi-import';

it('rejects an oversized OpenAPI file before reading it into memory', async () => {
  const text = vi.fn();
  const file = { size: maxOpenAPIDocumentBytes + 1, name: 'huge.json', text } as unknown as File;
  await expect(importOpenAPIFromFile(file)).rejects.toThrow('2 MiB import limit');
  expect(text).not.toHaveBeenCalled();
});

it('rejects an empty operation collection with an actionable parser error', async () => {
  const file = {
    size: 100,
    name: 'empty.json',
    text: async () => JSON.stringify({ openapi: '3.1.0', info: { title: 'Empty' }, paths: {} }),
  } as File;
  await expect(importOpenAPIFromFile(file)).rejects.toThrow(/operation/i);
});
