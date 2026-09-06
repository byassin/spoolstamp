export const STUDIO_TRANSFER_PATH = '/api/local-studio';
export const STUDIO_TRANSFER_TTL_MS = 15 * 60 * 1000;
export const STUDIO_TRANSFER_MAX_BYTES = 16 * 1024 * 1024;
export const STUDIO_TRANSFER_HEADER = 'X-Filament-Label-Transfer';
export const STUDIO_LOOPBACK_HOST = '127.0.0.1';

export type StudioTransfer = {
  path: string;
  filename: string;
  expiresAt: number;
};

export function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function studioPlatform(
  userAgent: string,
): 'windows' | 'mac' | 'linux' | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Linux/i.test(userAgent)) return 'linux';
  return null;
}

export function studioLaunchUrl(
  transfer: StudioTransfer,
  origin: string,
  platform: 'windows' | 'mac' | 'linux',
) {
  if (
    !isLoopbackUrl(origin) ||
    !/^\/api\/local-studio\/files\/[a-f0-9]{64}\/[a-z0-9][a-z0-9_-]{0,119}\.3mf$/.test(
      transfer.path,
    )
  )
    throw new Error('Invalid local Studio transfer.');
  const url = new URL(transfer.path, origin);
  // Studio's libcurl wrapper forces IPv4; browsers may resolve localhost to ::1.
  url.hostname = STUDIO_LOOPBACK_HOST;
  return platform === 'mac'
    ? `bambustudioopen://${encodeURIComponent(url.href)}`
    : `bambustudio://open?file=${encodeURIComponent(url.href)}`;
}

export async function prepareStudioTransfer(
  blob: Blob,
  filename: string,
  origin: string,
  signal?: AbortSignal,
): Promise<StudioTransfer> {
  if (!isLoopbackUrl(origin))
    throw new Error('Studio handoff is available only in the local app.');
  if (blob.size > STUDIO_TRANSFER_MAX_BYTES)
    throw new Error(
      'This model is too large for local transfer. Download the 3MF instead.',
    );
  const response = await fetch(new URL(STUDIO_TRANSFER_PATH, origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      [STUDIO_TRANSFER_HEADER]: '1',
      'X-Filename': filename,
    },
    body: blob,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      message?.error || 'Local transfer failed. Download the 3MF instead.',
    );
  }
  const transfer = (await response.json()) as StudioTransfer;
  studioLaunchUrl(transfer, origin, 'windows');
  if (
    transfer.filename !== filename ||
    !Number.isFinite(transfer.expiresAt) ||
    transfer.expiresAt <= Date.now()
  )
    throw new Error('The local transfer expired. Try again.');
  return transfer;
}

export async function revokeStudioTransfer(
  transfer: StudioTransfer,
  origin: string,
) {
  studioLaunchUrl(transfer, origin, 'windows');
  await fetch(new URL(transfer.path, origin), {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
    headers: { [STUDIO_TRANSFER_HEADER]: '1' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
}
