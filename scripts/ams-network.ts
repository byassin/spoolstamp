import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { MqttClient } from 'mqtt';
import { mqttPacketLimit } from './mqtt-limit';

export type AmsConnection = { close(): void };
export type AmsTransportEvent =
  | 'request-sent'
  | 'message'
  | 'retained'
  | 'invalid';
// Only these fixed, non-private errors may cross the HTTP boundary.
export class AmsSerialMismatch extends Error {
  constructor() {
    super(
      'The printer serial does not match this printer’s certificate. Use the printer’s SN, not the AMS or AMS Hub SN, and check its IP address.',
    );
  }
}
export type AmsDriver = {
  probe(this: void, host: string): Promise<string>;
  connect(
    this: void,
    options: {
      host: string;
      serial: string;
      accessCode: string;
      fingerprint: string;
      onReport(value: unknown): void;
      onDiagnostic?(event: AmsTransportEvent): void;
      onClose(): void;
    },
  ): Promise<AmsConnection>;
};

// No arbitrary MQTT publish API. These are the only two request payloads.
export const STATUS_REQUEST = JSON.stringify({
  pushing: {
    sequence_id: '20001',
    command: 'pushall',
    version: 1,
    push_target: 1,
  },
});
export const VERSION_REQUEST = JSON.stringify({
  info: { sequence_id: '20002', command: 'get_version' },
});

async function openTls(host: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    // Printer certificates are locally issued. This unauthenticated connection
    // retrieves the fingerprint; authenticated use is gated by the approved pin
    // BEFORE MQTT is constructed and before any credential bytes are written.
    const socket = tls.connect({
      host,
      port: 8883,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    });
    const timer = setTimeout(() => fail(), 7000);
    function fail() {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error('Printer TLS connection failed.'));
    }
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      socket.off('error', fail);
      socket.on('error', () => undefined);
      resolve(socket);
    });
  });
}

export const lanAmsDriver: AmsDriver = {
  async probe(host) {
    const socket = await openTls(host);
    try {
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      if (!fingerprint) throw new Error('Missing certificate.');
      return fingerprint;
    } finally {
      socket.destroy();
    }
  },
  async connect(options) {
    const socket = await openTls(options.host);
    const certificate = socket.getPeerCertificate();
    if (certificate.fingerprint256 !== options.fingerprint) {
      socket.destroy();
      throw new Error('Printer certificate changed.');
    }
    // Some printers expose their serial as the certificate CN. Do not assume
    // a generic or absent CN is a serial, and never return the CN to the client.
    const commonName = certificate.subject?.CN;
    if (
      typeof commonName === 'string' &&
      /^[A-Z0-9]{10,32}$/.test(commonName) &&
      /\d/.test(commonName) &&
      commonName !== options.serial
    ) {
      socket.destroy();
      throw new AmsSerialMismatch();
    }
    return new Promise<AmsConnection>((resolve, reject) => {
      const password = Buffer.from(options.accessCode);
      options.accessCode = '';
      const withinLimit = mqttPacketLimit();
      socket.on('data', (chunk: Buffer) => {
        if (!withinLimit(chunk)) close();
      });
      const client = new MqttClient(() => socket, {
        protocolVersion: 4,
        clientId: `label-lab-${Buffer.from(randomBytes(8)).toString('hex')}`,
        username: 'bblp',
        password,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 0,
        connectTimeout: 8000,
        resubscribe: false,
      });
      const topic = `device/${options.serial}/report`;
      const requestTopic = `device/${options.serial}/request`;
      let interval: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      const deadline = setTimeout(() => close(), 10_000);
      function close() {
        if (closed) return;
        closed = true;
        clearTimeout(deadline);
        clearInterval(interval);
        password.fill(0);
        client.options.password = undefined;
        client.end(true);
        socket.destroy();
        options.onClose();
        reject(new Error('Printer MQTT connection failed.'));
      }
      client.on('error', close);
      client.on('close', close);
      client.on('message', (receivedTopic, payload, packet) => {
        // Retained telemetry may describe a previous session/spool.
        if (closed || receivedTopic !== topic) return;
        options.onDiagnostic?.('message');
        if (packet.retain) {
          options.onDiagnostic?.('retained');
          return;
        }
        if (payload.length > 512 * 1024) {
          options.onDiagnostic?.('invalid');
          return;
        }
        let report: unknown;
        try {
          report = JSON.parse(Buffer.from(payload).toString('utf8'));
        } catch {
          options.onDiagnostic?.('invalid');
          return;
        }
        options.onReport(report);
      });
      client.once('connect', () => {
        client.subscribe(topic, { qos: 0 }, (error, granted) => {
          if (
            error ||
            !granted?.length ||
            granted.some((item) => item.qos === 128)
          ) {
            close();
            return;
          }
          if (closed) return;
          clearTimeout(deadline);
          password.fill(0);
          client.options.password = undefined;
          function request(payload: string) {
            client.publish(
              requestTopic,
              payload,
              { qos: 0, retain: false },
              (error) => {
                if (closed) return;
                if (error) close();
                else options.onDiagnostic?.('request-sent');
              },
            );
          }
          request(VERSION_REQUEST);
          request(STATUS_REQUEST);
          interval = setInterval(() => request(STATUS_REQUEST), 30_000);
          interval.unref();
          resolve({ close });
        });
      });
    });
  },
};
