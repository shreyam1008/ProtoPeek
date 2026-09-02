import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export function sharedViteConfig() {
  return defineConfig({
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'remove-css-crossorigin',
        transformIndexHtml(html) {
          return html
            .replace(/\r\n?/g, '\n')
            .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  });
}
