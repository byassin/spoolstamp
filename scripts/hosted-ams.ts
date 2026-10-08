import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AMS_FRESH_MS, type AmsInventory } from '../lib/ams.ts';
import type { HostedCloudState, HostedCloudPrinter } from '../lib/cloud-ams.ts';
import { createCloudAmsSession, CloudAmsError } from './cloud-ams.ts';
import { cloudDisplayText } from './cloud-ams-errors.ts';

const SESSION_MS = 30 * 60_000;
const CODE_MS = 10 * 60_000;
const REFRESH_MS = 5 * 60_000;
const cookiePattern = /^[a-f0-9]{64}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Provider = Pick<
  ReturnType<typeof createCloudAmsSession>,
  'requestEmailCode' | 'loginWithEmailCode' | 'printers' | 'snapshot' | 'close'
>;
type Session = {
  key: string;
  csrf: string;
  expiresAt: number;
  provider: Provider;
  authenticated: boolean;
  challenge: { email: string; expiresAt: number } | null;
  account: string;
  printers: HostedCloudPrinter[];
  selectedSerial: string | null;
  pending: boolean;
  busy: boolean;
  refreshAfter: number;
  inventory: AmsInventory;
  controller?: AbortController;
};
class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const emptyInventory = (): AmsInventory => ({
  available: true,
  connected: false,
  printerName: null,
  firmware: null,
  updatedAt: null,
  stale: true,
  slots: [],
  message: 'Sign in to read your AMS.',
});
const nonce = () => Buffer.from(randomBytes(32)).toString('hex');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string) =>
  cookiePattern.test(left) &&
  cookiePattern.test(right) &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

/** Single-process preview service. No session/token persistence or payload logging. */
export function createHostedAmsService(options: {
  appOrigin: string;
  secureCookies: boolean;
  provider?: () => Provider;
  now?: () => number;
}) {
  const origin = new URL(options.appOrigin);
  if (
    origin.origin !== options.appOrigin ||
    origin.username ||
    origin.password ||
    (options.secureCookies
      ? origin.protocol !== 'https:'
      : !['http:', 'https:'].includes(origin.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
  )
    throw new Error(
      'Configure one HTTPS application origin (or explicit loopback development).',
    );
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const limits = new Map<string, { count: number; until: number }>();
  const accountSalt = nonce();
  const accountKey = (email: string) =>
    digest(accountSalt + email.toLowerCase());
  const cookieName = options.secureCookies
    ? '__Host-spoolstamp-cloud'
    : 'spoolstamp-cloud-dev';
  let activeReads = 0;
  let closed = false;
  const alive = (session: Session) =>
    !closed &&
    sessions.get(session.key) === session &&
    session.expiresAt > now();
  function drop(session: Session) {
    sessions.delete(session.key);
    session.controller?.abort();
    session.provider.close();
    session.challenge = null;
    session.account = '';
    session.printers = [];
    session.inventory = emptyInventory();
  }
  function sweep() {
    for (const session of sessions.values()) if (!alive(session)) drop(session);
    for (const [key, limit] of limits)
      if (limit.until <= now()) limits.delete(key);
  }
  const timer = setInterval(sweep, 30_000);
  timer.unref();
  function rate(key: string, maximum: number, windowMs: number) {
    const old = limits.get(key);
    const limit =
      old && old.until > now() ? old : { count: 0, until: now() + windowMs };
    if (!old && limits.size >= 2048)
      throw new RequestError(503, 'Cloud service is busy. Try later.');
    limits.set(key, limit);
    if (++limit.count > maximum)
      throw new RequestError(429, 'Too many requests. Try later.');
  }
  function state(session: Session): HostedCloudState {
    const stale =
      !session.inventory.updatedAt ||
      now() - session.inventory.updatedAt >= AMS_FRESH_MS;
    return {
      csrf: session.csrf,
      authenticated: session.authenticated,
      codeRequested: !!session.challenge && session.challenge.expiresAt > now(),
      expiresAt: session.expiresAt,
      printers: session.printers,
      selectedSerial: session.selectedSerial,
      pending: session.pending,
      refreshAfter: session.refreshAfter,
      inventory: {
        ...session.inventory,
        stale,
        message:
          stale && session.inventory.updatedAt
            ? 'Cloud snapshot is stale. Wait for the refresh cooldown, then read again.'
            : session.inventory.message,
      },
    };
  }
  function cookie(res: ServerResponse, raw: string, maxAge: number) {
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies ? '; Secure' : ''}`,
    );
  }
  function reply(res: ServerResponse, status: number, value: unknown) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(value));
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (
      req.headers['content-type'] !== 'application/json' ||
      req.headers['content-encoding'] ||
      Number(req.headers['content-length'] ?? 0) > 2048
    )
      throw new RequestError(400, 'Invalid request.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2048) throw new RequestError(413, 'Request too large.');
      chunks.push(Buffer.from(chunk));
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || Array.isArray(result) || typeof result !== 'object')
        throw new Error();
      return result;
    } catch {
      throw new RequestError(400, 'Invalid request.');
    }
  }
  function keys(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new RequestError(400, 'Invalid request.');
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Vary', 'Origin');
    try {
      if (closed) throw new RequestError(503, 'Cloud service is unavailable.');
      if (req.url === '/healthz' && req.method === 'GET') {
        reply(res, 200, { ok: true });
        return;
      }
      if (req.headers.origin !== options.appOrigin)
        throw new RequestError(403, 'Application origin not allowed.');
      res.setHeader('Access-Control-Allow-Origin', options.appOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        if (
          req.headers['access-control-request-method'] &&
          !['GET', 'POST', 'DELETE'].includes(
            req.headers['access-control-request-method'],
          )
        )
          throw new RequestError(403, 'Method not allowed.');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, X-Spoolstamp-CSRF',
        );
        res.writeHead(204);
        res.end();
        return;
      }
      if (
        !['/session', '/email-code', '/login', '/snapshot'].includes(
          req.url ?? '',
        )
      )
        throw new RequestError(404, 'Not found.');
      if (
        req.url === '/session'
          ? !['GET', 'DELETE'].includes(req.method ?? '')
          : req.method !== 'POST'
      )
        throw new RequestError(405, 'Method not allowed.');
      sweep();
      // Deliberately do NOT trust arbitrary X-Forwarded-For. Edge/proxy must enforce
      // per-client abuse controls; this peer limit is an additional fail-safe.
      const peer = req.socket.remoteAddress ?? 'unknown';
      rate(`http:${peer}`, 1500, 60_000);
      const values = (req.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${cookieName}=`));
      const raw =
        values.length === 1 ? values[0].slice(cookieName.length + 1) : '';
      let session = cookiePattern.test(raw)
        ? sessions.get(digest(raw))
        : undefined;
      if (!session && req.url === '/session' && req.method === 'GET') {
        rate(`new:${peer}`, 30, 60 * 60_000);
        if (sessions.size >= 128)
          throw new RequestError(503, 'Cloud service is busy. Try later.');
        const created = nonce();
        session = {
          key: digest(created),
          csrf: nonce(),
          expiresAt: now() + SESSION_MS,
          provider: options.provider?.() ?? createCloudAmsSession('global'),
          authenticated: false,
          challenge: null,
          account: '',
          printers: [],
          selectedSerial: null,
          pending: false,
          busy: false,
          refreshAfter: 0,
          inventory: emptyInventory(),
        };
        sessions.set(session.key, session);
        cookie(res, created, SESSION_MS / 1000);
      }
      if (!session || !alive(session))
        throw new RequestError(401, 'Session expired. Sign in again.');
      if (req.method === 'GET') {
        reply(res, 200, state(session));
        return;
      }
      const csrf = req.headers['x-spoolstamp-csrf'];
      if (typeof csrf !== 'string' || !equal(csrf, session.csrf))
        throw new RequestError(
          403,
          'Session check failed. Reload and try again.',
        );
      if (req.method === 'DELETE') {
        drop(session);
        cookie(res, '', 0);
        reply(res, 200, { loggedOut: true });
        return;
      }
      const input = await body(req);
      if (!alive(session))
        throw new RequestError(401, 'Session expired. Sign in again.');
      if (session.busy)
        throw new RequestError(409, 'Another request is in progress.');
      const current = session;
      if (req.url === '/email-code') {
        keys(input, ['email', 'consent']);
        if (
          current.authenticated ||
          input.consent !== true ||
          typeof input.email !== 'string' ||
          input.email.length > 254 ||
          cloudDisplayText(input.email, 254) !== input.email ||
          !emailPattern.test(input.email)
        )
          throw new RequestError(
            400,
            'Enter a valid email and accept the experimental connection notice.',
          );
        const email = input.email.trim();
        const account = accountKey(email);
        rate(`send-peer:${peer}`, 5, 60 * 60_000);
        rate(`send:${account}`, 1, REFRESH_MS);
        current.busy = true;
        current.challenge = null;
        try {
          await current.provider.requestEmailCode(email);
          if (!alive(current))
            throw new RequestError(401, 'Session expired. Sign in again.');
          current.challenge = { email, expiresAt: now() + CODE_MS };
          current.account = account;
          reply(res, 200, state(current));
        } finally {
          current.busy = false;
        }
        return;
      }
      if (req.url === '/login') {
        keys(input, ['code']);
        if (
          current.authenticated ||
          !current.challenge ||
          current.challenge.expiresAt <= now() ||
          typeof input.code !== 'string' ||
          !/^\d{6}$/.test(input.code)
        )
          throw new RequestError(
            400,
            'Request a fresh email code, then enter its six digits.',
          );
        rate(`login-peer:${peer}`, 20, 30 * 60_000);
        rate(`login:${current.account}`, 5, 30 * 60_000);
        current.busy = true;
        try {
          await current.provider.loginWithEmailCode(
            current.challenge.email,
            input.code,
          );
          // Clear challenge immediately. A failed device listing must not retain a token.
          current.challenge = null;
          if (!alive(current))
            throw new RequestError(401, 'Session expired. Sign in again.');
          const printers = await current.provider.printers();
          if (!alive(current))
            throw new RequestError(401, 'Session expired. Sign in again.');
          current.printers = printers.map(
            ({ serial, name, model, online }) => ({
              serial,
              name,
              model,
              online,
            }),
          );
          current.authenticated = true;
          // Rotate cookie and CSRF after authentication. Never return the cookie value.
          sessions.delete(current.key);
          const rotated = nonce();
          current.key = digest(rotated);
          current.csrf = nonce();
          sessions.set(current.key, current);
          cookie(
            res,
            rotated,
            Math.max(0, Math.floor((current.expiresAt - now()) / 1000)),
          );
          reply(res, 200, state(current));
        } catch (error) {
          current.provider.close();
          throw error;
        } finally {
          current.busy = false;
        }
        return;
      }
      keys(input, ['serial']);
      if (!current.authenticated) throw new RequestError(401, 'Sign in first.');
      if (
        typeof input.serial !== 'string' ||
        !/^[A-Z0-9]{10,32}$/.test(input.serial)
      )
        throw new RequestError(400, 'Choose a printer from your account.');
      const printer = current.printers.find(
        (item) => item.serial === input.serial,
      );
      if (!printer)
        throw new RequestError(403, 'This printer is not in your account.');
      if (current.pending)
        throw new RequestError(409, 'An AMS read is already in progress.');
      const readKey = `read:${current.account}:${printer.serial}`;
      const previous = limits.get(readKey);
      if (previous && previous.until > now())
        throw new RequestError(
          429,
          'Wait five minutes between status requests to this printer.',
        );
      if (activeReads >= 8)
        throw new RequestError(503, 'Cloud service is busy. Try later.');
      rate(readKey, 1, REFRESH_MS);
      current.selectedSerial = printer.serial;
      current.refreshAfter = now() + REFRESH_MS;
      current.pending = true;
      current.controller = new AbortController();
      current.inventory = {
        ...emptyInventory(),
        connected: true,
        printerName: printer.name,
        message: 'Waiting up to 60 seconds for a fresh cloud AMS snapshot…',
      };
      activeReads++;
      // Poll /session for completion; no 60-second browser/proxy HTTP request.
      const signal = AbortSignal.any([
        current.controller.signal,
        AbortSignal.timeout(60_000),
      ]);
      void Promise.resolve()
        .then(() => {
          if (!alive(current)) throw new CloudAmsError('cancelled');
          return current.provider.snapshot(printer.serial, {
            signal,
            timeoutMs: 60_000,
          });
        })
        .then((snapshot) => {
          if (!alive(current)) return;
          current.inventory = {
            ...current.inventory,
            updatedAt: snapshot.updatedAt,
            slots: snapshot.slots,
            message:
              'Fresh cloud snapshot. Confirm loaded spools before printing.',
          };
        })
        .catch((error) => {
          if (!alive(current)) return;
          current.inventory = {
            ...current.inventory,
            slots: [],
            updatedAt: null,
            message:
              signal.reason instanceof DOMException &&
              signal.reason.name === 'TimeoutError'
                ? new CloudAmsError('timeout').message
                : error instanceof CloudAmsError
                  ? error.message
                  : 'Cloud AMS read failed. Try later.',
          };
          if (
            error instanceof CloudAmsError &&
            ['authentication', 'blocked', 'ownership'].includes(error.code)
          ) {
            current.provider.close();
            current.authenticated = false;
            current.printers = [];
            current.inventory.connected = false;
          }
        })
        .finally(() => {
          activeReads--;
          current.pending = false;
          current.controller = undefined;
        });
      reply(res, 202, state(current));
    } catch (error) {
      if (error instanceof RequestError)
        reply(res, error.status, { message: error.message });
      else if (error instanceof CloudAmsError)
        reply(
          res,
          error.code === 'blocked'
            ? 429
            : error.code === 'authentication'
              ? 401
              : 502,
          { message: error.message },
        );
      else
        reply(res, 500, {
          message: 'Cloud service request failed. Try later.',
        });
    }
  }
  return {
    handle,
    close() {
      closed = true;
      clearInterval(timer);
      for (const session of sessions.values()) drop(session);
      limits.clear();
    },
  };
}
