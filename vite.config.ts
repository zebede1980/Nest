import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) })],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 3071,
    proxy: { '/api': 'http://127.0.0.1:3072', '/l/': 'http://127.0.0.1:3072' },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
