import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { prepareWinGet } from './prepare-winget';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'protopeek-winget-'));
  const tag = 'v2.3.4';
  const assets = [];
  const checksums = [];
  for (const architecture of ['x86_64', 'x86_32', 'arm64']) {
    const name = `protopeek_2.3.4_windows_${architecture}.zip`;
    const bytes = Buffer.from(`archive identity ${architecture}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(root, name), bytes);
    assets.push({
      name,
      browser_download_url: `https://github.com/shreyam1008/ProtoPeek/releases/download/${tag}/${name}`,
      size: bytes.length,
      digest: `sha256:${hash}`,
    });
    checksums.push(`${hash}  ${name}`);
  }
  const release = {
    tag_name: tag,
    html_url: `https://github.com/shreyam1008/ProtoPeek/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    published_at: '2026-10-22T12:00:00Z',
    assets,
  };
  const metadata = join(root, 'release.json');
  const checksum = join(root, 'checksums.txt');
  await writeFile(metadata, JSON.stringify(release));
  await writeFile(checksum, checksums.join('\n'));
  return {
    root,
    release,
    metadata,
    checksum,
    out: join(root, 'prepared'),
    cleanup: async () => {
      const target = resolve(root);
      if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture path');
      await rm(target, { recursive: true, force: true });
    },
  };
}

test('prepares all three Windows architectures from verified release identities', async () => {
  const data = await fixture();
  try {
    await prepareWinGet(data.metadata, data.checksum, data.root, data.out);
    const document = await readFile(
      join(data.out, 'ShreyamAdhikari.ProtoPeek.installer.yaml'),
      'utf8'
    );
    expect(document.split('\n')[0]).toBe(
      '# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json'
    );
    for (const [suffix, type] of [
      ['', 'version'],
      ['.locale.en-US', 'defaultLocale'],
    ]) {
      const yaml = await readFile(
        join(data.out, `ShreyamAdhikari.ProtoPeek${suffix}.yaml`),
        'utf8'
      );
      expect(yaml.split('\n')[0]).toBe(
        `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.12.0.schema.json`
      );
    }
    const result = JSON.parse(document.slice(document.indexOf('\n') + 1));
    expect(result).not.toHaveProperty('Scope');
    expect(result.PackageVersion).toBe('2.3.4');
    expect(result.Installers.map((item: { Architecture: string }) => item.Architecture)).toEqual([
      'x64',
      'x86',
      'arm64',
    ]);
    expect(
      result.Installers[0].NestedInstallerFiles.map(
        (item: { PortableCommandAlias: string }) => item.PortableCommandAlias
      )
    ).toEqual(['protopeek', 'pp']);
    await expect(
      prepareWinGet(data.metadata, data.checksum, data.root, data.out)
    ).rejects.toThrow();
  } finally {
    await data.cleanup();
  }
});
test.each([
  'hash',
  'authority',
  'draft',
  'prerelease',
  'missing',
  'duplicate',
  'version',
  'date',
  'oversized metadata',
  'oversized checksums',
  'archive size',
])('rejects %s before writing manifests', async (kind) => {
  const data = await fixture();
  try {
    if (kind === 'hash')
      await writeFile(data.checksum, `${'0'.repeat(64)}  ${data.release.assets[0].name}`);
    if (kind === 'authority')
      data.release.assets[0].browser_download_url = 'https://example.com/untrusted.zip';
    if (kind === 'draft') data.release.draft = true;
    if (kind === 'prerelease') data.release.prerelease = true;
    if (kind === 'missing') data.release.assets.pop();
    if (kind === 'duplicate') data.release.assets.push(data.release.assets[0]);
    if (kind === 'version') data.release.tag_name = 'latest';
    if (kind === 'date') data.release.published_at = '2026-02-30T12:00:00Z';
    if (kind === 'archive size') data.release.assets[0].size += 1;
    await writeFile(data.metadata, JSON.stringify(data.release));
    if (kind === 'oversized metadata') await writeFile(data.metadata, 'x'.repeat((1 << 20) + 1));
    if (kind === 'oversized checksums') await writeFile(data.checksum, 'x'.repeat((1 << 20) + 1));
    await expect(
      prepareWinGet(data.metadata, data.checksum, data.root, data.out)
    ).rejects.toThrow();
    await expect(readFile(join(data.out, 'ShreyamAdhikari.ProtoPeek.yaml'))).rejects.toThrow();
  } finally {
    await data.cleanup();
  }
});
