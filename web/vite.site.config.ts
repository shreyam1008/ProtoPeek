import path from 'node:path';
import { mergeConfig } from 'vite';

import { sharedViteConfig } from './vite.shared';

export default mergeConfig(sharedViteConfig(), {
  appType: 'spa',
  base: '/ProtoPeek/',
  root: path.resolve(__dirname, 'site'),
  build: {
    emptyOutDir: true,
    outDir: path.resolve(__dirname, '..', 'docs'),
  },
});
