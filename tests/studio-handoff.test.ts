import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLoopbackUrl,
  prepareStudioTransfer,
  revokeStudioTransfer,
  studioLaunchUrl,
  studioPlatform,
  STUDIO_TRANSFER_MAX_BYTES,
} from '../lib/studio-handoff';

const transfer = {
  path: `/api/local-studio/files/${'a'.repeat(64)}/pla-basic-green.3mf`,
  filename: 'pla-basic-green.3mf',
  expiresAt: Date.now() + 900_000,
};
afterEach(() => vi.unstubAllGlobals());

describe('local Studio links', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('encodes a Studio-downloadable 3MF URL for %s', (origin) => {
    // Studio's HTTP wrapper forces IPv4, even when Chrome uses IPv6 localhost.
    const download = `http://127.0.0.1:3000${transfer.path}`;
    expect(studioLaunchUrl(transfer, origin, 'windows')).toBe(
      `bambustudio://open?file=${encodeURIComponent(download)}`,
    );
    expect(studioLaunchUrl(transfer, origin, 'mac')).toBe(
      `bambustudioopen://${encodeURIComponent(download)}`,
    );
    expect(studioLaunchUrl(transfer, origin, 'linux')).toBe(
      studioLaunchUrl(transfer, origin, 'windows'),
    );
  });
  it.each([
    'https://example.com',
    'http://localhost.evil.test',
    'file:///label.3mf',
    'blob:http://localhost:3000/id',
    'http://name:secret@localhost:3000',
  ])('rejects a nonlocal or credentialed origin: %s', (origin) => {
    expect(isLoopbackUrl(origin)).toBe(false);
    expect(() => studioLaunchUrl(transfer, origin, 'windows')).toThrow();
  });
  it.each([
    'https://example.com/file.3mf',
    '//example.com/file.3mf',
    '/api/local-studio/files/../file.3mf',
    `${transfer.path}?extra=yes`,
    `${transfer.path}&file=other`,
  ])('rejects an unexpected transfer path: %s', (path) => {
    expect(() =>
      studioLaunchUrl(
        { ...transfer, path },
        'http://localhost:3000',
        'windows',
      ),
    ).toThrow();
  });
  it('selects desktop protocols and excludes mobile platforms', () => {
    expect(studioPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'windows',
    );
    expect(
      studioPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
    ).toBe('mac');
    expect(studioPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(studioPlatform('iPhone; CPU iPhone OS like Mac OS X')).toBeNull();
    expect(studioPlatform('Linux; Android 16')).toBeNull();
    expect(studioPlatform('unknown')).toBeNull();
  });
  it('stages bytes only on the same local origin and supports revocation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(transfer, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const blob = new Blob(['model bytes']);
    expect(
      await prepareStudioTransfer(
        blob,
        transfer.filename,
        'http://localhost:3000',
      ),
    ).toEqual(transfer);
    expect(fetcher.mock.calls[0][0].href).toBe(
      'http://localhost:3000/api/local-studio',
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: blob,
      redirect: 'error',
      credentials: 'omit',
    });
    await revokeStudioTransfer(transfer, 'http://localhost:3000');
    expect(fetcher.mock.calls[1][1].method).toBe('DELETE');
  });
  it('rejects oversized models before making a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      prepareStudioTransfer(
        { size: STUDIO_TRANSFER_MAX_BYTES + 1 } as Blob,
        transfer.filename,
        'http://localhost:3000',
      ),
    ).rejects.toThrow('too large');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports transfer failures without fabricating an open result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'Try again shortly.' }, { status: 429 }),
        ),
    );
    await expect(
      prepareStudioTransfer(
        new Blob(['model']),
        transfer.filename,
        'http://localhost:3000',
      ),
    ).rejects.toThrow('Try again shortly.');
  });
});
