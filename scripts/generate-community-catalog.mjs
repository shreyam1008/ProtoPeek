import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('internal/communitytools/catalog.json', 'utf8'));
if (!Array.isArray(source)) throw new Error('Community catalog must be an array.');

const metadata = source.map(({ id, name, group, description, license, source: project }) => {
  if ([id, name, group, description, license, project].some((value) => typeof value !== 'string')) {
    throw new Error('Community catalog metadata must contain text fields.');
  }
  return { id, name, group, description, license, source: project };
});
const target = 'web/src/console/community-catalog.json';
const output = `${JSON.stringify(metadata, null, 2)}\n`;
let existing = '';
try {
  existing = readFileSync(target, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (existing !== output) writeFileSync(target, output);
