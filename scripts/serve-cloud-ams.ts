import { createServer } from 'node:http';
import { createHostedAmsService } from './hosted-ams.ts';

// Explicit opt-in; this command never sends email or contacts a printer by itself.
if (process.env.SPOOLSTAMP_AMS_ENABLE !== 'experimental') {
  console.error(
    'Cloud preview is disabled. Read docs/hosted-cloud-ams.md before opting in.',
  );
  process.exitCode = 1;
} else {
  const development = process.env.SPOOLSTAMP_AMS_DEV === '1';
  const port = Number(process.env.PORT ?? 3100);
  const origin = process.env.SPOOLSTAMP_AMS_APP_ORIGIN ?? '';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !origin)
    throw new Error('Set SPOOLSTAMP_AMS_APP_ORIGIN and a valid PORT.');
  const service = createHostedAmsService({
    appOrigin: origin,
    secureCookies: !development,
  });
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 10_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5000,
    },
    (req, res) => {
      void service.handle(req, res);
    },
  );
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  server.listen(port, development ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(
      `Experimental AMS backend listening on port ${port}. Sessions are temporary; no provider payloads are logged.`,
    );
  });
  function shutdown() {
    service.close();
    server.close();
    server.closeAllConnections();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
