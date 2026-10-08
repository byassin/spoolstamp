import { describe, expect, it, vi } from 'vitest';
import { installGracefulBuildExit } from '../scripts/graceful-build-exit.mjs';

describe('Windows build shutdown', () => {
  it('lets only an explicit successful build exit drain naturally', () => {
    const forceExit = vi.fn();
    const target = { exit: forceExit, exitCode: undefined as number | undefined };
    installGracefulBuildExit(target, 'win32');
    target.exit(0);
    expect(target.exitCode).toBe(0);
    expect(forceExit).not.toHaveBeenCalled();
  });
  it('preserves failure exits even after a success request', () => {
    const forceExit = vi.fn();
    const target = { exit: forceExit, exitCode: undefined as number | undefined };
    installGracefulBuildExit(target, 'win32');
    target.exit(0); target.exit(1); target.exit(2);
    expect(forceExit.mock.calls).toEqual([[1], [2]]);
  });
  it('preserves an unspecified exit instead of guessing success', () => {
    const forceExit = vi.fn();
    const target = { exit: forceExit, exitCode: 1 };
    installGracefulBuildExit(target, 'win32');
    target.exit();
    expect(forceExit).toHaveBeenCalledOnce();
    expect(target.exitCode).toBe(1);
  });
  it('does not change Linux deployment behavior', () => {
    const forceExit = vi.fn(); const target = { exit: forceExit, exitCode: 1 };
    installGracefulBuildExit(target, 'linux');
    expect(target.exit).toBe(forceExit); target.exit(0);
    expect(forceExit).toHaveBeenCalledWith(0);
    expect(target.exitCode).toBe(1);
  });
});
