// Build-time source companion; never called by the application or installer.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import manifest from './aria2-source-manifest.json';

const directory = resolve(process.argv[2] || '.local/aria2-sources');
await mkdir(directory, { recursive: true });
for (const source of manifest) {
  const path = join(directory, source.name);
  let data: Uint8Array | undefined;
  try { data = await readFile(path); } catch { /* Fetch a missing source. */ }
  if (!data) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
    const parts: Uint8Array[] = [];
    let length = 0;
    if (!response.body) throw new Error(`${source.name}: empty response`);
    for await (const part of response.body) {
      length += part.length;
      if (length > 32 * 1024 * 1024) throw new Error(`${source.name}: source exceeds 32 MiB`);
      parts.push(part);
    }
    data = Buffer.concat(parts);
  }
  if (createHash('sha256').update(data).digest('hex') !== source.sha256) {
    throw new Error(`${source.name}: checksum mismatch; source package not ready`);
  }
  await writeFile(path, data);
  console.log(`Verified ${source.name}`);
}
for (const name of ['COPYING', 'AUTHORS', 'README.mingw', 'LICENSE.OpenSSL', 'Dockerfile.mingw']) {
  await copyFile(resolve('internal/bundledaria2/notices', name), join(directory, name));
}
await copyFile(resolve('internal/bundledaria2/README.md'), join(directory, 'README.md'));
await writeFile(join(directory, 'SOURCES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
