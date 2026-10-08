import type { HostedCloudState } from './cloud-ams';
import { object } from './ams';
class BrowserCloudError extends Error {}

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
              : 'Cloud request failed. Check the code or try again later.',
      );
    const value = object(await response.json());
    if (method === 'DELETE') {
      csrf = '';
      return null;
    }
    const inventory = object(value?.inventory);
    if (
      !value ||
      typeof value.csrf !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.csrf) ||
      typeof value.authenticated !== 'boolean' ||
      !Array.isArray(value.printers) ||
      !inventory ||
      !Array.isArray(inventory.slots)
    )
      throw new BrowserCloudError('Unexpected cloud service response.');
    if (attempt === revision) csrf = value.csrf;
    return value as HostedCloudState;
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
