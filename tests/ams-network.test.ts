import type { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mqttPacketLimit } from '../scripts/mqtt-limit';
type TestSocket = EventEmitter & {
  fingerprint: string;
  commonName?: string;
  destroy: ReturnType<typeof vi.fn>;
};
type TestClient = EventEmitter & {
  options: { password?: unknown };
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};
const harness = vi.hoisted(() => ({
  sockets: [] as TestSocket[],
  clients: [] as TestClient[],
}));
vi.mock('node:tls', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: {
      connect: vi.fn(() => {
        const socket = Object.assign(new EventEmitter(), {
          fingerprint: 'approved',
          commonName: undefined as string | undefined,
          getPeerCertificate() {
            return {
              fingerprint256: this.fingerprint,
              subject: { CN: this.commonName },
            };
          },
          destroy: vi.fn(),
        });
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
      options: { password?: unknown };
      publish = vi.fn((_topic, _payload, _options, callback) =>
        callback?.(null),
      );
      subscribe = vi.fn((_topic, _options, callback) =>
        callback(null, [{ qos: 0 }]),
      );
      end = vi.fn(() => this.emit('close'));
      constructor(stream: () => unknown, options: { password?: unknown }) {
        super();
        stream();
        this.options = options;
        harness.clients.push(this);
      }
    },
  };
});
import {
  lanAmsDriver,
  STATUS_REQUEST,
  VERSION_REQUEST,
} from '../scripts/ams-network';
beforeEach(() => {
  vi.useFakeTimers();
  harness.sockets.length = 0;
  harness.clients.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});
const options = () => ({
  host: '192.168.1.100',
  serial: 'TESTPRINTER123',
  accessCode: '12345678',
  fingerprint: 'approved',
  onReport: vi.fn(),
  onClose: vi.fn(),
  onDiagnostic: vi.fn(),
});
async function connected() {
  const settings = options();
  const pending = lanAmsDriver.connect(settings);
  const socket = harness.sockets[0];
  socket.emit('secureConnect');
  await vi.waitFor(() => expect(harness.clients).toHaveLength(1));
  const client = harness.clients[0];
  client.emit('connect');
  return { connection: await pending, client, socket, settings };
}
describe('read-only pinned LAN adapter', () => {
  it('does not construct MQTT or send credentials during an unauthenticated probe', async () => {
    const pending = lanAmsDriver.probe('192.168.1.100');
    expect(harness.clients).toHaveLength(0);
    harness.sockets[0].emit('secureConnect');
    expect(await pending).toBe('approved');
    expect(harness.sockets[0].destroy).toHaveBeenCalled();
    expect(harness.clients).toHaveLength(0);
  });
  it('fails before MQTT construction if the certificate changed', async () => {
    const pending = lanAmsDriver.connect(options());
    const rejected = expect(pending).rejects.toThrow('certificate changed');
    harness.sockets[0].fingerprint = 'attacker';
    harness.sockets[0].emit('secureConnect');
    await rejected;
    expect(harness.clients).toHaveLength(0);
  });
  it('subscribes to one serial and publishes only bounded read-only requests', async () => {
    const { connection, client, settings } = await connected();
    expect(client.subscribe).toHaveBeenCalledWith(
      'device/TESTPRINTER123/report',
      { qos: 0 },
      expect.any(Function),
    );
    expect(client.options.password).toBeUndefined();
    expect(settings.onDiagnostic.mock.calls).toEqual([
      ['request-sent'],
      ['request-sent'],
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.publish.mock.calls.map((call) => call[1])).toEqual([
      VERSION_REQUEST,
      STATUS_REQUEST,
      STATUS_REQUEST,
      STATUS_REQUEST,
    ]);
    for (const call of client.publish.mock.calls)
      expect(call[0]).toBe('device/TESTPRINTER123/request');
    connection.close();
    const count = client.publish.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.publish).toHaveBeenCalledTimes(count);
    expect(settings.onClose).toHaveBeenCalledOnce();
  });
  it('drops retained, oversized, malformed and wrong-topic messages', async () => {
    const { connection, client, settings } = await connected();
    client.emit('message', 'wrong', Buffer.from('{}'), {});
    client.emit('message', 'device/TESTPRINTER123/report', Buffer.from('{}'), {
      retain: true,
    });
    client.emit(
      'message',
      'device/TESTPRINTER123/report',
      Buffer.alloc(600000),
      {},
    );
    client.emit(
      'message',
      'device/TESTPRINTER123/report',
      Buffer.from('{'),
      {},
    );
    expect(settings.onReport).not.toHaveBeenCalled();
    expect(settings.onDiagnostic.mock.calls.map(([event]) => event)).toEqual([
      'request-sent',
      'request-sent',
      'message',
      'retained',
      'message',
      'invalid',
      'message',
      'invalid',
    ]);
    client.emit(
      'message',
      'device/TESTPRINTER123/report',
      Buffer.from('{"print":{}}'),
      {},
    );
    expect(settings.onReport).toHaveBeenCalledWith({ print: {} });
    connection.close();
  });
  it('rejects oversized wire packets before they are accumulated by MQTT', async () => {
    const { socket, settings } = await connected();
    socket.emit('data', Buffer.from([0x30, 0xff, 0xff, 0x7f]));
    expect(socket.destroy).toHaveBeenCalled();
    expect(settings.onClose).toHaveBeenCalledOnce();
  });
  it('bounds the TLS handshake wait', async () => {
    const pending = lanAmsDriver.probe('192.168.1.100');
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(7001);
    await rejected;
    expect(harness.sockets[0].destroy).toHaveBeenCalled();
  });
  it('rejects a different serial-like certificate CN before authentication', async () => {
    const pending = lanAmsDriver.connect(options());
    const rejected = expect(pending).rejects.toThrow('serial does not match');
    harness.sockets[0].commonName = 'OTHERPRINTER123';
    harness.sockets[0].emit('secureConnect');
    await rejected;
    expect(harness.clients).toHaveLength(0);
    expect(harness.sockets[0].destroy).toHaveBeenCalled();
  });
  it.each(['TESTPRINTER123', 'BAMBULABPRINTER', undefined])(
    'allows a matching serial or generic/absent CN: %s',
    async (commonName) => {
      const pending = lanAmsDriver.connect(options());
      harness.sockets[0].commonName = commonName;
      harness.sockets[0].emit('secureConnect');
      await vi.waitFor(() => expect(harness.clients).toHaveLength(1));
      harness.clients[0].emit('connect');
      (await pending).close();
    },
  );
  it('closes when a read request cannot be written', async () => {
    const { client, settings } = await connected();
    client.publish.mockImplementationOnce(
      (_topic, _payload, _options, callback) =>
        callback(new Error('private socket detail')),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settings.onClose).toHaveBeenCalledOnce();
  });
});
describe('MQTT packet bound', () => {
  it('handles split headers, bodies and multiple packets per read', () => {
    const limit = mqttPacketLimit(256);
    expect(limit(new Uint8Array([0x30, 0x80]))).toBe(true);
    expect(limit(new Uint8Array([1, ...Array(128).fill(0), 0xd0, 0]))).toBe(
      true,
    );
    expect(limit(new Uint8Array([0x30, 0x81, 2]))).toBe(false);
  });
  it('rejects malformed remaining-length continuations', () =>
    expect(
      mqttPacketLimit()(new Uint8Array([0x30, 0x80, 0x80, 0x80, 0x80])),
    ).toBe(false));
});
