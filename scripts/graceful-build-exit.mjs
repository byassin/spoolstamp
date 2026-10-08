/** Only a build child process: let Windows drain native bundler handles on success.
 * Failures still force their original exit. Never treat a failed process as success.
 */
export function installGracefulBuildExit(target, platform) {
  if (platform !== 'win32') return;
  const forceExit = target.exit.bind(target);
  target.exit = (code) => {
    if (code === 0) {
      target.exitCode = 0;
      return;
    }
    return forceExit(code);
  };
}
