import fs from 'node:fs/promises';
import path from 'node:path';

import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App } from '../web/src/site/App';

const outputPath = path.resolve(import.meta.dir, '..', 'docs', 'index.html');
const emptyRoot = '<div id="root"></div>';
const html = await fs.readFile(outputPath, 'utf8');
const rootCount = html.split(emptyRoot).length - 1;

if (rootCount !== 1) {
  throw new Error(`Expected one empty ProtoPeek site root, found ${rootCount}.`);
}

const app = renderToString(
  <StrictMode>
    <App />
  </StrictMode>
);

await fs.writeFile(outputPath, html.replace(emptyRoot, `<div id="root">${app}</div>`));
