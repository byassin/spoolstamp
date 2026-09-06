import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalAms, validateAmsHost } from '../scripts/local-ams';
import { AmsSerialMismatch, type AmsDriver } from '../scripts/ams-network';
import {
  AMS_PATH,
  AMS_HEADER,
  type AmsInventory,
  type AmsProbe,
} from '../lib/ams';

let clock: number;
let service: ReturnType<typeof createLocalAms>;
let server: ReturnType<typeof createServer>;
let origin: string;
let driver: AmsDriver;
let callbacks: Parameters<AmsDriver['connect']>[0];
const close = vi.fn();
beforeEach(async () => {
  clock = Date.now();
  close.mockReset();
  driver = {
    probe: vi.fn(async () => 'AA:BB'),
    connect: vi.fn(async (options) => {
      callbacks = options;
      return { close };
    }),
  };
  service = createLocalAms(driver, () => clock);
  server = createServer(
    (request, response) => void service.handle(request, response),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  service.disconnect();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function api(
  action = '',
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const options: RequestInit = {
    method,
    headers: {
      Origin: origin,
      [AMS_HEADER]: '1',
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(origin + AMS_PATH + action, options);
}
async function pair() {
  const probeResponse = await api('/probe', 'POST', { host: '192.168.1.100' });
  expect(probeResponse.status).toBe(200);
  const probe = (await probeResponse.json()) as AmsProbe;
  clock += 3000;
  return api('/connect', 'POST', {
    token: probe.token,
    serial: 'TESTPRINTER123',
    accessCode: '12345678',
  });
}
async function readState(): Promise<AmsInventory> {
  return (await (await api()).json()) as AmsInventory;
}
describe('local AMS boundary', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '8.8.8.8',
    '0.0.0.0',
    '224.0.0.1',
    'localhost',
    'printer.local',
    'http://192.168.1.1',
    '192.168.1.1:80',
    '::1',
    '172.32.0.1',
  ])('rejects non-LAN or arbitrary destinations: %s', (host) =>
    expect(() => validateAmsHost(host)).toThrow(),
  );
  it.each(['192.168.1.100', '10.0.0.42', '172.16.0.2', '172.31.255.254'])(
    'accepts private IPv4: %s',
    (host) => expect(validateAmsHost(host)).toBe(host),
  );
  it('requires direct same-origin requests and the custom header', async () => {
    expect(
      (await api('', 'GET', undefined, { Origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect((await api('', 'GET', undefined, { [AMS_HEADER]: '' })).status).toBe(
      403,
    );
    expect(
      (await api('', 'GET', undefined, { 'X-Forwarded-Host': 'localhost' }))
        .status,
    ).toBe(403);
    expect(
      (await api('/probe', 'POST', { host: '192.168.1.100' }, { Origin: '' }))
        .status,
    ).toBe(403);
    expect(driver.probe).not.toHaveBeenCalled();
  });
  it('rejects a rebinding Host before any printer access', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        origin + AMS_PATH,
        { headers: { Host: 'evil.example', [AMS_HEADER]: '1' } },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(403);
  });
  it('pins a user-reviewed probe before sending credentials and redacts responses', async () => {
    const response = await pair();
    expect(response.status).toBe(200);
    expect(callbacks.fingerprint).toBe('AA:BB');
    expect(callbacks.host).toBe('192.168.1.100');
    const text = await response.text();
    expect(text).not.toContain('12345678');
    expect(text).not.toContain('TESTPRINTER123');
    expect(JSON.parse(text).connected).toBe(true);
  });
  it('rejects unapproved, expired or reused pairing tokens', async () => {
    expect(
      (
        await api('/connect', 'POST', {
          token: 'bad',
          serial: 'TESTPRINTER123',
          accessCode: '12345678',
        })
      ).status,
    ).toBe(400);
    clock += 3000;
    const probe = (await (
      await api('/probe', 'POST', { host: '10.0.0.42' })
    ).json()) as AmsProbe;
    clock += 181000;
    expect(
      (
        await api('/connect', 'POST', {
          token: probe.token,
          serial: 'TESTPRINTER123',
          accessCode: '12345678',
        })
      ).status,
    ).toBe(400);
    expect(driver.connect).not.toHaveBeenCalled();
  });
  it('rejects unknown commands and oversized input', async () => {
    expect(
      (await api('/print', 'POST', { command: 'project_file' })).status,
    ).toBe(404);
    expect(
      (await api('/probe', 'POST', { host: '10.0.0.1', command: 'anything' }))
        .status,
    ).toBe(400);
    expect(
      (await api('/probe', 'POST', { host: 'a'.repeat(3000) })).status,
    ).toBe(413);
    expect(driver.probe).not.toHaveBeenCalled();
  });
  it('rate limits probes and never leaks driver errors', async () => {
    driver.probe = vi.fn(async () => {
      throw new Error('private-access-code');
    });
    const response = await api('/probe', 'POST', { host: '10.0.0.1' });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private-access-code');
    expect((await api('/probe', 'POST', { host: '10.0.0.1' })).status).toBe(
      429,
    );
  });
  it('invalidates incomplete/delta snapshots and expires stale inventory', async () => {
    await pair();
    callbacks.onReport({ print: { msg: 0, ams: { ams: [] } } });
    let state = (await (await api()).json()) as AmsInventory;
    expect(state.stale).toBe(false);
    expect(state.slots).toEqual([]);
    callbacks.onReport({ print: { msg: 1, ams: { tray_exist_bits: '1' } } });
    state = (await (await api()).json()) as AmsInventory;
    expect(state.stale).toBe(true);
    callbacks.onReport({ print: { msg: 0, ams: { ams: [] } } });
    clock += 46000;
    expect(((await (await api()).json()) as AmsInventory).stale).toBe(true);
  });
  it('disconnects on idle and ignores late telemetry from retired connections', async () => {
    await pair();
    const old = callbacks;
    clock += 61000;
    service.prune();
    expect(close).toHaveBeenCalledOnce();
    old.onReport({ print: { ams: { ams: [] } } });
    const state = (await (await api()).json()) as AmsInventory;
    expect(state.connected).toBe(false);
    expect(state.updatedAt).toBeNull();
  });
  it('cancels a pending certificate probe on disconnect', async () => {
    let resolveProbe!: (value: string) => void;
    driver.probe = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const pending = api('/probe', 'POST', { host: '10.0.0.42' });
    await vi.waitFor(() => expect(driver.probe).toHaveBeenCalled());
    await api('', 'DELETE');
    resolveProbe('AA');
    expect((await pending).status).toBe(409);
  });
  it('ends a silent subscription after 60 seconds and retains only safe diagnostics', async () => {
    await pair();
    callbacks.onDiagnostic?.('request-sent');
    clock += 59000;
    expect((await readState()).connected).toBe(true);
    clock += 1000;
    const state = await readState();
    expect(state.connected).toBe(false);
    expect(state.message).toContain('No printer reports arrived');
    expect(state.diagnostics!.requestsSent).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    callbacks.onDiagnostic?.('message');
    expect((await readState()).diagnostics!.messagesReceived).toBe(0);
  });
  it.each([
    [
      'incomplete',
      { print: { msg: 1, ams: { tray_exist_bits: '1' } } },
      'incomplete or unsupported',
    ],
    [
      'without AMS',
      { print: { command: 'push_status' } },
      'no complete AMS inventory',
    ],
  ])(
    'distinguishes received %s reports from no reports',
    async (_label, report, message) => {
      await pair();
      callbacks.onDiagnostic?.('message');
      callbacks.onReport(report);
      clock += 30000;
      await api();
      clock += 30000;
      const state = await readState();
      expect(state.message).toContain(message);
      expect(state.connected).toBe(false);
    },
  );
  it('does not time out a fresh empty AMS snapshot or call it missing data', async () => {
    await pair();
    callbacks.onReport({ print: { ams: { ams: [] } } });
    clock += 30000;
    await api();
    clock += 30000;
    const state = await readState();
    expect(state.connected).toBe(true);
    expect(state.stale).toBe(true);
    expect(state.message).toContain('out of date');
    expect(state.diagnostics!.fullSnapshots).toBe(1);
    callbacks.onReport({ print: { ams: { ams: [] } } });
    expect((await readState()).message).toContain('No AMS slots reported');
  });
  it('exposes the fixed serial mismatch explanation without certificate details', async () => {
    driver.connect = vi.fn(async () => {
      throw new AmsSerialMismatch();
    });
    const response = await pair();
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('serial does not match');
    expect(text).not.toContain('TESTPRINTER123');
    expect(text).not.toContain('12345678');
  });
});
