import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
const script = fileURLToPath(
  new URL('../scripts/probe-cloud-ams.ts', import.meta.url),
);
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
describe('cloud probe consent and secret input boundary', () => {
  it('defaults to offline help instead of authenticating', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).not.toContain('Bambu account email:');
  });
  it('prints help without requiring a terminal or credentials', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('not the hosted feature');
    expect(result.stdout).toContain('--auth email|code|token');
    expect(result.stdout).toContain('it sends no new email');
  });
  it('refuses piped secret input rather than accepting it', () => {
    const result = run('--run');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid cloud connection input.');
    expect(result.stdout).not.toContain('Bambu account email:');
  });
  it('rejects credential arguments without echoing their value', () => {
    const result = run('--run', '--token', 'FAKE-SECRET-MUST-NOT-PRINT');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(
      'FAKE-SECRET-MUST-NOT-PRINT',
    );
  });
  it('rejects arbitrary API hosts without printing them', () => {
    const result = run('--run', '--region', 'https://attacker.example');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('attacker.example');
  });
});
