import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import JSZip from 'jszip';
import {
  STUDIO_TRANSFER_HEADER,
  STUDIO_TRANSFER_MAX_BYTES,
  STUDIO_TRANSFER_PATH,
  STUDIO_TRANSFER_TTL_MS,
  STUDIO_LOOPBACK_HOST,
} from '../lib/studio-handoff.ts';

const MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const MAX_TRANSFERS = 3;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

class TransferError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requestOrigin(request: IncomingMessage) {
  const host = request.headers.host;
  if (
    !LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '') ||
    !host ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host) ||
    [
      'forwarded',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
    ].some((header) => request.headers[header])
  )
    throw new TransferError(
      403,
      'Local transfers require a direct loopback connection.',
    );
  const secure = (
    request.socket as typeof request.socket & { encrypted?: boolean }
  ).encrypted;
  const origin = new URL(`${secure ? 'https' : 'http'}://${host}`);
  if (Number(origin.port || (secure ? 443 : 80)) !== request.socket.localPort)
    throw new TransferError(403, 'Invalid local transfer host.');
  if (
    (request.headers.origin && request.headers.origin !== origin.origin) ||
    (request.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(
        String(request.headers['sec-fetch-site']),
      ))
  )
    throw new TransferError(
      403,
      'Cross-origin local transfers are not allowed.',
    );
  return origin.origin;
}

function requireBrowserWrite(request: IncomingMessage, origin: string) {
  if (
    request.headers.origin !== origin ||
    request.headers[STUDIO_TRANSFER_HEADER.toLowerCase()] !== '1'
  )
    throw new TransferError(
      403,
      'Local transfers must be requested by this app.',
    );
}

async function readModel(request: IncomingMessage, uploadDeadlineMs: number) {
  if (request.headers['content-type'] !== 'application/octet-stream')
    throw new TransferError(415, 'Expected a binary 3MF file.');
  const length = request.headers['content-length'];
  if (
    length &&
    (!/^\d+$/.test(length) || Number(length) > STUDIO_TRANSFER_MAX_BYTES)
  )
    throw new TransferError(
      413,
      'This model is too large. Download the 3MF instead.',
    );
  const chunks: Buffer[] = [];
  let size = 0;
  // Drain oversized chunked bodies without retaining them. Exiting a Readable
  // async iterator early destroys its socket before we can send a useful 413.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      request.off('error', failed);
      if (error) reject(error);
      else resolve();
    };
    const data = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > STUDIO_TRANSFER_MAX_BYTES) chunks.length = 0;
      else chunks.push(bytes);
    };
    const end = () =>
      finish(
        size > STUDIO_TRANSFER_MAX_BYTES
          ? new TransferError(
              413,
              'This model is too large. Download the 3MF instead.',
            )
          : undefined,
      );
    const aborted = () =>
      finish(new TransferError(400, 'The local transfer was interrupted.'));
    const failed = () =>
      finish(new TransferError(400, 'The local transfer was interrupted.'));
    // Absolute deadline: a slow trickle must not hold the receiving slot open.
    const deadline = setTimeout(
      () =>
        finish(new TransferError(408, 'Local transfer timed out. Try again.')),
      uploadDeadlineMs,
    );
    request.on('data', data);
    request.once('end', end);
    request.once('aborted', aborted);
    request.once('error', failed);
  });
  const bytes = Buffer.concat(chunks);
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (
      !zip.file('[Content_Types].xml') ||
      !zip.file('_rels/.rels') ||
      !zip.file('3D/3dmodel.model')
    )
      throw new Error('Missing 3MF parts');
  } catch {
    throw new TransferError(400, 'The transfer is not a valid 3MF package.');
  }
  return bytes;
}

/** Memory-only, token-addressed staging; it never writes files or launches apps. */
export function createLocalStudioTransfer(
  now = Date.now,
  uploadDeadlineMs = 30_000,
) {
  const files = new Map<
    string,
    { bytes: Buffer; filename: string; expiresAt: number }
  >();
  let receiving = false;
  const prune = () => {
    for (const [path, file] of files)
      if (file.expiresAt <= now()) files.delete(path);
  };
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const origin = requestOrigin(request);
      const url = new URL(request.url ?? '/', origin);
      if (url.origin !== origin || url.search)
        throw new TransferError(400, 'Invalid transfer URL.');
      prune();
      if (url.pathname === STUDIO_TRANSFER_PATH) {
        if (request.method === 'GET' || request.method === 'HEAD') {
          json(response, 200, {
            available: true,
            expiresInMs: STUDIO_TRANSFER_TTL_MS,
          });
          return;
        }
        if (request.method !== 'POST')
          throw new TransferError(405, 'Method not allowed.');
        requireBrowserWrite(request, origin);
        const filename = request.headers['x-filename'];
        if (
          typeof filename !== 'string' ||
          !/^[a-z0-9][a-z0-9_-]{0,119}\.3mf$/.test(filename)
        )
          throw new TransferError(400, 'Invalid 3MF filename.');
        if (receiving)
          throw new TransferError(
            429,
            'A local transfer is already being prepared. Try again shortly.',
          );
        receiving = true;
        try {
          const bytes = await readModel(request, uploadDeadlineMs);
          prune();
          let retained = [...files.values()].reduce(
            (sum, file) => sum + file.bytes.length,
            0,
          );
          while (
            files.size &&
            (files.size >= MAX_TRANSFERS ||
              retained + bytes.length > MAX_RETAINED_BYTES)
          ) {
            const oldest = files.keys().next().value!;
            retained -= files.get(oldest)!.bytes.length;
            files.delete(oldest);
          }
          const token = Array.from(randomBytes(32), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          const path = `${STUDIO_TRANSFER_PATH}/files/${token}/${filename}`;
          const expiresAt = now() + STUDIO_TRANSFER_TTL_MS;
          files.set(path, { bytes, filename, expiresAt });
          json(response, 201, { path, filename, expiresAt });
        } finally {
          receiving = false;
        }
        return;
      }
      if (
        !/^\/api\/local-studio\/files\/[a-f0-9]{64}\/[a-z0-9][a-z0-9_-]{0,119}\.3mf$/.test(
          url.pathname,
        )
      )
        throw new TransferError(404, 'Local transfer not found.');
      if (request.method === 'DELETE') {
        requireBrowserWrite(request, origin);
        files.delete(url.pathname);
        response.writeHead(204);
        response.end();
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method ?? ''))
        throw new TransferError(405, 'Method not allowed.');
      const file = files.get(url.pathname);
      if (!file)
        throw new TransferError(
          404,
          'The local transfer expired. Prepare the label again.',
        );
      // Studio may retry: neither HEAD nor GET consumes the transfer token.
      response.writeHead(200, {
        'Content-Type': 'model/3mf',
        'Content-Length': file.bytes.length,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Security-Policy': "default-src 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : file.bytes);
    } catch (cause) {
      if (response.destroyed || response.headersSent) return;
      if (!request.complete) {
        request.resume();
        if (cause instanceof TransferError && cause.status === 408)
          response.setHeader('Connection', 'close');
      }
      json(response, cause instanceof TransferError ? cause.status : 500, {
        error:
          cause instanceof TransferError
            ? cause.message
            : 'Local transfer failed. Download the 3MF instead.',
      });
    }
  };
  return { handle, prune, clear: () => files.clear() };
}

export function localStudioTransfer(): Plugin {
  return {
    name: 'local-studio-transfer',
    enforce: 'pre',
    apply: 'serve',
    config() {
      // Keep the app private to this computer, but reachable by Studio's
      // IPv4-only HTTP client. Vite otherwise resolves localhost to ::1 here.
      return { server: { host: STUDIO_LOOPBACK_HOST } };
    },
    configureServer(server) {
      const transfer = createLocalStudioTransfer();
      const timer = setInterval(transfer.prune, 30_000);
      timer.unref();
      server.httpServer?.once('close', () => {
        clearInterval(timer);
        transfer.clear();
      });
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(STUDIO_TRANSFER_PATH)) return next();
        void transfer.handle(request, response);
      });
    },
  };
}
