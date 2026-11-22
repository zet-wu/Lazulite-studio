import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outfile = resolve(root, 'dist/server.mjs');
mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  minify: false,
  sourcemap: false,
});

console.log(`Built ${outfile}`);
