import { fileURLToPath } from 'node:url';
import { installGracefulBuildExit } from './graceful-build-exit.mjs';

// Vinext beta.9 forces process.exit(0) while Windows native handles are closing.
// The isolated launcher lets a successful build finish naturally. A subsequent
// exception, failed CLI exit, native crash or timeout still fails the parent.
installGracefulBuildExit(process, process.platform);
const cli = new URL('./cli.js', import.meta.resolve('vinext'));
process.argv = [process.execPath, fileURLToPath(cli), 'build'];
await import(cli.href);
