import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostedAmsService } from '../scripts/hosted-ams';
import { CloudAmsError } from '../scripts/cloud-ams';

const APP = 'https://spoolstamp.bourhan.org';
const SERIAL = 'TESTPRINTER123';
let time: number;
let server: Server;
let base: string;
let service: ReturnType<typeof createHostedAmsService>;
function provider(serial = SERIAL) {
  return {
    requestEmailCode: vi.fn(async (_email: string) => {}),
    loginWithEmailCode: vi.fn(async (_email: string, _code: string) => {}),
    printers: vi.fn(async () => [
      { serial, name: 'Desk', model: 'X2D', online: true },
    ]),
    snapshot: vi.fn(
      async (_serial: string, _options: { signal?: AbortSignal }) => ({
        updatedAt: time,
        slots: [],
      }),
    ),
    close: vi.fn(),
  };
}
let fake: ReturnType<typeof provider>;
let providers: ReturnType<typeof provider>[];
beforeEach(async () => {
  time = 1_800_000_000_000;
  fake = provider();
  providers = [fake];
  service = createHostedAmsService({
    appOrigin: APP,
    secureCookies: true,
    now: () => time,
    provider: () => providers.shift() ?? provider(),
  });
  server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  service.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function jar() {
  let cookie = '',
    csrf = '';
  return {
    get cookie() {
      return cookie;
    },
    get csrf() {
      return csrf;
    },
    async call(
      path: string,
      method = 'GET',
      input?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: APP,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET' ? { 'X-Spoolstamp-CSRF': csrf } : {}),
          ...(input !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...headers,
        },
        ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      const value = text ? JSON.parse(text) : null;
      if (value?.csrf) csrf = value.csrf;
      return {
        status: response.status,
        value,
        text,
        headers: response.headers,
      };
    },
  };
}
async function signedIn(client = jar(), email = 'test@example.org') {
  await client.call('/session');
  expect(
    (await client.call('/email-code', 'POST', { email, consent: true })).status,
  ).toBe(200);
  expect((await client.call('/login', 'POST', { code: '123456' })).status).toBe(
    200,
  );
  return client;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('hosted cloud boundary', () => {
  it('preserves read cooldown across two already-authorized sessions for one account', async () => {
    const a = await signedIn();
    time += 5 * 60_000;
    const b = await signedIn(jar(), 'TEST@example.org');
    await a.call('/snapshot', 'POST', { serial: SERIAL });
    await tick();
    expect((await b.call('/snapshot', 'POST', { serial: SERIAL })).status).toBe(
      429,
    );
  });
  it('expires a requested email code without attempting provider login', async () => {
    const client = jar();
    await client.call('/session');
    await client.call('/email-code', 'POST', {
      email: 'test@example.org',
      consent: true,
    });
    time += 11 * 60_000;
    expect(
      (await client.call('/login', 'POST', { code: '123456' })).status,
    ).toBe(400);
    expect(fake.loginWithEmailCode).not.toHaveBeenCalled();
  });
  it('bootstraps only an opaque secure cookie and does not contact Bambu', async () => {
    const client = jar();
    const reply = await client.call('/session');
    expect(reply.status).toBe(200);
    expect(reply.headers.get('set-cookie')).toMatch(
      /^__Host-spoolstamp-cloud=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1800; Secure$/,
    );
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(reply.value).toMatchObject({
      authenticated: false,
      pending: false,
      printers: [],
    });
    expect(reply.text).not.toContain(client.cookie.split('=')[1]);
    expect(fake.requestEmailCode).not.toHaveBeenCalled();
    expect(fake.printers).not.toHaveBeenCalled();
    expect(fake.snapshot).not.toHaveBeenCalled();
  });
  it('rejects missing/wrong origins and does not enable wildcard CORS', async () => {
    const client = jar();
    for (const Origin of [
      '',
      'https://evil.example',
      'null',
      `${APP}.evil.example`,
    ]) {
      const reply = await client.call('/session', 'GET', undefined, { Origin });
      expect(reply.status).toBe(403);
      expect(reply.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(
      (await client.call('/session', 'OPTIONS')).headers.get(
        'access-control-allow-origin',
      ),
    ).toBe(APP);
    expect((await fetch(base + '/healthz')).status).toBe(200);
  });
  it('requires CSRF, explicit consent, JSON and known fields', async () => {
    const client = jar();
    await client.call('/session');
    const input = { email: 'test@example.org', consent: true };
    expect(
      (
        await client.call('/email-code', 'POST', input, {
          'X-Spoolstamp-CSRF': '',
        })
      ).status,
    ).toBe(403);
    expect(
      (await client.call('/email-code', 'POST', { ...input, consent: false }))
        .status,
    ).toBe(400);
    expect(
      (
        await client.call('/email-code', 'POST', {
          ...input,
          host: 'evil.example',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.call('/email-code', 'POST', input, {
          'Content-Type': 'text/plain',
        })
      ).status,
    ).toBe(400);
    expect(fake.requestEmailCode).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies, malformed codes and arbitrary endpoints/methods', async () => {
    const client = jar();
    await client.call('/session');
    expect(
      (await client.call('/email-code', 'POST', { email: 'x'.repeat(3000) }))
        .status,
    ).toBe(400);
    expect((await client.call('/login', 'POST', { code: '123' })).status).toBe(
      400,
    );
    expect((await client.call('/session', 'POST', {})).status).toBe(405);
    expect((await client.call('/snapshot', 'GET')).status).toBe(405);
    expect(
      (await client.call('/control', 'POST', { command: 'print' })).status,
    ).toBe(404);
  });
  it('requests exactly one email and rotates the cookie/CSRF at login', async () => {
    const client = jar();
    await client.call('/session');
    const oldCookie = client.cookie,
      oldCsrf = client.csrf;
    await client.call('/email-code', 'POST', {
      email: 'test@example.org',
      consent: true,
    });
    const login = await client.call('/login', 'POST', { code: '123456' });
    expect(login.status).toBe(200);
    expect(client.cookie).not.toBe(oldCookie);
    expect(client.csrf).not.toBe(oldCsrf);
    expect(login.text).not.toMatch(
      /test@example|123456|accessToken|refreshToken|access_code/,
    );
    expect(fake.requestEmailCode).toHaveBeenCalledExactlyOnceWith(
      'test@example.org',
    );
    expect(fake.loginWithEmailCode).toHaveBeenCalledExactlyOnceWith(
      'test@example.org',
      '123456',
    );
    expect(
      (
        await client.call(
          '/snapshot',
          'POST',
          { serial: SERIAL },
          { 'X-Spoolstamp-CSRF': oldCsrf },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await client.call(
          '/snapshot',
          'POST',
          { serial: SERIAL },
          { Cookie: oldCookie, 'X-Spoolstamp-CSRF': oldCsrf },
        )
      ).status,
    ).toBe(401);
  });
  it('isolates different accounts and rejects a caller-supplied unowned serial', async () => {
    const other = provider('OTHERPRINTER123');
    providers.push(other);
    const a = await signedIn(jar(), 'a@example.org');
    const b = await signedIn(jar(), 'b@example.org');
    expect((await b.call('/snapshot', 'POST', { serial: SERIAL })).status).toBe(
      403,
    );
    expect(
      (
        await a.call(
          '/snapshot',
          'POST',
          { serial: SERIAL },
          { 'X-Spoolstamp-CSRF': b.csrf },
        )
      ).status,
    ).toBe(403);
    expect((await b.call('/session')).value.printers[0].serial).toBe(
      'OTHERPRINTER123',
    );
    expect(other.snapshot).not.toHaveBeenCalled();
  });
  it('returns 202, polls completion, expires freshness and throttles repeated reads', async () => {
    const client = await signedIn();
    const started = await client.call('/snapshot', 'POST', { serial: SERIAL });
    expect(started.status).toBe(202);
    await tick();
    const completed = (await client.call('/session')).value;
    expect(completed).toMatchObject({
      pending: false,
      inventory: { connected: true, updatedAt: time, stale: false },
    });
    expect(fake.snapshot).toHaveBeenCalledOnce();
    expect(
      (await client.call('/snapshot', 'POST', { serial: SERIAL })).status,
    ).toBe(429);
    time += 46_000;
    expect((await client.call('/session')).value.inventory.stale).toBe(true);
    time += 5 * 60_000;
    expect(
      (await client.call('/snapshot', 'POST', { serial: SERIAL })).status,
    ).toBe(202);
  });
  it('preserves account/device cooldown across sessions and case-normalized email', async () => {
    const a = await signedIn();
    await a.call('/snapshot', 'POST', { serial: SERIAL });
    await tick();
    await a.call('/session', 'DELETE');
    time += 1000;
    const b = jar();
    await b.call('/session');
    expect(
      (
        await b.call('/email-code', 'POST', {
          email: 'TEST@example.org',
          consent: true,
        })
      ).status,
    ).toBe(429);
  });
  it('bounds code attempts and hides upstream/general exceptions', async () => {
    const client = jar();
    await client.call('/session');
    await client.call('/email-code', 'POST', {
      email: 'test@example.org',
      consent: true,
    });
    fake.loginWithEmailCode.mockRejectedValue(
      new CloudAmsError('authentication'),
    );
    for (let i = 0; i < 5; i++)
      expect(
        (await client.call('/login', 'POST', { code: '123456' })).status,
      ).toBe(401);
    expect(
      (await client.call('/login', 'POST', { code: '123456' })).status,
    ).toBe(429);
    expect(fake.loginWithEmailCode).toHaveBeenCalledTimes(5);
  });
  it('does not echo network secrets or keep authenticated state when listing fails', async () => {
    const client = jar();
    await client.call('/session');
    await client.call('/email-code', 'POST', {
      email: 'test@example.org',
      consent: true,
    });
    fake.printers.mockRejectedValue(new Error('PRIVATE-TOKEN-and-email'));
    const reply = await client.call('/login', 'POST', { code: '123456' });
    expect(reply.status).toBe(500);
    expect(reply.text).not.toContain('PRIVATE');
    expect(fake.close).toHaveBeenCalled();
    expect((await client.call('/session')).value.authenticated).toBe(false);
  });
  it('aborts pending MQTT on logout and fences a late snapshot', async () => {
    let resolve!: (value: { updatedAt: number; slots: [] }) => void;
    fake.snapshot.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const client = await signedIn();
    await client.call('/snapshot', 'POST', { serial: SERIAL });
    await tick();
    const signal = fake.snapshot.mock.calls[0][1].signal;
    const oldCookie = client.cookie,
      oldCsrf = client.csrf;
    expect((await client.call('/session', 'DELETE')).status).toBe(200);
    expect(signal?.aborted).toBe(true);
    expect(fake.close).toHaveBeenCalled();
    resolve({ updatedAt: time, slots: [] });
    await tick();
    expect(
      (
        await client.call(
          '/snapshot',
          'POST',
          { serial: SERIAL },
          { Cookie: oldCookie, 'X-Spoolstamp-CSRF': oldCsrf },
        )
      ).status,
    ).toBe(401);
    expect((await client.call('/session')).value.authenticated).toBe(false);
  });
  it('fences login completing after logout', async () => {
    let finish!: () => void;
    fake.loginWithEmailCode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = jar();
    await client.call('/session');
    await client.call('/email-code', 'POST', {
      email: 'test@example.org',
      consent: true,
    });
    const pending = client.call('/login', 'POST', { code: '123456' });
    await tick();
    await client.call('/session', 'DELETE');
    finish();
    expect((await pending).status).toBe(401);
    expect(fake.printers).not.toHaveBeenCalled();
    expect((await client.call('/session')).value.authenticated).toBe(false);
  });
  it('expires sessions even when the client continues polling', async () => {
    const client = await signedIn();
    time += 31 * 60_000;
    expect(
      (await client.call('/snapshot', 'POST', { serial: SERIAL })).status,
    ).toBe(401);
    expect(fake.close).toHaveBeenCalled();
    expect((await client.call('/session')).value.authenticated).toBe(false);
  });
  it('stops exposing a connection when vendor authentication or ownership changes', async () => {
    fake.snapshot.mockRejectedValue(new CloudAmsError('ownership'));
    const client = await signedIn();
    await client.call('/snapshot', 'POST', { serial: SERIAL });
    await tick();
    expect((await client.call('/session')).value).toMatchObject({
      authenticated: false,
      printers: [],
      inventory: { connected: false, stale: true, slots: [] },
    });
    expect(fake.close).toHaveBeenCalled();
  });
  it('requires HTTPS in production and loopback in explicit insecure development', () => {
    expect(() =>
      createHostedAmsService({
        appOrigin: 'http://spoolstamp.bourhan.org',
        secureCookies: true,
      }),
    ).toThrow();
    expect(() =>
      createHostedAmsService({ appOrigin: APP, secureCookies: false }),
    ).toThrow();
    expect(() =>
      createHostedAmsService({ appOrigin: `${APP}/path`, secureCookies: true }),
    ).toThrow();
  });
});
