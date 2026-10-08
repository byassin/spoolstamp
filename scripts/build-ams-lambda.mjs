import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = new URL('../.aws-sam/ams/', import.meta.url);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./lambda-ams.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('lambda-ams.mjs', output)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  packages: 'bundle',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log(
  'Lambda backend built: .aws-sam/ams/lambda-ams.mjs (no source maps or credentials).',
);
