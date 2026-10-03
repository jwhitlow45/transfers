import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { type Plugin, defineConfig } from 'vite';

const outDir = join(import.meta.dirname, '..', 'dist');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact(), serviceWorker(), precompress()],
  build: { outDir, emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});

// Writes sw.js listing every built file, so the service worker caches the whole app on the
// first visit and later visits open with no network at all.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Files in public/ are copied as they are and never appear in the bundle.
      const publicFiles = readdirSync(join(import.meta.dirname, 'public'));
      const files = [...Object.keys(bundle), ...publicFiles].map((name) => `/${name}`);
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
