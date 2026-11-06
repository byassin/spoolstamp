import type { HostedCloudState, HostedCloudPrinter } from './cloud-ams';
import type { AmsSlot } from './ams';
import { object } from './ams';
class BrowserCloudError extends Error {}

const unexpected = () =>
  new BrowserCloudError('Unexpected cloud service response.');
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000;
const displayText = (value: unknown, maximum = 100): value is string =>
  typeof value === 'string' &&
  value.length <= maximum &&
  Array.from(value).every((character) => {
    const code = character.codePointAt(0)!;
    return code >= 32 && (code < 127 || code > 159);
  });
const serial = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z0-9]{10,32}$/.test(value);
const rgba = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9A-F]{8}$/.test(value);

/** Validate before UI consumers dereference nested fields, and retain only public fields. */
function publicState(input: unknown): HostedCloudState {
  const value = object(input);
  const inventory = object(value?.inventory);
  if (
    !value ||
    typeof value.csrf !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.csrf) ||
    typeof value.authenticated !== 'boolean' ||
    typeof value.codeRequested !== 'boolean' ||
    typeof value.pending !== 'boolean' ||
    !timestamp(value.expiresAt) ||
    !timestamp(value.refreshAfter) ||
    !(value.selectedSerial === null || serial(value.selectedSerial)) ||
    !Array.isArray(value.printers) ||
    value.printers.length > 200 ||
    !inventory ||
    typeof inventory.available !== 'boolean' ||
    typeof inventory.connected !== 'boolean' ||
    typeof inventory.stale !== 'boolean' ||
    !(inventory.updatedAt === null || timestamp(inventory.updatedAt)) ||
    !(inventory.printerName === null || displayText(inventory.printerName)) ||
    !(inventory.firmware === null || displayText(inventory.firmware)) ||
    !displayText(inventory.message, 512) ||
    !Array.isArray(inventory.slots) ||
    inventory.slots.length > 128
  )
    throw unexpected();
  const printerIds = new Set<string>();
  const printers: HostedCloudPrinter[] = value.printers.map(
    (inputPrinter: unknown) => {
      const row = object(inputPrinter);
      if (
        !row ||
        !serial(row.serial) ||
        printerIds.has(row.serial) ||
        !displayText(row.name) ||
        !displayText(row.model) ||
        typeof row.online !== 'boolean'
      )
        throw unexpected();
      printerIds.add(row.serial);
      return {
        serial: row.serial,
        name: row.name,
        model: row.model,
        online: row.online,
      };
    },
  );
  if (
    value.authenticated &&
    value.selectedSerial !== null &&
    !printerIds.has(value.selectedSerial)
  )
    throw unexpected();
  const slotIds = new Set<string>();
  const slots: AmsSlot[] = inventory.slots.map((inputSlot: unknown) => {
    const row = object(inputSlot);
    if (
      !row ||
      typeof row.unit !== 'string' ||
      !/^(0|[1-9]\d{0,2})$/.test(row.unit) ||
      typeof row.slot !== 'string' ||
      !/^(0|[1-9]\d{0,2})$/.test(row.slot) ||
      row.key !== `${row.unit}:${row.slot}` ||
      slotIds.has(row.key) ||
      !displayText(row.label) ||
      !row.label ||
      !(row.present === null || typeof row.present === 'boolean') ||
      typeof row.reading !== 'boolean' ||
      !displayText(row.material) ||
      !displayText(row.productId) ||
      !(row.color === null || rgba(row.color)) ||
      !Array.isArray(row.colors) ||
      row.colors.length > 8 ||
      !row.colors.every(rgba) ||
      !(
        row.remaining === null ||
        (typeof row.remaining === 'number' &&
          Number.isFinite(row.remaining) &&
          row.remaining >= 0 &&
          row.remaining <= 100)
      )
    )
      throw unexpected();
    slotIds.add(row.key);
    return {
      key: row.key,
      unit: row.unit,
      slot: row.slot,
      label: row.label,
      present: row.present,
      reading: row.reading,
      material: row.material,
      productId: row.productId,
      color: row.color,
      colors: [...row.colors],
      remaining: row.remaining,
    };
  });
  return {
    csrf: value.csrf,
    authenticated: value.authenticated,
    codeRequested: value.codeRequested,
    expiresAt: value.expiresAt,
    printers,
    selectedSerial: value.selectedSerial,
    pending: value.pending,
    refreshAfter: value.refreshAfter,
    inventory: {
      available: inventory.available,
      connected: inventory.connected,
      printerName: inventory.printerName,
      firmware: inventory.firmware,
      updatedAt: inventory.updatedAt,
      stale: inventory.stale,
      slots,
      message: inventory.message,
    },
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unexpected();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512 * 1024) throw unexpected();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Public configuration only. Credentials never belong in a VITE_ variable. */
export function validateCloudApiOrigin(
  value: string | undefined,
  appOrigin: string,
): string | null {
  if (!value) return null;
  try {
    const api = new URL(value);
    const app = new URL(appOrigin);
    if (
      api.origin !== value ||
      api.origin === app.origin ||
      api.username ||
      api.password
    )
      return null;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname);
    if (
      loopback &&
      ['http:', 'https:'].includes(app.protocol) &&
      api.hostname === app.hostname &&
      api.protocol === app.protocol
    )
      return api.origin;
    // Same-site, separate HTTPS API host. Cookies are host-only, never shared
    // with the website. This intentionally rejects unrelated/third-party hosts.
    if (
      app.protocol === 'https:' &&
      api.protocol === 'https:' &&
      !api.port &&
      api.hostname.endsWith(`.${app.hostname}`)
    )
      return api.origin;
  } catch {
    /* Invalid public configuration: show manual picker fallback. */
  }
  return null;
}

export function createHostedAmsClient(origin: string) {
  let csrf = '';
  let revision = 0;
  async function send(
    path: string,
    method = 'GET',
    input?: unknown,
    signal?: AbortSignal,
  ) {
    const attempt = method === 'GET' ? revision : ++revision;
    const response = await fetch(origin + path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        ...(method === 'GET' ? {} : { 'X-Spoolstamp-CSRF': csrf }),
        ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    // Only display fixed own-service errors, never arbitrary HTTP/vendor text.
    if (!response.ok)
      throw new BrowserCloudError(
        response.status === 429
          ? 'Request limit reached. Wait five minutes before retrying; email and sign-in limits may take longer.'
          : response.status === 401
            ? 'Sign-in failed or session expired. Request a fresh code and sign in again.'
            : response.status === 403
              ? 'Session or printer ownership check failed. Reload and sign in again.'
              : [502, 503, 504].includes(response.status)
                ? 'Cloud service is temporarily unavailable. Use your saved drafts or the manual picker and try again later.'
                : 'Cloud request failed. Check the code or try again later.',
      );
    const payload = await boundedJson(response);
    if (method === 'DELETE') {
      csrf = '';
      return null;
    }
    const value = publicState(payload);
    if (attempt === revision) csrf = value.csrf;
    return value;
  }
  async function request(
    path: string,
    method = 'GET',
    input?: unknown,
    signal?: AbortSignal,
  ) {
    try {
      return await send(path, method, input, signal);
    } catch (error) {
      if (error instanceof BrowserCloudError) throw error;
      throw new BrowserCloudError(
        'Cloud service could not be reached or returned an invalid response. Try later.',
      );
    }
  }
  return {
    read: (signal?: AbortSignal) =>
      request(
        '/session',
        'GET',
        undefined,
        signal,
      ) as Promise<HostedCloudState>,
    sendCode: (email: string, signal?: AbortSignal) =>
      request(
        '/email-code',
        'POST',
        { email, consent: true },
        signal,
      ) as Promise<HostedCloudState>,
    login: (code: string, signal?: AbortSignal) =>
      request('/login', 'POST', { code }, signal) as Promise<HostedCloudState>,
    snapshot: (serial: string, signal?: AbortSignal) =>
      request(
        '/snapshot',
        'POST',
        { serial },
        signal,
      ) as Promise<HostedCloudState>,
    logout: (signal?: AbortSignal) =>
      request('/session', 'DELETE', undefined, signal),
  };
}
