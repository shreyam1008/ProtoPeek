import { afterEach, expect, mock, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import worker from '../web/site/_worker.js';
import { MAX_PAGES_ASSET_BYTES, preparePagesAssets } from './prepare-pages-assets.mjs';

const scratch = fileURLToPath(new URL('../.local/', import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'pages-assets-test-'));
  fixtures.push(root);
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  return root;
}
afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(scratch))
      throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});
const pool = 'apt/pool/main/d/protopeek';
const name = 'protopeek_0.7.0_amd64.deb';
const releaseURL = `https://github.com/shreyam1008/ProtoPeek/releases/download/v0.7.0/${name}`;

for (const method of ['GET', 'HEAD']) {
  for (const arch of ['amd64', 'arm64', 'i386']) {
    test(`redirects ${method} ${arch} APT bytes without querying ASSETS or forwarding query`, async () => {
      const fetch = mock(async () => new Response('must not be read'));
      const response = await worker.fetch(
        new Request(
          `https://protopeek.shreyam1008.com.np/${pool}/protopeek_0.7.0_${arch}.deb?url=https://attacker.example`,
          { method }
        ),
        { ASSETS: { fetch } }
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(releaseURL.replace('_amd64.', `_${arch}.`));
      expect(await response.text()).toBe('');
      expect(fetch).not.toHaveBeenCalled();
    });
  }
}

test('keeps malformed paths, unrelated assets and non-GET methods in the existing ASSETS lane', async () => {
  for (const suffix of [
    'protopeek_01.7.0_amd64.deb',
    'protopeek_0.7.0-rc.1_amd64.deb',
    'protopeek_0.7.0_x86_64.deb',
    `${name}.sig`,
    `${name}%3fredirect=evil`,
  ]) {
    const fetch = mock(async () => new Response('ordinary asset'));
    const request = new Request(`https://protopeek.shreyam1008.com.np/${pool}/${suffix}`);
    expect(await (await worker.fetch(request, { ASSETS: { fetch } })).text()).toBe(
      'ordinary asset'
    );
    expect(fetch).toHaveBeenCalledWith(request);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const fetch = mock(async () => new Response('ordinary asset'));
    const request = new Request(`https://protopeek.shreyam1008.com.np/${pool}/${name}`, { method });
    expect(await (await worker.fetch(request, { ASSETS: { fetch } })).text()).toBe(
      'ordinary asset'
    );
    expect(fetch).toHaveBeenCalledWith(request);
  }
});

test('preserves root Markdown negotiation, fallback and Vary', async () => {
  for (const method of ['GET', 'HEAD']) {
    const fetch = mock(
      async () => new Response(method === 'HEAD' ? null : '# Docs', { headers: { Vary: 'Origin' } })
    );
    const response = await worker.fetch(
      new Request('https://protopeek.shreyam1008.com.np/', {
        method,
        headers: { Accept: 'text/html, text/markdown;q=0.9' },
      }),
      { ASSETS: { fetch } }
    );
    expect(new URL(fetch.mock.calls[0][0].url).pathname).toBe('/llms.txt');
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBe('Origin, Accept');
  }
  const fetch = mock(
    async (request: Request) =>
      new Response(request.url.endsWith('/llms.txt') ? 'missing' : 'HTML', {
        status: request.url.endsWith('/llms.txt') ? 404 : 200,
      })
  );
  const response = await worker.fetch(
    new Request('https://protopeek.shreyam1008.com.np/', { headers: { Accept: 'text/markdown' } }),
    { ASSETS: { fetch } }
  );
  expect(await response.text()).toBe('HTML');
  expect(response.headers.get('Vary')).toBe('Accept');
});

test('omits all six generated Debian copies, preserving source payloads, indexes and unrelated files', async () => {
  const root = await fixture();
  const source = path.join(root, 'web/site/public');
  const docs = path.join(root, 'docs');
  await fs.mkdir(path.join(source, pool), { recursive: true });
  const packages = ['0.6.1', '0.7.0'].flatMap((version) =>
    ['amd64', 'arm64', 'i386'].map((arch) => `protopeek_${version}_${arch}.deb`)
  );
  for (const filename of packages) await fs.writeFile(path.join(source, pool, filename), filename);
  await fs.truncate(path.join(source, pool, name), MAX_PAGES_ASSET_BYTES + 1);
  await fs.mkdir(path.join(source, 'apt/dists/stable'), { recursive: true });
  await fs.writeFile(path.join(source, 'apt/dists/stable/InRelease'), 'opaque signed bytes\n');
  await fs.writeFile(path.join(source, 'apt/key.gpg'), 'opaque public key\n');
  await fs.cp(source, docs, { recursive: true });
  await fs.writeFile(path.join(docs, pool, 'unrelated.deb'), 'retain');
  const hash = async (filename: string) =>
    createHash('sha256')
      .update(await fs.readFile(filename))
      .digest('hex');
  const before = await Promise.all(
    packages.map((filename) => hash(path.join(source, pool, filename)))
  );
  expect((await preparePagesAssets(docs)).removed).toEqual(
    packages.map((filename) => `${pool}/${filename}`).sort()
  );
  expect(
    await Promise.all(packages.map((filename) => hash(path.join(source, pool, filename))))
  ).toEqual(before);
  expect(await fs.readFile(path.join(docs, 'apt/dists/stable/InRelease'), 'utf8')).toBe(
    'opaque signed bytes\n'
  );
  expect(await fs.readFile(path.join(docs, 'apt/key.gpg'), 'utf8')).toBe('opaque public key\n');
  expect(await fs.readdir(path.join(docs, pool))).toEqual(['unrelated.deb']);
});

test('accepts the exact Pages boundary and fails any remaining oversized static asset', async () => {
  const docs = path.join(await fixture(), 'docs');
  const asset = path.join(docs, 'large.bin');
  await fs.writeFile(asset, '');
  await fs.truncate(asset, MAX_PAGES_ASSET_BYTES);
  await preparePagesAssets(docs);
  await fs.truncate(asset, MAX_PAGES_ASSET_BYTES + 1);
  await expect(preparePagesAssets(docs)).rejects.toThrow('exceeds 25 MiB');
});

test('refuses linked pool directories without deleting a package outside the generated pool', async () => {
  const root = await fixture();
  const external = path.join(root, 'source');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, name), 'preserve');
  await fs.mkdir(path.join(root, 'docs/apt'));
  await fs.symlink(external, path.join(root, 'docs/apt/pool'), 'junction');
  await expect(preparePagesAssets(path.join(root, 'docs'))).rejects.toThrow('must not be linked');
  expect(await fs.readFile(path.join(external, name), 'utf8')).toBe('preserve');
});

test('refuses a package-shaped directory and works in standalone Node without Bun globals', async () => {
  const root = await fixture();
  const docs = path.join(root, 'docs');
  await fs.mkdir(path.join(docs, pool, name), { recursive: true });
  await expect(preparePagesAssets(docs)).rejects.toThrow('regular file');
  await fs.rmdir(path.join(docs, pool, name));
  await fs.writeFile(path.join(docs, pool, name), 'generated copy');
  const helper = pathToFileURL(
    fileURLToPath(new URL('./prepare-pages-assets.mjs', import.meta.url))
  ).href;
  const result = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { preparePagesAssets } from ${JSON.stringify(helper)}; console.log(JSON.stringify(await preparePagesAssets(process.argv[1])));`,
      docs,
    ],
    { encoding: 'utf8', timeout: 10000 }
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).removed).toEqual([`${pool}/${name}`]);
});

test('checks APT lifecycle host, redirect and cleanup guards without installing on this host', () => {
  const filename = fileURLToPath(new URL('./verify-apt.test.py', import.meta.url));
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', filename], {
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('OK');
});
