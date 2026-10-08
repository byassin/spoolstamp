import { createHmac, randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  createLambdaAmsService,
  digest,
  LambdaRequestError,
  SESSION_MS,
  type ApiEvent,
  type LambdaSession,
  type SessionStore,
  type LambdaProvider,
} from '../scripts/lambda-ams-core';
import { sealEnvelope, openEnvelope } from '../scripts/lambda-ams-aws';
import { CloudAmsError } from '../scripts/cloud-ams';
const APP = 'https://spoolstamp.example.org';
const HOST = 'ams.spoolstamp.example.org';
const EMAIL = 'preview@example.org';
const TOKEN = 'synthetic-only-token-1234567890';
const SERIAL = 'TESTPRINTER123';
const printer = {
  serial: SERIAL,
  name: 'Synthetic X2D',
  model: 'X2D',
  online: true,
};

function setup() {
  let time = 100_000;
  const sessions = new Map<string, LambdaSession>();
  const rates = new Map<string, { count: number; until: number }>();
  const copy = <T>(value: T): T => structuredClone(value);
  const store: SessionStore = {
    async get(key) {
      return copy(sessions.get(key));
    },
    async create(session) {
      if (sessions.has(session.key)) return false;
      sessions.set(session.key, copy(session));
      return true;
    },
    async swap(session, previous, now) {
      const old = sessions.get(session.key);
      if (!old || old.version !== previous || old.expiresAt <= now)
        return false;
      sessions.set(session.key, copy(session));
      return true;
    },
    async rotate(session, key, previous, now) {
      const old = sessions.get(key);
      if (
        !old ||
        old.version !== previous ||
        old.expiresAt <= now ||
        sessions.has(session.key)
      )
        return false;
      sessions.delete(key);
      sessions.set(session.key, copy(session));
      return true;
    },
    async remove(key, csrf) {
      if (sessions.get(key)?.csrf === csrf) sessions.delete(key);
    },
    async rate(key, maximum, windowMs, now) {
      const old = rates.get(key);
      const rate =
        old && old.until > now ? old : { count: 0, until: now + windowMs };
      if (rate.count >= maximum) throw new LambdaRequestError(429, 'Limited.');
      rate.count++;
      rates.set(key, rate);
    },
  };
  const key = randomBytes(32);
  const vault = {
    seal: vi.fn(async (value: string, binding: string) =>
      sealEnvelope(value, key, Buffer.from('fake-wrapped-key'), binding),
    ),
    open: vi.fn(async (value: string, binding: string) =>
      openEnvelope(JSON.parse(value), key, binding),
    ),
    account: vi.fn(async (value: string) =>
      createHmac('sha256', 'synthetic-rate-key').update(value).digest('hex'),
    ),
  };
  const send = vi.fn(async () => undefined);
  const login = vi.fn<() => Promise<void>>(async () => undefined);
  const snapshot = vi.fn<LambdaProvider['snapshot']>(async () => ({
    updatedAt: time,
    slots: [],
  }));
  const close = vi.fn();
  const provider = vi.fn((_signal: AbortSignal): LambdaProvider => {
    let token = '';
    return {
      requestEmailCode: send,
      async loginWithEmailCode(email, code) {
        await login();
        expect(email).toBe(EMAIL);
        expect(code).toBe('123456');
        token = TOKEN;
      },
      async sealAccessToken(seal) {
        return seal(token);
      },
      useAccessToken(value) {
        expect(value).toBe(TOKEN);
        token = value;
      },
      printers: async () => [printer],
      snapshot,
      close,
    };
  });
  const enqueue = vi.fn(async (_key: string, _job: string) => undefined);
  const options = {
    appOrigin: APP,
    apiHost: HOST,
    store,
    vault,
    provider,
    enqueue,
    now: () => time,
    allowedEmailHash: digest(EMAIL),
  };
  const service = () => createLambdaAmsService(options);
  let cookie = '';
  let csrf = '';
  const event = (path: string, method = 'GET', body?: unknown): ApiEvent => ({
    version: '2.0',
    rawPath: path,
    headers: {
      origin: APP,
      'content-type': 'application/json',
      'x-spoolstamp-csrf': csrf,
    },
    cookies: cookie ? [cookie] : [],
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    requestContext: {
      domainName: HOST,
      http: { method, sourceIp: '192.0.2.1' },
    },
  });
  async function call(path: string, method = 'GET', input?: unknown) {
    // New service instance for EVERY request simulates cold starts and scaling.
    const result = await service().api(event(path, method, input));
    if (result.cookies) cookie = result.cookies[0].split(';')[0];
    const body = result.body ? JSON.parse(result.body) : null;
    if (body?.csrf) csrf = body.csrf;
    return { ...result, data: body };
  }
  async function authenticate() {
    expect((await call('/session')).statusCode).toBe(200);
    expect(
      (await call('/email-code', 'POST', { email: EMAIL, consent: true }))
        .statusCode,
    ).toBe(200);
    expect((await call('/login', 'POST', { code: '123456' })).statusCode).toBe(
      200,
    );
  }
  return {
    sessions,
    rates,
    store,
    vault,
    provider,
    send,
    login,
    snapshot,
    close,
    enqueue,
    service,
    event,
    call,
    authenticate,
    options,
    advance: (ms: number) => {
      time += ms;
    },
    cookie: () => cookie,
    csrf: () => csrf,
  };
}

describe('stateless Lambda cloud AMS', () => {
  it('rejects unrelated origins, raw AWS domains, queries, and LAN endpoints', async () => {
    const f = setup();
    const base = f.event('/session');
    for (const event of [
      { ...base, headers: { origin: 'https://evil.example' } },
      {
        ...base,
        requestContext: {
          ...base.requestContext,
          domainName: 'raw.execute-api.amazonaws.com',
        },
      },
      { ...base, rawQueryString: 'token=private' },
    ])
      expect((await f.service().api(event)).statusCode).toBe(403);
    expect(
      (await f.call('/api/ams/local/connect', 'POST', {})).statusCode,
    ).toBe(404);
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.sessions.size).toBe(0);
  });
  it('sets host-only secure cookies, exact CORS, and a hard non-sliding expiry', async () => {
    const f = setup();
    const first = await f.call('/session');
    expect(first.cookies?.[0]).toMatch(
      /^__Host-spoolstamp-cloud=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800$/,
    );
    expect(first.headers['Access-Control-Allow-Origin']).toBe(APP);
    expect(first.headers['Cache-Control']).toBe('no-store');
    f.advance(1000);
    expect((await f.call('/session')).data.expiresAt).toBe(
      first.data.expiresAt,
    );
  });
  it('requires CSRF, email consent, bounded JSON and a preview-enabled account', async () => {
    const f = setup();
    await f.call('/session');
    const event = f.event('/email-code', 'POST', {
      email: EMAIL,
      consent: true,
    });
    expect(
      (
        await f
          .service()
          .api({
            ...event,
            headers: { ...event.headers, 'x-spoolstamp-csrf': 'bad' },
          })
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.call('/email-code', 'POST', { email: EMAIL, consent: false }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await f.call('/email-code', 'POST', {
          email: 'other@example.org',
          consent: true,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.call('/email-code', 'POST', {
          email: EMAIL,
          consent: true,
          token: TOKEN,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await f.service().api({ ...event, body: 'x'.repeat(2049) })).statusCode,
    ).toBe(400);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('rotates cookie/CSRF and encrypts email/token while never storing verification codes', async () => {
    const f = setup();
    const bootstrap = await f.call('/session');
    const old = f.cookie();
    const email = await f.call('/email-code', 'POST', {
      email: EMAIL,
      consent: true,
    });
    const persistedEmail = JSON.stringify([...f.sessions.values()]);
    expect(persistedEmail).not.toContain(EMAIL);
    const login = await f.call('/login', 'POST', { code: '123456' });
    expect(login.data.authenticated).toBe(true);
    expect(f.cookie()).not.toBe(old);
    expect(login.data.csrf).not.toBe(bootstrap.data.csrf);
    const persisted = JSON.stringify([...f.sessions.values()]);
    for (const secret of [EMAIL, TOKEN, '123456']) {
      expect(persisted).not.toContain(secret);
      expect(JSON.stringify([bootstrap, email, login])).not.toContain(secret);
    }
    expect([...f.sessions.values()][0].challengeUntil).toBe(0);
    expect(
      (
        await f
          .service()
          .api({
            ...f.event('/snapshot', 'POST', { serial: SERIAL }),
            cookies: [old],
          })
      ).statusCode,
    ).toBe(401);
  });
  it('survives cold starts and completes one asynchronous read with sanitized output', async () => {
    const f = setup();
    await f.authenticate();
    const queued = await f.call('/snapshot', 'POST', { serial: SERIAL });
    expect(queued.statusCode).toBe(202);
    expect(queued.data.pending).toBe(true);
    expect(f.snapshot).not.toHaveBeenCalled();
    const [key, job] = f.enqueue.mock.calls[0];
    expect(JSON.stringify(f.enqueue.mock.calls)).not.toMatch(
      /synthetic-only-token|preview@example|TESTPRINTER/,
    );
    await f.service().worker({ key, job });
    expect(f.snapshot).toHaveBeenCalledOnce();
    const result = await f.call('/session');
    expect(result.data.pending).toBe(false);
    expect(result.data.inventory.stale).toBe(false);
    expect(result.data.inventory.updatedAt).toBe(100_000);
    f.advance(45_000);
    expect((await f.call('/session')).data.inventory.stale).toBe(true);
  });
  it('does not repeat vendor reads on duplicate worker events or concurrent claims', async () => {
    const f = setup();
    await f.authenticate();
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    const [key, job] = f.enqueue.mock.calls[0];
    await Promise.all([
      f.service().worker({ key, job }),
      f.service().worker({ key, job }),
    ]);
    await f.service().worker({ key, job });
    expect(f.snapshot).toHaveBeenCalledOnce();
  });
  it('enforces printer ownership and preserves cooldown across logout/login and clock boundaries', async () => {
    const f = setup();
    await f.authenticate();
    expect(
      (await f.call('/snapshot', 'POST', { serial: 'OTHERPRINTER123' }))
        .statusCode,
    ).toBe(403);
    f.advance(499_999); // after mail cooldown, immediately before a wall-clock five-minute boundary
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    const [key, job] = f.enqueue.mock.calls[0];
    await f.service().worker({ key, job });
    await f.call('/session', 'DELETE');
    f.advance(1000);
    await f.authenticate();
    expect(
      (await f.call('/snapshot', 'POST', { serial: SERIAL })).statusCode,
    ).toBe(429);
    expect(f.enqueue).toHaveBeenCalledOnce();
    f.advance(5 * 60_000);
    expect(
      (await f.call('/snapshot', 'POST', { serial: SERIAL })).statusCode,
    ).toBe(202);
  });
  it('logout before queued worker delivery prevents decryption and vendor traffic', async () => {
    const f = setup();
    await f.authenticate();
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    const [key, job] = f.enqueue.mock.calls[0];
    await f.call('/session', 'DELETE');
    f.vault.open.mockClear();
    await f.service().worker({ key, job });
    expect(f.vault.open).not.toHaveBeenCalled();
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.sessions.size).toBe(0);
  });
  it('rejects expired sessions even while DynamoDB TTL has not deleted their encrypted rows', async () => {
    const f = setup();
    await f.authenticate();
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    const [key, job] = f.enqueue.mock.calls[0];
    f.advance(SESSION_MS);
    expect(f.sessions.size).toBe(1);
    expect(
      (await f.call('/snapshot', 'POST', { serial: SERIAL })).statusCode,
    ).toBe(401);
    f.vault.open.mockClear();
    await f.service().worker({ key, job });
    expect(f.vault.open).not.toHaveBeenCalled();
    expect(f.snapshot).not.toHaveBeenCalled();
  });
  it('worker checks vendor ownership through the provider and revokes rejected credentials', async () => {
    const f = setup();
    await f.authenticate();
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    f.snapshot.mockRejectedValueOnce(new CloudAmsError('ownership'));
    const [key, job] = f.enqueue.mock.calls[0];
    await f.service().worker({ key, job });
    const state = await f.call('/session');
    expect(state.data.authenticated).toBe(false);
    expect([...f.sessions.values()][0].secret).toBeNull();
    expect(state.data.printers).toEqual([]);
  });
  it('logout during login cannot recreate a deleted session or return new cookies', async () => {
    const f = setup();
    await f.call('/session');
    await f.call('/email-code', 'POST', { email: EMAIL, consent: true });
    let complete!: () => void;
    f.login.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = f
      .service()
      .api(f.event('/login', 'POST', { code: '123456' }));
    await vi.waitFor(() => expect(f.login).toHaveBeenCalledOnce());
    await f.call('/session', 'DELETE');
    complete();
    const result = await pending;
    expect(result.statusCode).toBe(409);
    expect(result.cookies).toBeUndefined();
    expect(f.sessions.size).toBe(0);
  });
  it('logout during an active read aborts it and cannot resurrect result rows', async () => {
    const f = setup();
    await f.authenticate();
    await f.call('/snapshot', 'POST', { serial: SERIAL });
    f.snapshot.mockImplementationOnce(
      (_serial, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new CloudAmsError('cancelled')),
            { once: true },
          ),
        ),
    );
    const [key, job] = f.enqueue.mock.calls[0];
    const worker = f.service().worker({ key, job });
    await vi.waitFor(() => expect(f.snapshot).toHaveBeenCalledOnce());
    await f.call('/session', 'DELETE');
    await worker;
    expect(f.sessions.size).toBe(0);
    expect(f.close).toHaveBeenCalled();
  });
  it('rejects expired challenges and limits login attempts across separate Lambda instances', async () => {
    const f = setup();
    await f.call('/session');
    await f.call('/email-code', 'POST', { email: EMAIL, consent: true });
    f.advance(10 * 60_000);
    expect(
      (await f.call('/login', 'POST', { code: '123456' })).statusCode,
    ).toBe(400);
    expect(f.login).not.toHaveBeenCalled();
    await f.call('/email-code', 'POST', { email: EMAIL, consent: true });
    f.login.mockRejectedValue(new CloudAmsError('authentication'));
    for (let n = 0; n < 5; n++)
      expect(
        (await f.call('/login', 'POST', { code: '123456' })).statusCode,
      ).toBe(401);
    expect(
      (await f.call('/login', 'POST', { code: '123456' })).statusCode,
    ).toBe(429);
  });
  it('sanitizes arbitrary AWS/provider failures and leaves sessions usable after failed sends', async () => {
    const f = setup();
    await f.call('/session');
    f.send.mockRejectedValueOnce(new Error(`SECRET ${EMAIL} ${TOKEN}`));
    const result = await f.call('/email-code', 'POST', {
      email: EMAIL,
      consent: true,
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toMatch(
      /SECRET|preview@example|synthetic-only-token/,
    );
    expect([...f.sessions.values()][0].busyUntil).toBe(0);
  });
  it('queue failure retains the account cooldown and does not leave a permanent pending job', async () => {
    const f = setup();
    await f.authenticate();
    f.enqueue.mockRejectedValueOnce(new Error('private SDK detail'));
    const result = await f.call('/snapshot', 'POST', { serial: SERIAL });
    expect(result.statusCode).toBe(503);
    expect((await f.call('/session')).data.pending).toBe(false);
    expect(
      (await f.call('/snapshot', 'POST', { serial: SERIAL })).statusCode,
    ).toBe(429);
  });
});

describe('credential envelopes', () => {
  it('encrypts large tokens and authenticates ciphertext plus the session binding', () => {
    const key = randomBytes(32);
    const binding = 'session:' + 'a'.repeat(64);
    const value = TOKEN + 'x'.repeat(12_000);
    const sealed = sealEnvelope(
      value,
      key,
      Buffer.from('wrapped-only'),
      binding,
    );
    expect(sealed).not.toContain(TOKEN);
    expect(openEnvelope(JSON.parse(sealed), key, binding)).toBe(value);
    expect(() =>
      openEnvelope(JSON.parse(sealed), key, 'other-session'),
    ).toThrow();
    const tampered = JSON.parse(sealed);
    const bytes = Buffer.from(tampered.data, 'base64');
    bytes[0] ^= 1;
    tampered.data = bytes.toString('base64');
    expect(() => openEnvelope(tampered, key, binding)).toThrow();
  });
  it('bounds plaintext size and rejects malformed key/nonce/tag lengths', () => {
    const key = randomBytes(32);
    expect(() =>
      sealEnvelope('x'.repeat(18_001), key, key, 'binding'),
    ).toThrow();
    const envelope = JSON.parse(sealEnvelope(TOKEN, key, key, 'binding'));
    expect(() =>
      openEnvelope({ ...envelope, iv: '' }, key, 'binding'),
    ).toThrow();
    expect(() =>
      openEnvelope({ ...envelope, tag: '' }, key, 'binding'),
    ).toThrow();
  });
});
