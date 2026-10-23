import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_PAGES_ASSET_BYTES = 25 * 1024 * 1024;
const PACKAGE_NAME =
  /^protopeek_(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)_(amd64|arm64|i386)\.deb$/;
const PACKAGE_DIRECTORY = ['apt', 'pool', 'main', 'd', 'protopeek'];
const defaultOutput = fileURLToPath(new URL('../docs/', import.meta.url));

// Only generated Pages output is changed. Authoritative signed indexes and
// source packages remain in web/site/public/apt for signing and local installs.
export async function preparePagesAssets(outputDirectory = defaultOutput) {
  const outputStat = await fs.lstat(outputDirectory);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw new Error('Pages output must be a regular directory');
  }
  const output = await fs.realpath(outputDirectory);
  const removed = [];
  let packageDirectory = output;
  for (const segment of PACKAGE_DIRECTORY) {
    packageDirectory = path.join(packageDirectory, segment);
    let stat;
    try {
      stat = await fs.lstat(packageDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') {
        packageDirectory = null;
        break;
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`APT output directory must not be linked: ${packageDirectory}`);
    }
  }
  if (packageDirectory) {
    for (const name of await fs.readdir(packageDirectory)) {
      if (!PACKAGE_NAME.test(name)) continue;
      const filename = path.join(packageDirectory, name);
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`APT output package must be a regular file: ${filename}`);
      }
      await fs.unlink(filename);
      removed.push(path.relative(output, filename).split(path.sep).join('/'));
    }
  }
  async function verify(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) {
        throw new Error(`Pages asset must not be linked: ${filename}`);
      }
      if (stat.isDirectory()) {
        await verify(filename);
      } else if (!stat.isFile() || stat.size > MAX_PAGES_ASSET_BYTES) {
        throw new Error(`Pages asset exceeds 25 MiB or is not a regular file: ${filename}`);
      }
    }
  }
  await verify(output);
  return { removed: removed.sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparePagesAssets().then(
    ({ removed }) =>
      console.log(`Pages assets verified; ${removed.length} APT package copies omitted.`),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
