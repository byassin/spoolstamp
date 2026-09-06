import { randomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  AMS_PATH,
  AMS_HEADER,
  AMS_FRESH_MS,
  AMS_INITIAL_WAIT_MS,
  emptyAmsDiagnostics,
  object,
  parseAmsSnapshot,
  parsePrinterInfo,
  type AmsInventory,
} from '../lib/ams';
import { requestOrigin } from './local-studio-transfer';
import {
  lanAmsDriver,
  AmsSerialMismatch,
  type AmsConnection,
  type AmsDriver,
} from './ams-network';

class AmsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateAmsHost(value: unknown): string {
  if (typeof value !== 'string' || !isIPv4(value))
    throw new AmsError(
      400,
      'Enter the printer’s private IPv4 address, not a URL.',
    );
  const [a, b] = value.split('.').map(Number);
  if (
    !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
  )
    throw new AmsError(400, 'Only private LAN printer addresses are allowed.');
  return value;
}
function fields(value: unknown, allowed: string[]) {
  const input = object(value);
  if (!input || Object.keys(input).some((key) => !allowed.includes(key)))
    throw new AmsError(400, 'Invalid pairing request.');
  return input;
}
async function readJson(request: IncomingMessage) {
  if (request.headers['content-type'] !== 'application/json')
    throw new AmsError(415, 'Expected JSON.');
  return new Promise<unknown>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(
      () => finish(new AmsError(408, 'Pairing request timed out.')),
      5000,
    );
    function finish(error?: Error) {
      clearTimeout(timer);
      request.off('data', data);
      request.off('end', end);
      request.off('error', failed);
      request.off('aborted', failed);
      if (error) {
        request.resume();
        reject(error);
      } else {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new AmsError(400, 'Invalid pairing request.'));
        }
      }
    }
    function data(chunk: Buffer) {
      size += chunk.length;
      if (size > 2048) finish(new AmsError(413, 'Pairing request too large.'));
      else chunks.push(chunk);
    }
    function end() {
      finish();
    }
    function failed() {
      finish(new AmsError(400, 'Pairing request interrupted.'));
    }
    request.on('data', data);
    request.once('end', end);
    request.once('error', failed);
    request.once('aborted', failed);
  });
}

export function createLocalAms(
  driver: AmsDriver = lanAmsDriver,
  now = Date.now,
) {
  let inventory: AmsInventory = {
    available: true,
    connected: false,
    printerName: null,
    firmware: null,
    updatedAt: null,
    stale: true,
    slots: [],
    message: 'Not connected.',
    diagnostics: emptyAmsDiagnostics(),
  };
  let connection: AmsConnection | undefined;
  let probe:
    | { host: string; token: string; fingerprint: string; expiresAt: number }
    | undefined;
  let generation = 0,
    busy = false,
    lastAttempt = -Infinity,
    lastUse = now(),
    connectedAt = 0;
  function disconnect(
    message = 'Disconnected. Pairing credentials forgotten.',
  ) {
    generation++;
    probe = undefined;
    const old = connection;
    connection = undefined;
    inventory = {
      ...inventory,
      connected: false,
      stale: true,
      slots: [],
      updatedAt: null,
      message,
    };
    old?.close();
  }
  function prune() {
    if (probe && now() > probe.expiresAt) probe = undefined;
    if (
      connection &&
      (now() - lastUse > 60_000 || now() - connectedAt > 60 * 60_000)
    )
      disconnect('Session expired. Connect again.');
    if (
      connection &&
      inventory.updatedAt === null &&
      now() - connectedAt >= AMS_INITIAL_WAIT_MS
    ) {
      const diagnostics = inventory.diagnostics!;
      const reason = !diagnostics.messagesReceived
        ? 'No printer reports arrived within 60 seconds. Check the printer SN (not the AMS Hub SN), IP address and LAN access, then reconnect.'
        : diagnostics.incompleteAmsReports
          ? 'The printer replied, but its AMS reports were incomplete or unsupported. No spool assignments were inferred.'
          : diagnostics.reportsReceived
            ? 'The printer replied, but no complete AMS inventory was received. No spool assignments were inferred.'
            : 'Only retained or unreadable printer reports arrived. They cannot safely identify the currently loaded spools.';
      disconnect(reason);
    }
  }
  function status() {
    prune();
    return {
      ...inventory,
      stale:
        inventory.stale ||
        inventory.updatedAt === null ||
        now() - inventory.updatedAt >= AMS_FRESH_MS,
      message:
        inventory.connected &&
        inventory.updatedAt !== null &&
        now() - inventory.updatedAt >= AMS_FRESH_MS
          ? 'AMS data is out of date. Suggestions are paused until a fresh report arrives.'
          : inventory.message,
    };
  }
  async function command(action: string, value: unknown) {
    if (busy) throw new AmsError(409, 'A pairing attempt is already running.');
    if (connection)
      throw new AmsError(409, 'Disconnect before pairing another printer.');
    if (now() - lastAttempt < 2000)
      throw new AmsError(429, 'Wait a moment before trying again.');
    lastAttempt = now();
    busy = true;
    const revision = ++generation;
    try {
      if (action === 'probe') {
        const input = fields(value, ['host']);
        const host = validateAmsHost(input.host);
        probe = undefined;
        const fingerprint = await driver.probe(host);
        if (generation !== revision)
          throw new AmsError(409, 'Pairing cancelled.');
        probe = {
          host,
          fingerprint,
          token: Buffer.from(randomBytes(32)).toString('hex'),
          expiresAt: now() + 180_000,
        };
        return { token: probe.token, fingerprint, expiresAt: probe.expiresAt };
      }
      const input = fields(value, ['token', 'serial', 'accessCode']);
      const approved = probe;
      probe = undefined;
      if (
        !approved ||
        approved.expiresAt <= now() ||
        input.token !== approved.token
      )
        throw new AmsError(400, 'Verify the printer certificate again.');
      if (
        typeof input.serial !== 'string' ||
        !/^[A-Z0-9]{10,32}$/.test(input.serial) ||
        typeof input.accessCode !== 'string' ||
        !/^[A-Za-z0-9]{8}$/.test(input.accessCode)
      )
        throw new AmsError(
          400,
          'Enter the printer serial and its 8-character LAN access code.',
        );
      inventory = {
        available: true,
        connected: false,
        printerName: null,
        firmware: null,
        updatedAt: null,
        stale: true,
        slots: [],
        message: 'Waiting for a full AMS report.',
        diagnostics: emptyAmsDiagnostics(),
      };
      const next = await driver.connect({
        host: approved.host,
        fingerprint: approved.fingerprint,
        serial: input.serial,
        accessCode: input.accessCode,
        onDiagnostic(event) {
          if (generation !== revision) return;
          const key = {
            'request-sent': 'requestsSent',
            message: 'messagesReceived',
            retained: 'retainedMessages',
            invalid: 'invalidMessages',
          } as const;
          inventory.diagnostics![key[event]]++;
        },
        onReport(report) {
          if (generation !== revision) return;
          inventory.diagnostics!.reportsReceived++;
          const info = parsePrinterInfo(report);
          if (info) inventory = { ...inventory, ...info };
          const slots = parseAmsSnapshot(report);
          if (slots) {
            inventory.diagnostics!.fullSnapshots++;
            inventory = {
              ...inventory,
              slots,
              updatedAt: now(),
              stale: false,
              message: slots.length
                ? 'Reported AMS inventory. Confirm loaded spools before printing.'
                : 'No AMS slots reported. The manual picker is still available.',
            };
          } else if (object(object(report)?.print)?.ams) {
            inventory.diagnostics!.incompleteAmsReports++;
            inventory = {
              ...inventory,
              stale: true,
              message:
                'AMS changed or its report is incomplete. Waiting for a full refresh.',
            };
          }
        },
        onClose() {
          if (generation === revision)
            disconnect(
              'Printer connection closed. Check LAN access and connect again.',
            );
        },
      });
      // No credential object survives in service state or JSON responses.
      input.accessCode = '';
      if (generation !== revision) {
        next.close();
        throw new AmsError(409, 'Pairing cancelled.');
      }
      connection = next;
      connectedAt = now();
      inventory.connected = true;
      return status();
    } finally {
      busy = false;
    }
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const origin = requestOrigin(request);
      if (
        request.headers[AMS_HEADER.toLowerCase()] !== '1' ||
        (request.method !== 'GET' && request.headers.origin !== origin)
      )
        throw new AmsError(403, 'AMS access must come from this local app.');
      const path = new URL(request.url!, origin);
      if (path.search)
        throw new AmsError(400, 'Query parameters are not supported.');
      lastUse = now();
      let result: unknown;
      if (path.pathname === AMS_PATH && request.method === 'GET')
        result = status();
      else if (path.pathname === AMS_PATH && request.method === 'DELETE') {
        disconnect();
        result = status();
      } else if (
        request.method === 'POST' &&
        [AMS_PATH + '/probe', AMS_PATH + '/connect'].includes(path.pathname)
      ) {
        result = await command(
          path.pathname.endsWith('/probe') ? 'probe' : 'connect',
          await readJson(request),
        );
      } else throw new AmsError(404, 'Unknown AMS operation.');
      response.end(JSON.stringify(result));
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      // Never return socket errors, credentials, or raw printer reports.
      response.statusCode =
        error instanceof AmsError
          ? error.status
          : object(error)?.status === 403
            ? 403
            : 502;
      response.setHeader('Connection', 'close');
      response.end(
        JSON.stringify({
          error:
            error instanceof AmsError || error instanceof AmsSerialMismatch
              ? error.message
              : 'Could not connect securely. Check the printer address, LAN access and credentials. No printer settings were changed.',
        }),
      );
    }
  }
  return { handle, disconnect, prune };
}

export function localAms(): Plugin {
  return {
    name: 'local-ams',
    enforce: 'pre',
    apply: 'serve',
    configureServer(server) {
      const service = createLocalAms();
      const timer = setInterval(service.prune, 15_000);
      timer.unref();
      server.httpServer?.once('close', () => {
        clearInterval(timer);
        service.disconnect();
      });
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(AMS_PATH)) return next();
        void service.handle(request, response);
      });
    },
  };
}
