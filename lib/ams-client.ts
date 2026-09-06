import {
  AMS_HEADER,
  AMS_PATH,
  object,
  type AmsInventory,
  type AmsProbe,
} from './ams';
import { isLoopbackUrl } from './studio-handoff';

export async function amsRequest<T>(
  action = '',
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!isLoopbackUrl(window.location.origin))
    throw new Error('AMS pairing is available in the local edition only.');
  const options: RequestInit = {
    method,
    headers: {
      [AMS_HEADER]: '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(25_000),
  };
  const response = await fetch(AMS_PATH + action, options);
  const result = await response.json();
  const error = object(result)?.error;
  if (!response.ok)
    throw new Error(
      typeof error === 'string' ? error : 'AMS connection failed.',
    );
  return result as T;
}
export const readAms = (signal?: AbortSignal) =>
  amsRequest<AmsInventory>('', 'GET', undefined, signal);
export const probeAms = (host: string) =>
  amsRequest<AmsProbe>('/probe', 'POST', { host });
export const connectAms = (token: string, serial: string, accessCode: string) =>
  amsRequest<AmsInventory>('/connect', 'POST', { token, serial, accessCode });
export const disconnectAms = () => amsRequest<AmsInventory>('', 'DELETE');
