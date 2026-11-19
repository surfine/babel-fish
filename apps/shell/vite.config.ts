import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { i18n } from './scripts/i18n-plugin';

export default defineConfig({
  plugins: [svelte(), i18n()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test-setup.ts'] },
});
