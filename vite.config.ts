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
    // The editor is genuinely large; splitting it out below is the answer, not silence
    // about the total. Raised just above the split vendor chunk so a real regression in
    // application code still trips the warning.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      input: {
        // The landing page. Static, no bundle, must stay instant.
        landing: resolve(root, 'index.html'),
        // The application shell, served at /app/.
        app: resolve(root, 'app/index.html'),
      },
      output: {
        // Vendor code changes on upgrades; ours changes daily. Separating them means a
        // returning reader re-downloads kilobytes rather than the whole editor.
        //
        // The list is exact rather than a prefix match on `@codemirror`, and that matters:
        // the language grammars also live under that scope, and sweeping them in here
        // would bundle every grammar eagerly — turning the lazy loading in
        // `ui/Reader/language.ts` into a 1.6MB download. Anything not named below is left
        // to Rollup, which splits dynamic imports into their own chunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';

          const core =
            /[\\/]@codemirror[\\/](state|view|language|language-data|commands|search|autocomplete|lint)[\\/]/;
          const lezerCore = /[\\/]@lezer[\\/](common|highlight|lr)[\\/]/;
          const support = /[\\/](codemirror|style-mod|w3c-keyname|crelt)[\\/]/;

          if (core.test(id) || lezerCore.test(id) || support.test(id)) return 'editor';
        },
      },
    },
  },
});
