import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Pages needs two files that Vite has no reason to emit on its own.
 *
 * CNAME is read from the repo root rather than `public/` on purpose: the live site is
 * still served by the legacy root-directory Pages build, and moving CNAME out of the
 * root would drop the custom domain before the Actions deploy replaces it.
 *
 * 404.html is a copy of the app shell so that deep links into /app survive a refresh.
 */
function pagesFiles(): Plugin {
  return {
    name: 'annotatecode:pages-files',
    apply: 'build',
    closeBundle() {
      const dist = resolve(root, 'dist');

      const cname = resolve(root, 'CNAME');
      if (existsSync(cname)) copyFileSync(cname, resolve(dist, 'CNAME'));

      const shell = resolve(dist, 'app/index.html');
      if (existsSync(shell)) copyFileSync(shell, resolve(dist, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), pagesFiles()],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    rollupOptions: {
      input: {
        // The landing page. Static, no bundle, must stay instant.
        landing: resolve(root, 'index.html'),
        // The application shell, served at /app/.
        app: resolve(root, 'app/index.html'),
      },
    },
  },
});
