// Build-time source companion; never called by the application or installer.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import manifest from './aria2-source-manifest.json';
import { fetchSourceArchive } from './fetch-source-archive';

const directory = resolve(process.argv[2] || '.local/aria2-sources');
await mkdir(directory, { recursive: true });
for (const source of manifest) {
  const path = join(directory, source.name);
  let data: Uint8Array | undefined;
  try { data = await readFile(path); } catch { /* Fetch a missing source. */ }
  if (!data) {
    data = await fetchSourceArchive(source.url);
  }
  const actualHash = createHash('sha256').update(data).digest('hex');
  if (actualHash !== source.sha256) {
    throw new Error(`${source.name}: checksum mismatch; expected ${source.sha256}, received ${actualHash}`);
  }
  await writeFile(path, data);
  console.log(`Verified ${source.name}`);
}
for (const name of ['COPYING', 'AUTHORS', 'README.mingw', 'LICENSE.OpenSSL', 'Dockerfile.mingw']) {
  await copyFile(resolve('internal/bundledaria2/notices', name), join(directory, name));
}
await copyFile(resolve('internal/bundledaria2/README.md'), join(directory, 'README.md'));
await writeFile(join(directory, 'SOURCES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
