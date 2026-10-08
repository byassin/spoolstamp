import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { MqttClient } from 'mqtt';
import { parseAmsSnapshot, type AmsSlot } from '../lib/ams.ts';
import { STATUS_REQUEST } from './ams-status-request.ts';
import { mqttPacketLimit } from './mqtt-limit.ts';
import {
  CloudAmsError,
  cloudEndpoints,
  type CloudRegion,
} from './cloud-ams-errors.ts';

export type CloudSnapshot = { updatedAt: number; slots: AmsSlot[] };
// Server-only transport. Call through the session, which rechecks ownership.
// Only one fixed status request is published; there is no control-command API.
export function readCloudSnapshot(options: {
  region: CloudRegion;
  serial: string;
  userId: string;
  token: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<CloudSnapshot> {
  const timeout = options.timeoutMs ?? 60000;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1000 ||
    timeout > 60000 ||
    !/^[A-Z0-9]{10,32}$/.test(options.serial) ||
    !/^\d{1,24}$/.test(options.userId) ||
    options.token.length < 16 ||
    options.token.length > 16384 ||
    !/^[\x21-\x7e]+$/.test(options.token)
  )
    return Promise.reject(new CloudAmsError('input'));
  if (options.signal?.aborted)
    return Promise.reject(new CloudAmsError('cancelled'));
  const { broker } = cloudEndpoints(options.region);
  return new Promise((resolve, reject) => {
    const password = Buffer.from(options.token);
    options.token = '';
    let socket: tls.TLSSocket | undefined;
    let client: MqttClient | undefined;
    let settled = false;
    const topic = `device/${options.serial}/report`;
    const withinLimit = mqttPacketLimit();
    const abort = () => finish(new CloudAmsError('cancelled'));
    const deadline = setTimeout(
      () => finish(new CloudAmsError('timeout')),
      timeout,
    );
    function finish(error?: CloudAmsError, snapshot?: CloudSnapshot) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', abort);
      password.fill(0);
      if (client) {
        client.options.password = undefined;
        client.end(true);
      }
      socket?.destroy();
      if (error) reject(error);
      else resolve(snapshot!);
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      client = new MqttClient(
        () => {
          socket = tls.connect({
            host: broker,
            servername: broker,
            port: 8883,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
          });
          socket.on('error', () => finish(new CloudAmsError('mqtt')));
          socket.on('data', (chunk: Buffer) => {
            if (!withinLimit(chunk)) finish(new CloudAmsError('mqtt'));
          });
          return socket;
        },
        {
          protocolVersion: 4,
          clientId: `spoolstamp-cloud-${Buffer.from(randomBytes(12)).toString('hex')}`,
          username: `u_${options.userId}`,
          password,
          clean: true,
          keepalive: 30,
          reconnectPeriod: 0,
          connectTimeout: 10000,
          resubscribe: false,
        },
      );
      client.on('error', () => finish(new CloudAmsError('mqtt')));
      client.on('close', () => finish(new CloudAmsError('mqtt')));
      client.on('message', (receivedTopic, payload, packet) => {
        if (
          settled ||
          receivedTopic !== topic ||
          packet.retain ||
          payload.length > 512 * 1024
        )
          return;
        try {
          const slots = parseAmsSnapshot(
            JSON.parse(Buffer.from(payload).toString('utf8')),
          );
          if (slots !== null)
            finish(undefined, { updatedAt: Date.now(), slots });
        } catch {
          /* Ignore malformed/incomplete telemetry; never log it. */
        }
      });
      client.once('connect', () => {
        if (settled) return;
        password.fill(0);
        client!.options.password = undefined;
        client!.subscribe(topic, { qos: 0 }, (error, granted) => {
          if (settled) return;
          if (error || granted?.length !== 1 || granted[0].qos === 128) {
            finish(new CloudAmsError('mqtt'));
            return;
          }
          client!.publish(
            `device/${options.serial}/request`,
            STATUS_REQUEST,
            { qos: 0, retain: false },
            (publishError) => {
              if (publishError) finish(new CloudAmsError('mqtt'));
            },
          );
        });
      });
    } catch {
      finish(new CloudAmsError('mqtt'));
    }
  });
}
