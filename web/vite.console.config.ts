import path from 'node:path';
import { mergeConfig } from 'vite';

import { sharedViteConfig } from './vite.shared';

export default mergeConfig(sharedViteConfig(), {
  appType: 'spa',
  base: './',
  root: path.resolve(__dirname, 'console'),
  build: {
    emptyOutDir: true,
    outDir: path.resolve(__dirname, '..', 'internal', 'resources', 'app', 'dist'),
  },
});
