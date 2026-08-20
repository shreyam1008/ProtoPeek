import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [path.resolve(__dirname, 'src/**/*.test.{ts,tsx}')],
    setupFiles: [path.resolve(__dirname, 'src', 'test', 'setup.ts')],
  },
});
