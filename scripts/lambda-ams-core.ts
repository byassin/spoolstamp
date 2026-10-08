import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AMS_FRESH_MS, type AmsInventory } from '../lib/ams.ts';
import type { HostedCloudPrinter, HostedCloudState } from '../lib/cloud-ams.ts';
import { CloudAmsError, cloudDisplayText } from './cloud-ams-errors.ts';
import type { CloudSnapshot } from './cloud-ams-network.ts';

export const SESSION_MS = 30 * 60_000;
const CODE_MS = 10 * 60_000;
const REFRESH_MS = 5 * 60_000;
const COOKIE = '__Host-spoolstamp-cloud';
const hex = /^[a-f0-9]{64}$/;
const nonce = () => Buffer.from(randomBytes(32)).toString('hex');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) =>
  hex.test(a) && hex.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const emptyInventory = (): AmsInventory => ({
  available: true,
  connected: false,
  printerName: null,
  firmware: null,
  updatedAt: null,
  stale: true,
  slots: [],
  message: 'Sign in to read your AMS.',
});

export type LambdaSession = {
  key: string;
  version: number;
  expiresAt: number;
  csrf: string;
  authenticated: boolean;
  secret: string | null;
  challengeUntil: number;
  account: string;
  printers: HostedCloudPrinter[];
  selectedSerial: string | null;
  refreshAfter: number;
  busyUntil: number;
  inventory: AmsInventory;
  job: null | {
    id: string;
    serial: string;
    status: 'queued' | 'running';
    deadline: number;
  };
};
export interface SessionStore {
  get(key: string): Promise<LambdaSession | undefined>;
  create(session: LambdaSession): Promise<boolean>;
  swap(
    session: LambdaSession,
    previousVersion: number,
    now: number,
  ): Promise<boolean>;
  rotate(
    session: LambdaSession,
    oldKey: string,
    previousVersion: number,
    now: number,
  ): Promise<boolean>;
  remove(key: string, csrf: string): Promise<void>;
  rate(
    key: string,
    maximum: number,
    windowMs: number,
    now: number,
  ): Promise<void>;
}
export interface CredentialVault {
  seal(value: string, sessionKey: string): Promise<string>;
  open(value: string, sessionKey: string): Promise<string>;
  account(email: string): Promise<string>;
}
export interface LambdaProvider {
  requestEmailCode(email: string): Promise<void>;
  loginWithEmailCode(email: string, code: string): Promise<void>;
  sealAccessToken(seal: (value: string) => Promise<string>): Promise<string>;
  useAccessToken(value: string): void;
  printers(): Promise<HostedCloudPrinter[]>;
  snapshot(
    serial: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<CloudSnapshot>;
  close(): void;
}
export type ApiEvent = {
  version: string;
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    domainName: string;
    http: { method: string; sourceIp: string };
  };
};
export type ApiReply = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
};
export class LambdaRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Options = {
  appOrigin: string;
  apiHost: string;
  store: SessionStore;
  vault: CredentialVault;
  provider: (signal: AbortSignal) => LambdaProvider;
  enqueue: (key: string, job: string) => Promise<void>;
  allowedEmailHash?: string;
  now?: () => number;
};

/** Stateless API + idempotent worker. No user state in warm Lambda globals. */
export function createLambdaAmsService(options: Options) {
  const app = new URL(options.appOrigin);
  if (
    app.protocol !== 'https:' ||
    app.origin !== options.appOrigin ||
    app.username ||
    app.password ||
    !options.apiHost.endsWith(`.${app.hostname}`)
  )
    throw new Error(
      'Configure exact HTTPS website and separate same-site API hostname.',
    );
  const { store, vault } = options;
  const now = options.now ?? Date.now;
  const alive = (s: LambdaSession | undefined): s is LambdaSession =>
    !!s && s.expiresAt > now();
  function state(s: LambdaSession): HostedCloudState {
    const pending = !!s.job && s.job.deadline > now();
    const stale =
      !s.inventory.updatedAt || now() - s.inventory.updatedAt >= AMS_FRESH_MS;
    return {
      csrf: s.csrf,
      authenticated: s.authenticated,
      codeRequested: s.challengeUntil > now(),
      expiresAt: s.expiresAt,
      printers: s.printers,
      selectedSerial: s.selectedSerial,
      pending,
      refreshAfter: s.refreshAfter,
      inventory: {
        ...s.inventory,
        stale,
        message:
          s.job && !pending
            ? 'Cloud read expired. Wait for the cooldown, then try again.'
            : stale && s.inventory.updatedAt
              ? 'Cloud snapshot is stale. Wait for the refresh cooldown, then read again.'
              : s.inventory.message,
      },
    };
  }
  async function save(s: LambdaSession) {
    const previous = s.version;
    const next = { ...s, version: previous + 1 };
    if (!(await store.swap(next, previous, now())))
      throw new LambdaRequestError(
        409,
        'Session changed or expired. Reload and try again.',
      );
    return next;
  }
  async function api(event: ApiEvent): Promise<ApiReply> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
    };
    let cookies: string[] | undefined;
    const reply = (statusCode: number, value: unknown) => ({
      statusCode,
      headers,
      ...(cookies ? { cookies } : {}),
      body: statusCode === 204 ? '' : JSON.stringify(value),
    });
    const cookie = (raw: string, age: number) => {
      cookies = [
        `${COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`,
      ];
    };
    let locked: LambdaSession | undefined;
    let provider: LambdaProvider | undefined;
    try {
      if (
        event.version !== '2.0' ||
        event.requestContext.domainName !== options.apiHost ||
        event.rawQueryString
      )
        throw new LambdaRequestError(403, 'Endpoint not allowed.');
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      if (path === '/healthz' && method === 'GET')
        return reply(200, { ok: true });
      const requestHeaders = Object.fromEntries(
        Object.entries(event.headers).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      if (requestHeaders.origin !== options.appOrigin)
        throw new LambdaRequestError(403, 'Application origin not allowed.');
      headers['Access-Control-Allow-Origin'] = options.appOrigin;
      headers['Access-Control-Allow-Credentials'] = 'true';
      if (method === 'OPTIONS') {
        if (
          !['GET', 'POST', 'DELETE'].includes(
            requestHeaders['access-control-request-method'] ?? '',
          )
        )
          throw new LambdaRequestError(403, 'Method not allowed.');
        headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE';
        headers['Access-Control-Allow-Headers'] =
          'Content-Type, X-Spoolstamp-CSRF';
        return reply(204, null);
      }
      if (!['/session', '/email-code', '/login', '/snapshot'].includes(path))
        throw new LambdaRequestError(404, 'Not found.');
      if (
        path === '/session'
          ? !['GET', 'DELETE'].includes(method)
          : method !== 'POST'
      )
        throw new LambdaRequestError(405, 'Method not allowed.');
      // Source IP comes from API Gateway, not attacker-supplied forwarding headers.
      const peer = digest(event.requestContext.http.sourceIp);
      await store.rate(`http:${peer}`, 150, 60_000, now());
      await store.rate('http:global', 1500, 60_000, now());
      const rawCookies = (event.cookies ?? [])
        .flatMap((value) => value.split(';'))
        .map((value) => value.trim())
        .filter((value) => value.startsWith(`${COOKIE}=`));
      const raw =
        rawCookies.length === 1 ? rawCookies[0].slice(COOKIE.length + 1) : '';
      let session = hex.test(raw) ? await store.get(digest(raw)) : undefined;
      if (!alive(session) && path === '/session' && method === 'GET') {
        await store.rate(`new:${peer}`, 10, 60 * 60_000, now());
        await store.rate('new:global', 128, SESSION_MS, now());
        const created = nonce();
        session = {
          key: digest(created),
          version: 0,
          expiresAt: now() + SESSION_MS,
          csrf: nonce(),
          authenticated: false,
          secret: null,
          challengeUntil: 0,
          account: '',
          printers: [],
          selectedSerial: null,
          refreshAfter: 0,
          busyUntil: 0,
          inventory: emptyInventory(),
          job: null,
        };
        if (!(await store.create(session)))
          throw new LambdaRequestError(503, 'Cloud service is busy.');
        cookie(created, SESSION_MS / 1000);
      }
      if (!alive(session))
        throw new LambdaRequestError(401, 'Session expired. Sign in again.');
      if (method === 'GET') return reply(200, state(session));
      if (!equal(requestHeaders['x-spoolstamp-csrf'] ?? '', session.csrf))
        throw new LambdaRequestError(403, 'Session check failed.');
      if (method === 'DELETE') {
        await store.remove(session.key, session.csrf);
        cookie('', 0);
        return reply(200, { loggedOut: true });
      }
      if (
        requestHeaders['content-type'] !== 'application/json' ||
        requestHeaders['content-encoding'] ||
        event.isBase64Encoded ||
        Buffer.byteLength(event.body ?? '') > 2048
      )
        throw new LambdaRequestError(400, 'Invalid request.');
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(event.body ?? '');
        if (!input || Array.isArray(input) || typeof input !== 'object')
          throw new Error();
      } catch {
        throw new LambdaRequestError(400, 'Invalid request.');
      }
      const keys = (allowed: string[]) => {
        if (Object.keys(input).some((key) => !allowed.includes(key)))
          throw new LambdaRequestError(400, 'Invalid request.');
      };
      if (session.busyUntil > now())
        throw new LambdaRequestError(409, 'Another request is in progress.');
      locked = await save({ ...session, busyUntil: now() + 30_000 });
      session = locked;
      const signal = AbortSignal.timeout(18_000);
      provider = options.provider(signal);
      if (path === '/email-code') {
        keys(['email', 'consent']);
        if (
          session.authenticated ||
          input.consent !== true ||
          typeof input.email !== 'string' ||
          input.email.length > 254 ||
          cloudDisplayText(input.email, 254) !== input.email ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
        )
          throw new LambdaRequestError(
            400,
            'Enter a valid email and accept the experimental connection notice.',
          );
        const email = input.email;
        if (
          options.allowedEmailHash &&
          digest(email.toLowerCase()) !== options.allowedEmailHash
        )
          throw new LambdaRequestError(
            403,
            'This account is not enabled for the private preview.',
          );
        const account = await vault.account(email.toLowerCase());
        await store.rate(`send:${peer}`, 5, 60 * 60_000, now());
        await store.rate('send:global', 20, 60 * 60_000, now());
        await store.rate(`send-account:${account}`, 1, REFRESH_MS, now());
        // Clear old challenge before vendor traffic, including failed email sends.
        locked = session = await save({
          ...session,
          secret: null,
          challengeUntil: 0,
          account,
        });
        await provider.requestEmailCode(email);
        session = await save({
          ...session,
          secret: await vault.seal(email, session.key),
          challengeUntil: Math.min(now() + CODE_MS, session.expiresAt),
          busyUntil: 0,
        });
      } else if (path === '/login') {
        keys(['code']);
        if (
          session.authenticated ||
          !session.secret ||
          session.challengeUntil <= now() ||
          typeof input.code !== 'string' ||
          !/^\d{6}$/.test(input.code)
        )
          throw new LambdaRequestError(
            400,
            'Request a fresh email code, then enter its six digits.',
          );
        await store.rate(`login:${peer}`, 20, SESSION_MS, now());
        await store.rate(
          `login-account:${session.account}`,
          5,
          SESSION_MS,
          now(),
        );
        const email = await vault.open(session.secret, session.key);
        await provider.loginWithEmailCode(email, input.code);
        // Immediately discard the challenge; never save the verification code.
        locked = session = await save({
          ...session,
          secret: null,
          challengeUntil: 0,
        });
        const printers = await provider.printers();
        const rotated = nonce();
        const rotatedKey = digest(rotated);
        const secret = await provider.sealAccessToken((value) =>
          vault.seal(value, rotatedKey),
        );
        const next = {
          ...session,
          key: rotatedKey,
          version: session.version + 1,
          csrf: nonce(),
          authenticated: true,
          secret,
          printers,
          busyUntil: 0,
        };
        if (!(await store.rotate(next, session.key, session.version, now())))
          throw new LambdaRequestError(
            409,
            'Session changed or expired. Reload and try again.',
          );
        session = next;
        cookie(
          rotated,
          Math.max(0, Math.floor((session.expiresAt - now()) / 1000)),
        );
      } else {
        keys(['serial']);
        if (!session.authenticated || !session.secret)
          throw new LambdaRequestError(401, 'Sign in first.');
        if (
          typeof input.serial !== 'string' ||
          !/^[A-Z0-9]{10,32}$/.test(input.serial)
        )
          throw new LambdaRequestError(400, 'Choose an account printer.');
        const printer = session.printers.find(
          (item) => item.serial === input.serial,
        );
        if (!printer)
          throw new LambdaRequestError(
            403,
            'This printer is not in your account.',
          );
        if (session.job && session.job.deadline > now())
          throw new LambdaRequestError(
            409,
            'An AMS read is already in progress.',
          );
        await store.rate(
          `read:${session.account}:${printer.serial}`,
          1,
          REFRESH_MS,
          now(),
        );
        await store.rate('read:global', 60, 60 * 60_000, now());
        const job = {
          id: nonce(),
          serial: printer.serial,
          status: 'queued' as const,
          deadline: Math.min(now() + 120_000, session.expiresAt),
        };
        locked = session = await save({
          ...session,
          busyUntil: 0,
          job,
          selectedSerial: printer.serial,
          refreshAfter: now() + REFRESH_MS,
          inventory: {
            ...emptyInventory(),
            connected: true,
            printerName: printer.name,
            message: 'Waiting for a fresh cloud AMS snapshot…',
          },
        });
        try {
          await options.enqueue(session.key, job.id);
        } catch {
          locked = session = await save({
            ...session,
            job: null,
            inventory: {
              ...emptyInventory(),
              message: 'Cloud read could not start. Try after the cooldown.',
            },
          });
          throw new LambdaRequestError(503, 'Cloud read could not start.');
        }
        locked = undefined;
        return reply(202, state(session));
      }
      locked = undefined;
      return reply(200, state(session));
    } catch (error) {
      if (error instanceof LambdaRequestError)
        return reply(error.status, { message: error.message });
      if (error instanceof CloudAmsError)
        return reply(
          error.code === 'blocked'
            ? 429
            : error.code === 'authentication'
              ? 401
              : 502,
          { message: error.message },
        );
      return reply(503, {
        message: 'Cloud service request failed. Try later.',
      });
    } finally {
      provider?.close();
      if (locked)
        await store
          .swap(
            { ...locked, busyUntil: 0, version: locked.version + 1 },
            locked.version,
            now(),
          )
          .catch(() => undefined);
    }
  }

  async function worker(input: { key: string; job: string }) {
    if (!hex.test(input.key) || !hex.test(input.job)) return;
    let session = await store.get(input.key);
    if (
      !alive(session) ||
      !session.authenticated ||
      !session.secret ||
      session.job?.id !== input.job ||
      session.job.status !== 'queued' ||
      session.job.deadline <= now()
    )
      return;
    // Claim before any vendor traffic. Duplicate/retried deliveries never read twice.
    try {
      session = await save({
        ...session,
        job: { ...session.job, status: 'running' },
      });
    } catch (error) {
      if (error instanceof LambdaRequestError) return;
      throw error;
    }
    const claimed = session;
    const controller = new AbortController();
    const duration = Math.min(
      60_000,
      claimed.expiresAt - now(),
      claimed.job!.deadline - now(),
    );
    if (duration < 1000) return;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(duration),
    ]);
    const provider = options.provider(signal);
    let checking = false;
    // Cross-instance logout cannot directly close this process's socket. Check
    // revocation while reading; any store error fails closed and aborts the read.
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void store
        .get(claimed.key)
        .then((current) => {
          if (
            !alive(current) ||
            current.version !== claimed.version ||
            current.job?.id !== input.job
          )
            controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          checking = false;
        });
    }, 2000);
    try {
      const token = await vault.open(claimed.secret!, claimed.key);
      const current = await store.get(claimed.key);
      if (
        !alive(current) ||
        current.version !== claimed.version ||
        signal.aborted
      )
        return;
      provider.useAccessToken(token);
      const snapshot = await provider.snapshot(claimed.job!.serial, {
        signal,
        timeoutMs: duration,
      });
      if (signal.aborted) return;
      await save({
        ...claimed,
        job: null,
        inventory: {
          ...claimed.inventory,
          updatedAt: snapshot.updatedAt,
          slots: snapshot.slots,
          message:
            'Fresh cloud snapshot. Confirm loaded spools before printing.',
        },
      });
    } catch (error) {
      const revoke =
        error instanceof CloudAmsError &&
        ['authentication', 'blocked', 'ownership'].includes(error.code);
      await store.swap(
        {
          ...claimed,
          version: claimed.version + 1,
          job: null,
          ...(revoke
            ? { secret: null, authenticated: false, printers: [] }
            : {}),
          inventory: {
            ...emptyInventory(),
            message:
              error instanceof CloudAmsError
                ? error.message
                : 'Cloud AMS read failed. Try later.',
          },
        },
        claimed.version,
        now(),
      );
    } finally {
      clearInterval(timer);
      controller.abort();
      provider.close();
    }
  }
  return { api, worker };
}
