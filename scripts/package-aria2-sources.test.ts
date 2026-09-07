import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { fetchSourceArchive } from './fetch-source-archive';

test('preserves a compressed source archive despite Content-Encoding', async () => {
  const archive = gzipSync('source archive fixture');
  let encoding = '';
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      encoding = request.headers.get('accept-encoding') || '';
      return new Response(archive, { headers: { 'Content-Encoding': 'gzip' } });
    },
  });
  try {
    expect(await fetchSourceArchive(`http://127.0.0.1:${server.port}/source.tar.gz`)).toEqual(archive);
    expect(encoding).toBe('identity');
  } finally { server.stop(true); }
});

test('rejects failed archive responses instead of packaging their bodies', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unavailable', {status: 503}) });
  try {
    await expect(fetchSourceArchive(`http://127.0.0.1:${server.port}/source.tar.gz`)).rejects.toThrow('HTTP 503');
  } finally { server.stop(true); }
});
