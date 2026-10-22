// Offline preparation only. This never uploads manifests or publishes a release.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const identifier = 'ShreyamAdhikari.ProtoPeek';
const manifestVersion = '1.12.0';
const repository = 'https://github.com/shreyam1008/ProtoPeek';
type ReleaseAsset = { name: string; browser_download_url: string; size: number; digest?: string };
type Release = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: ReleaseAsset[];
};

async function boundedText(path: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > 1 << 20) throw new Error('Release metadata exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function archiveHash(path: string, expectedSize: number) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > expectedSize) throw new Error('Release archive grew beyond its declared size');
    hash.update(chunk);
  }
  if (size !== expectedSize) throw new Error('Release archive size changed while hashing');
  return hash.digest('hex');
}

export async function prepareWinGet(
  releasePath: string,
  checksumPath: string,
  archivesPath: string,
  outputPath: string
) {
  const metadata = await boundedText(releasePath);
  const checksumText = await boundedText(checksumPath);
  const release = JSON.parse(metadata) as Release;
  if (
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.html_url !== `${repository}/releases/tag/${release.tag_name}` ||
    !Array.isArray(release.assets) ||
    release.assets.length > 256 ||
    typeof release.published_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(release.published_at) ||
    !Number.isFinite(Date.parse(release.published_at)) ||
    new Date(release.published_at).toISOString().slice(0, 10) !== release.published_at.slice(0, 10)
  )
    throw new Error('Use authoritative published stable GitHub release JSON');
  const version = release.tag_name.slice(1);
  const checksums = new Map<string, string>();
  for (const line of checksumText.split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-fA-F0-9]{64}) {2}([^/\\]+)$/.exec(line);
    if (!match || checksums.has(match[2])) throw new Error('Invalid or duplicate checksum entry');
    checksums.set(match[2], match[1].toLowerCase());
  }
  const installers = [];
  for (const [archiveArchitecture, architecture] of [
    ['x86_64', 'x64'],
    ['x86_32', 'x86'],
    ['arm64', 'arm64'],
  ] as const) {
    const name = `protopeek_${version}_windows_${archiveArchitecture}.zip`;
    const candidates = release.assets.filter((asset) => asset.name === name);
    if (candidates.length !== 1) throw new Error(`Expected one release asset ${name}`);
    const asset = candidates[0];
    const expectedURL = `${repository}/releases/download/${release.tag_name}/${name}`;
    if (
      asset.browser_download_url !== expectedURL ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > 256 << 20
    )
      throw new Error(`Invalid asset authority or size: ${name}`);
    const archive = join(resolve(archivesPath), name);
    const info = await stat(archive);
    if (!info.isFile() || info.size !== asset.size)
      throw new Error(`Release size mismatch: ${name}`);
    const digest = await archiveHash(archive, asset.size);
    if (checksums.get(name) !== digest || (asset.digest && asset.digest !== `sha256:${digest}`))
      throw new Error(`Release checksum mismatch: ${name}`);
    installers.push({
      Architecture: architecture,
      InstallerUrl: expectedURL,
      InstallerSha256: digest.toUpperCase(),
      NestedInstallerFiles: [
        { RelativeFilePath: 'protopeek.exe', PortableCommandAlias: 'protopeek' },
        { RelativeFilePath: 'pp.exe', PortableCommandAlias: 'pp' },
      ],
    });
  }
  // Create only after every artifact is verified, and never overwrite a prior preparation.
  const output = resolve(outputPath);
  await mkdir(output, { recursive: false });
  const common = { PackageIdentifier: identifier, PackageVersion: version };
  const documents = {
    [`${identifier}.yaml`]: {
      ...common,
      DefaultLocale: 'en-US',
      ManifestType: 'version',
      ManifestVersion: manifestVersion,
    },
    [`${identifier}.installer.yaml`]: {
      ...common,
      InstallerType: 'zip',
      NestedInstallerType: 'portable',
      UpgradeBehavior: 'install',
      Commands: ['protopeek', 'pp'],
      ReleaseDate: release.published_at.slice(0, 10),
      Installers: installers,
      ManifestType: 'installer',
      ManifestVersion: manifestVersion,
    },
    [`${identifier}.locale.en-US.yaml`]: {
      ...common,
      PackageLocale: 'en-US',
      Publisher: 'Shreyam Adhikari',
      PublisherUrl: 'https://shreyam1008.com.np/',
      PackageName: 'ProtoPeek',
      PackageUrl: repository,
      License: 'MIT; bundled aria2 companion GPL-2.0-or-later',
      LicenseUrl: `${repository}/blob/${release.tag_name}/LICENSE`,
      ShortDescription: 'Local workbench for APIs, network evidence, private access and downloads.',
      Moniker: 'protopeek',
      ReleaseNotesUrl: release.html_url,
      ManifestType: 'defaultLocale',
      ManifestVersion: manifestVersion,
    },
  };
  for (const [name, document] of Object.entries(documents)) {
    // JSON is a YAML 1.2 subset. Quoting every scalar avoids accidental YAML coercion.
    // WinGet infers a case-sensitive ManifestType from this header, including
    // the capital L in defaultLocale (even though the schema's $id is lowercase).
    const schema = `https://aka.ms/winget-manifest.${document.ManifestType}.${manifestVersion}.schema.json`;
    await writeFile(
      join(output, name),
      `# yaml-language-server: $schema=${schema}\n${JSON.stringify(document, null, 2)}\n`,
      { flag: 'wx' }
    );
  }
  return output;
}

if (import.meta.main) {
  const [release, checksums, archives, out] = process.argv.slice(2);
  if (!release || !checksums || !archives || !out)
    throw new Error(
      'Usage: bun scripts/prepare-winget.ts release.json checksums.txt archives-directory new-output-directory'
    );
  console.log(
    `Prepared verified manifests: ${await prepareWinGet(release, checksums, archives, out)}`
  );
  console.log(
    'Next: winget validate --manifest <directory>, native install/upgrade acceptance, then owner review and submission. Nothing was submitted.'
  );
}
