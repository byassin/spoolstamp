import type { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
type Socket = EventEmitter & { destroy: ReturnType<typeof vi.fn> };
type Client = EventEmitter & {
  options: { password?: Buffer; reconnectPeriod?: number };
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};
const harness = vi.hoisted(() => ({
  sockets: [] as Socket[],
  clients: [] as Client[],
  tlsOptions: [] as unknown[],
}));
vi.mock('node:tls', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: {
      connect: vi.fn((options) => {
        harness.tlsOptions.push(options);
        const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
        harness.sockets.push(socket);
        return socket;
      }),
    },
  };
});
vi.mock('mqtt', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    MqttClient: class extends EventEmitter {
      options: Client['options'];
      publish = vi.fn((_topic, _payload, _options, callback) =>
        callback?.(null),
      );
      subscribe = vi.fn((_topic, _options, callback) =>
        callback(null, [{ qos: 0 }]),
      );
      end = vi.fn(() => this.emit('close'));
      constructor(stream: () => unknown, options: Client['options']) {
        super();
        this.options = options;
        stream();
        harness.clients.push(this);
      }
    },
  };
});
import { readCloudSnapshot } from '../scripts/cloud-ams-network';
import { STATUS_REQUEST } from '../scripts/ams-status-request';
const options = () => ({
  region: 'global' as const,
  serial: 'TESTPRINTER123',
  userId: '12345',
  token: 'fake-only-secret-token-12345',
});
const TOPIC = 'device/TESTPRINTER123/report';
const REPORT = {
  print: {
    ams: {
      ams_exist_bits: '1',
      tray_exist_bits: '1',
      tray_reading_bits: '0',
      ams: [
        {
          id: '0',
          tray: [
            {
              id: '0',
              tray_type: 'PLA',
              tray_info_idx: 'GFA00',
              tray_color: 'FFFFFFFF',
              remain: 50,
              tag_uid: 'PRIVATE-TAG',
              tray_uuid: 'PRIVATE-UUID',
            },
          ],
        },
      ],
    },
  },
};
const emitReport = (
  client: Client,
  report: unknown = REPORT,
  topic = TOPIC,
  retain = false,
) =>
  client.emit('message', topic, Buffer.from(JSON.stringify(report)), {
    retain,
  });
beforeEach(() => {
  vi.useFakeTimers();
  harness.sockets.length = 0;
  harness.clients.length = 0;
  harness.tlsOptions.length = 0;
});
afterEach(() => vi.useRealTimers());
describe('bounded read-only cloud MQTT transport', () => {
  it('verifies vendor TLS, sends one fixed status request and strips private telemetry', async () => {
    const settings = options();
    const pending = readCloudSnapshot(settings);
    const client = harness.clients[0];
    const password = client.options.password!;
    expect(settings.token).toBe('');
    expect(harness.tlsOptions).toEqual([
      {
        host: 'us.mqtt.bambulab.com',
        servername: 'us.mqtt.bambulab.com',
        port: 8883,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
    ]);
    expect(client.options).toMatchObject({
      username: 'u_12345',
      clean: true,
      reconnectPeriod: 0,
      resubscribe: false,
    });
    client.emit('connect');
    expect(client.subscribe).toHaveBeenCalledWith(
      TOPIC,
      { qos: 0 },
      expect.any(Function),
    );
    expect(client.publish).toHaveBeenCalledExactlyOnceWith(
      'device/TESTPRINTER123/request',
      STATUS_REQUEST,
      { qos: 0, retain: false },
      expect.any(Function),
    );
    expect(client.options.password).toBeUndefined();
    expect(password.every((byte) => byte === 0)).toBe(true);
    emitReport(client);
    const snapshot = await pending;
    expect(snapshot.slots).toHaveLength(1);
    expect(snapshot.slots[0]).toMatchObject({
      label: 'A1',
      material: 'PLA',
      productId: 'GFA00',
      color: '#FFFFFFFF',
      remaining: 50,
      present: true,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /PRIVATE|token|serial|uuid|tag_uid/,
    );
    expect(client.end).toHaveBeenCalledOnce();
    expect(harness.sockets[0].destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000);
    expect(client.publish).toHaveBeenCalledOnce();
  });
  it('ignores retained, wrong-topic, oversized, malformed and delta reports', async () => {
    const pending = readCloudSnapshot(options());
    const client = harness.clients[0];
    client.emit('connect');
    emitReport(client, REPORT, 'device/OTHERPRINTER123/report');
    emitReport(client, REPORT, TOPIC, true);
    client.emit('message', TOPIC, Buffer.from('{'), {});
    client.emit('message', TOPIC, Buffer.alloc(600000), {});
    emitReport(client, { print: { msg: 1, ams: REPORT.print.ams } });
    emitReport(client, { print: {} });
    expect(client.end).not.toHaveBeenCalled();
    emitReport(client);
    await pending;
    expect(client.end).toHaveBeenCalledOnce();
  });
  it('bounds the entire TLS/MQTT/report wait and clears credentials even before connect', async () => {
    const pending = readCloudSnapshot({ ...options(), timeoutMs: 1000 });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    const password = harness.clients[0].options.password!;
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(password.every((byte) => byte === 0)).toBe(true);
    expect(harness.clients[0].end).toHaveBeenCalledOnce();
  });
  it('bounds MQTT wire packets before accumulation', async () => {
    const pending = readCloudSnapshot(options());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'mqtt' });
    harness.sockets[0].emit('data', Buffer.from([0x30, 0xff, 0xff, 0x7f]));
    await rejected;
    expect(harness.sockets[0].destroy).toHaveBeenCalledOnce();
  });
  it.each(['error', 'close'])(
    'sanitizes MQTT %s details and never retries',
    async (event) => {
      const pending = readCloudSnapshot(options());
      const rejected = expect(pending).rejects.toThrow(
        'Bambu Cloud telemetry connection failed.',
      );
      harness.clients[0].emit(event, new Error('PRIVATE-TOKEN IN ERROR'));
      await rejected;
      expect(harness.clients).toHaveLength(1);
    },
  );
  it('sanitizes TLS errors', async () => {
    const pending = readCloudSnapshot(options());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'mqtt' });
    harness.sockets[0].emit('error', new Error('private certificate detail'));
    await rejected;
  });
  it.each([{ granted: [] }, { granted: [{ qos: 128 }] }])(
    'does not publish after a denied subscription: %j',
    async ({ granted }) => {
      const pending = readCloudSnapshot(options());
      const rejected = expect(pending).rejects.toMatchObject({ code: 'mqtt' });
      const client = harness.clients[0];
      client.subscribe.mockImplementationOnce((_topic, _options, callback) =>
        callback(null, granted),
      );
      client.emit('connect');
      await rejected;
      expect(client.publish).not.toHaveBeenCalled();
    },
  );
  it('cleans up when the fixed status request fails', async () => {
    const pending = readCloudSnapshot(options());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'mqtt' });
    const client = harness.clients[0];
    client.publish.mockImplementationOnce(
      (_topic, _payload, _options, callback) =>
        callback(new Error('private detail')),
    );
    client.emit('connect');
    await rejected;
    expect(client.end).toHaveBeenCalledOnce();
  });
  it('cancels the active connection and ignores late connect events', async () => {
    const controller = new AbortController();
    const pending = readCloudSnapshot({
      ...options(),
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'cancelled',
    });
    controller.abort();
    await rejected;
    harness.clients[0].emit('connect');
    expect(harness.clients[0].subscribe).not.toHaveBeenCalled();
    expect(harness.clients[0].end).toHaveBeenCalledOnce();
  });
  it.each([
    { serial: 'evil/#' },
    { userId: 'evil/#' },
    { token: 'short' },
    { token: 'secret-with\na-newline' },
    { timeoutMs: 100000 },
  ])(
    'rejects unsafe transport input before opening a socket: %j',
    async (override) => {
      await expect(
        readCloudSnapshot({ ...options(), ...override }),
      ).rejects.toMatchObject({ code: 'input' });
      expect(harness.sockets).toHaveLength(0);
    },
  );
  it('does not open a socket for an already-aborted read', async () => {
    await expect(
      readCloudSnapshot({ ...options(), signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(harness.sockets).toHaveLength(0);
  });
  it('uses the China broker only when explicitly selected', async () => {
    const pending = readCloudSnapshot({ ...options(), region: 'china' });
    expect(harness.tlsOptions[0]).toMatchObject({
      host: 'cn.mqtt.bambulab.com',
      servername: 'cn.mqtt.bambulab.com',
    });
    emitReport(harness.clients[0]);
    await pending;
  });
});
