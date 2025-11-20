import { defineConfig } from 'vite';
import path, { resolve } from 'path';
import { globSync } from 'fs';
import { fileURLToPath } from 'url';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        globSync('*.html').map((file) => [
          file.slice(0, file.length - path.extname(file).length),
          fileURLToPath(new URL(file, import.meta.url)),
        ])
      ),
    },
  },

  server: {
    proxy: {
      '/api': 'http://localhost',
    },
    middlewareMode: false,
  },

  optimizeDeps: {
    exclude: ['models'],
  },
});
