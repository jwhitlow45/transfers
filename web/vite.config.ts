import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { type Plugin, defineConfig } from 'vite';

const outDir = join(import.meta.dirname, '..', 'dist');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact(), buildStamp(), serviceWorker(), precompress()],
  build: { outDir, emptyOutDir: true, target: 'es2022' },
  // Tailnet names are allowed so a phone can reach the dev server through `tailscale serve`.
  // Short trip links go to the API, which opens them as the trip's own address (see Caddyfile).
  server: { proxy: { '/api': 'http://localhost:3000', '^/s/': 'http://localhost:3000' }, allowedHosts: ['.ts.net'] },
});

// Stamps the page with its build's id: a hash of every built file's name, which carry content
// hashes, and of the page itself, the public files, and the service worker's source, which do
// not. So it changes exactly when anything shipped does. The server sends the same id from its
// copy of the page, and a page with another asks the rider to refresh (see src/update.ts).
function buildStamp(): Plugin {
  return {
    name: 'build-stamp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return html;
        const hash = createHash('sha256');
        for (const name of Object.keys(bundle).filter((name) => !name.endsWith('.html') && name !== 'sw.js').sort()) hash.update(`${name}\n`);
        hash.update(html);
        const publicDir = join(import.meta.dirname, 'public');
        for (const name of readdirSync(publicDir).sort()) hash.update(`${name}\n`).update(readFileSync(join(publicDir, name)));
        hash.update(readFileSync(join(import.meta.dirname, 'src', 'sw.js')));
        const id = hash.digest('hex').slice(0, 12);
        return { html, tags: [{ tag: 'meta', attrs: { name: 'build', content: id }, injectTo: 'head' }] };
      },
    },
  };
}

// Writes sw.js listing the built files the app needs to open, so the service worker caches them
// on the first visit and later visits open with no network at all. Chunks loaded only on demand,
// such as the live map, stay out: the service worker caches each when it is first fetched.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
      const eager = new Set<string>();
      const reach = (fileName: string) => {
        if (eager.has(fileName)) return;
        eager.add(fileName);
        const chunk = bundle[fileName];
        if (chunk?.type === 'chunk') chunk.imports.forEach(reach);
      };
      chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => reach(chunk.fileName));
      const lazy = new Set(chunks.filter((chunk) => !eager.has(chunk.fileName)).flatMap((chunk) => [chunk.fileName, ...(chunk.viteMetadata?.importedCss ?? [])]));
      for (const fileName of eager) for (const css of (bundle[fileName] as { viteMetadata?: { importedCss: Set<string> } }).viteMetadata?.importedCss ?? []) lazy.delete(css);
      // Files in public/ are copied as they are and never appear in the bundle.
      const publicFiles = readdirSync(join(import.meta.dirname, 'public'));
      const files = [...Object.keys(bundle).filter((name) => !lazy.has(name)), ...publicFiles].map((name) => `/${name}`);
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(join(import.meta.dirname, 'src', 'sw.js'), 'utf8')
        .replaceAll('__VERSION__', version)
        .replaceAll('__FILES__', JSON.stringify(['/', ...files.filter((file) => file !== '/index.html')]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Brotli and gzip copies next to each file, which Caddy serves as they are, so nothing is
// compressed per request.
function precompress(): Plugin {
  return {
    name: 'precompress',
    apply: 'build',
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? walk(path) : [path];
        });
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json|webmanifest)$/.test(file) || statSync(file).size < 512) continue;
        const data = readFileSync(file);
        writeFileSync(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
      }
    },
  };
}
