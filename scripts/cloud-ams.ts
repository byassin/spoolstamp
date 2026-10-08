import { object } from '../lib/ams.ts';
import {
  CloudAmsError,
  cloudDisplayText,
  cloudEndpoints,
  type CloudRegion,
  type CloudResponseDiagnostic,
} from './cloud-ams-errors.ts';
import { readCloudSnapshot } from './cloud-ams-network.ts';
export { CloudAmsError, type CloudRegion } from './cloud-ams-errors.ts';
export type CloudPrinter = {
  serial: string;
  name: string;
  model: string;
  online: boolean;
};
const validSerial = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z0-9]{10,32}$/.test(value);
const validToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 16 &&
  value.length <= 16384 &&
  /^[\x21-\x7e]+$/.test(value);
const validEmail = (email: string) =>
  email.length <= 254 &&
  cloudDisplayText(email, 254) === email &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function boundedPayload(
  response: Response,
): Promise<{ value: unknown; empty: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { value: null, empty: true };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024) throw new CloudAmsError('response');
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return { value: null, empty: true };
    return { value: JSON.parse(text), empty: false };
  } catch {
    throw new CloudAmsError('response');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Server-only credentials, fixed vendor hosts, no persistence, impersonation,
// challenge bypass, or automatic retries. Never import this into browser code.
export function createCloudAmsSession(
  region: CloudRegion,
  fetcher: typeof fetch = fetch,
  options: { signal?: AbortSignal } = {},
) {
  const endpoints = cloudEndpoints(region);
  let token = '';
  let revision = 0;
  async function request(path: string, body?: unknown, authenticate = false) {
    if (authenticate && !token) throw new CloudAmsError('authentication');
    const operation: CloudResponseDiagnostic['operation'] = path.endsWith(
      '/sendemail/code',
    )
      ? 'email-code'
      : path.endsWith('/login')
        ? 'login'
        : path.endsWith('/bind')
          ? 'printers'
          : 'preference';
    try {
      const response = await fetcher(endpoints.api + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'User-Agent':
            'Spoolstamp/0.1 (+https://github.com/byassin/spoolstamp)',
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authenticate ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      if ([403, 418, 429].includes(response.status)) {
        await response.body?.cancel();
        throw new CloudAmsError('blocked');
      }
      if ([400, 401].includes(response.status)) {
        await response.body?.cancel();
        throw new CloudAmsError('authentication');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CloudAmsError('network');
      }
      // Email acknowledgement is not the same contract as an authenticated
      // JSON data endpoint. Community clients check its HTTP status only.
      // Accept empty/null acknowledgements, but never hide explicit failures.
      let payload: Awaited<ReturnType<typeof boundedPayload>>;
      const diagnostic: CloudResponseDiagnostic = {
        operation,
        status: response.status,
        body: 'unreadable',
        apiCode: 'absent',
        success: 'absent',
        error: 'absent',
      };
      try {
        payload = await boundedPayload(response);
      } catch {
        throw new CloudAmsError('response', diagnostic);
      }
      const result = object(payload.value);
      diagnostic.body = payload.empty
        ? 'empty'
        : result
          ? 'json-object'
          : payload.value === null
            ? 'json-null'
            : 'json-other';
      if (result) {
        diagnostic.apiCode =
          result.code === undefined
            ? 'absent'
            : result.code === null
              ? 'null'
              : result.code === 0 || result.code === '0'
                ? 'zero'
                : result.code === 200 || result.code === '200'
                  ? 'http-success'
                  : typeof result.code === 'number'
                    ? 'other-number'
                    : typeof result.code === 'string'
                      ? 'other-string'
                      : 'other';
        diagnostic.success =
          result.success === undefined
            ? 'absent'
            : result.success === true
              ? 'true'
              : result.success === false
                ? 'false'
                : 'other';
        diagnostic.error =
          result.error === undefined ||
          result.error === null ||
          result.error === ''
            ? 'absent'
            : 'present';
      }
      const acknowledgement =
        operation === 'email-code' && [200, 204].includes(response.status);
      if (!result) {
        if (acknowledgement && (payload.empty || payload.value === null))
          return {};
        throw new CloudAmsError('response', diagnostic);
      }
      if (
        diagnostic.success === 'false' ||
        diagnostic.error === 'present' ||
        (!['absent', 'null', 'zero'].includes(diagnostic.apiCode) &&
          !(acknowledgement && diagnostic.apiCode === 'http-success'))
      )
        throw new CloudAmsError('response', diagnostic);
      return result;
    } catch (error) {
      if (error instanceof CloudAmsError) throw error;
      throw new CloudAmsError('network');
    }
  }
  async function printers(): Promise<CloudPrinter[]> {
    const result = await request(
      '/v1/iot-service/api/user/bind',
      undefined,
      true,
    );
    if (!Array.isArray(result.devices) || result.devices.length > 200)
      throw new CloudAmsError('response');
    const seen = new Set<string>();
    return result.devices.map((raw) => {
      const device = object(raw);
      if (
        !device ||
        !validSerial(device.dev_id) ||
        typeof device.online !== 'boolean' ||
        seen.has(device.dev_id)
      )
        throw new CloudAmsError('response');
      seen.add(device.dev_id);
      return {
        serial: device.dev_id,
        name: cloudDisplayText(device.name),
        model: cloudDisplayText(device.dev_product_name),
        online: device.online,
      };
    });
  }
  return {
    async requestEmailCode(email: string) {
      if (!validEmail(email) || region !== 'global')
        throw new CloudAmsError('input');
      await request('/v1/user-service/user/sendemail/code', {
        email,
        type: 'codeLogin',
      });
    },
    async loginWithEmailCode(email: string, code: string) {
      const attempt = ++revision;
      token = '';
      if (!validEmail(email) || !/^\d{6}$/.test(code) || region !== 'global')
        throw new CloudAmsError('input');
      const result = await request('/v1/user-service/user/login', {
        account: email,
        code,
      });
      if (!validToken(result.accessToken))
        throw new CloudAmsError('authentication');
      if (attempt !== revision) throw new CloudAmsError('cancelled');
      token = result.accessToken;
    },
    useAccessToken(value: string) {
      revision++;
      token = '';
      if (!validToken(value)) throw new CloudAmsError('input');
      token = value;
    },
    // Server-only persistence boundary. Callers provide encryption, never a
    // plaintext export. The browser must not import this module.
    async sealAccessToken(seal: (value: string) => Promise<string>) {
      if (!token) throw new CloudAmsError('authentication');
      return seal(token);
    },
    printers,
    async snapshot(
      serial: string,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) {
      const attempt = revision;
      if (!validSerial(serial)) throw new CloudAmsError('input');
      if (options.signal?.aborted) throw new CloudAmsError('cancelled');
      // Every read checks account ownership; raw API devices/access codes never
      // cross this boundary, and a browser-supplied serial is not authorization.
      const device = (await printers()).find((item) => item.serial === serial);
      if (!device) throw new CloudAmsError('ownership');
      if (!device.online) throw new CloudAmsError('offline');
      const preference = await request(
        '/v1/design-user-service/my/preference',
        undefined,
        true,
      );
      const uid = preference.uid;
      if (attempt !== revision || options.signal?.aborted)
        throw new CloudAmsError('cancelled');
      if (
        !(typeof uid === 'string' && /^\d{1,24}$/.test(uid)) &&
        !(typeof uid === 'number' && Number.isSafeInteger(uid) && uid >= 0)
      )
        throw new CloudAmsError('response');
      return readCloudSnapshot({
        ...options,
        region,
        serial,
        userId: String(uid),
        token,
      });
    },
    close() {
      revision++;
      token = '';
    },
  };
}
