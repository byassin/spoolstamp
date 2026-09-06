import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('vinext')));
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, SPOOLSTAMP_BUILD_TARGET: 'static' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// Fail the deployment instead of uploading a successful SSR build without HTML.
const html = readFileSync(new URL('dist/client/index.html', root), 'utf8');
if (!html.includes('Spoolstamp') || !/<script\b[^>]*src=/.test(html)) {
  throw new Error('Static export is missing the Spoolstamp page or client scripts.');
}
console.log('Static site ready: dist/client/index.html');
