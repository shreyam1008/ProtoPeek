import path from 'node:path';
import { mergeConfig } from 'vite';

import {
  consolePreloadDependencies,
  isConsoleCoreModule,
  isSharedLucideIconModule,
} from './vite.console-chunks';
import { sharedViteConfig } from './vite.shared';

export default mergeConfig(sharedViteConfig(), {
  appType: 'spa',
  base: './',
  root: path.resolve(__dirname, 'console'),
  build: {
    emptyOutDir: true,
    // Supported desktop browsers preload modules natively. Keep the preload hints, but do not
    // ship Vite's compatibility runtime on every start.
    modulePreload: {
      polyfill: false,
      resolveDependencies: consolePreloadDependencies,
    },
    outDir: path.resolve(__dirname, '..', 'internal', 'resources', 'app', 'dist'),
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'console-core',
              test: isConsoleCoreModule,
              priority: 2,
            },
            {
              name: 'console-icons',
              test: isSharedLucideIconModule,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});
