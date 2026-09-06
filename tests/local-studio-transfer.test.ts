import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import {
  createLocalStudioTransfer,
  localStudioTransfer,
} from '../scripts/local-studio-transfer';
import {
  STUDIO_TRANSFER_PATH,
  STUDIO_TRANSFER_TTL_MS,
  STUDIO_TRANSFER_MAX_BYTES,
} from '../lib/studio-handoff';

let clock = 0;
let origin: string;
let service: ReturnType<typeof createLocalStudioTransfer>;
let server: ReturnType<typeof createServer>;
let model: Uint8Array;
beforeEach(async () => {
  clock = Date.now();
  service = createLocalStudioTransfer(() => clock);
  server = createServer((request, response) => {
    void service.handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('_rels/.rels', '<Relationships/>');
  zip.file('3D/3dmodel.model', '<model/>');
  model = await zip.generateAsync({ type: 'uint8array' });
});
afterEach(async () => {
  service.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
function stage(headers: Record<string, string> = {}, body = model) {
  return fetch(`${origin}${STUDIO_TRANSFER_PATH}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Filament-Label-Transfer': '1',
      'X-Filename': 'label.3mf',
      'Content-Type': 'application/octet-stream',
      ...headers,
    },
    body: body.slice().buffer,
  });
}
async function staged() {
  const result = await stage();
  expect(result.status).toBe(201);
  return (await result.json()) as { path: string; expiresAt: number };
}

describe('local-only Studio transfer server', () => {
  it('binds the real Vite listener to IPv4 loopback for Studio downloads', async () => {
    const dev = await createViteServer({
      configFile: false,
      plugins: [localStudioTransfer()],
      server: { port: 0, strictPort: true, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await dev.listen();
      const address = dev.httpServer!.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      expect(address.family).toBe('IPv4');
      const localOrigin = `http://127.0.0.1:${address.port}`;
      const response = await fetch(localOrigin + STUDIO_TRANSFER_PATH, {
        method: 'POST',
        headers: {
          Origin: localOrigin,
          'X-Filament-Label-Transfer': '1',
          'X-Filename': 'label.3mf',
          'Content-Type': 'application/octet-stream',
        },
        body: model.slice().buffer,
      });
      expect(response.status).toBe(201);
      const transfer = (await response.json()) as { path: string };
      // Match Studio: IPv4-only GET with no browser Origin or write headers.
      const downloaded = await new Promise<Buffer>((resolve, reject) => {
        const request = httpRequest(
          `http://localhost:${address.port}${transfer.path}`,
          { family: 4 },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
              if (response.statusCode !== 200)
                reject(
                  new Error(`Studio download returned ${response.statusCode}`),
                );
              else resolve(Buffer.concat(chunks));
            });
            response.on('error', reject);
          },
        );
        request.on('error', reject);
        request.end();
      });
      expect(new Uint8Array(downloaded)).toEqual(model);
    } finally {
      await dev.close();
    }
  });

  it('is dev-only and advertises capability without listing files', async () => {
    expect(localStudioTransfer().apply).toBe('serve');
    expect(localStudioTransfer().enforce).toBe('pre');
    const response = await fetch(`${origin}${STUDIO_TRANSFER_PATH}`);
    expect(await response.json()).toEqual({
      available: true,
      expiresInMs: STUDIO_TRANSFER_TTL_MS,
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('round-trips identical bytes, supports HEAD and retries, and disables caching', async () => {
    const transfer = await staged();
    expect(transfer.path).toMatch(
      /^\/api\/local-studio\/files\/[a-f0-9]{64}\/label\.3mf$/,
    );
    const url = origin + transfer.path;
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(model.length));
    expect(await head.text()).toBe('');
    for (let retry = 0; retry < 2; retry++) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('model/3mf');
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="label.3mf"',
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(model);
    }
  });
  it('expires staged files and allows explicit same-origin revocation', async () => {
    const first = await staged();
    clock += STUDIO_TRANSFER_TTL_MS;
    expect((await fetch(origin + first.path)).status).toBe(404);
    const second = await staged();
    expect(
      (await fetch(origin + second.path, { method: 'DELETE' })).status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + second.path, {
          method: 'DELETE',
          headers: { Origin: origin, 'X-Filament-Label-Transfer': '1' },
        })
      ).status,
    ).toBe(204);
    expect((await fetch(origin + second.path)).status).toBe(404);
  });
  it('evicts old transfers instead of retaining an unbounded collection', async () => {
    const first = await staged();
    await staged();
    await staged();
    const latest = await staged();
    expect((await fetch(origin + first.path)).status).toBe(404);
    expect((await fetch(origin + latest.path)).status).toBe(200);
  });
  it.each<Record<string, string>>([
    { Origin: 'https://example.com' },
    { Origin: 'null' },
    { Origin: '' },
    { 'X-Filament-Label-Transfer': '' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'X-Forwarded-Host': 'localhost' },
  ])('rejects cross-origin and unauthenticated writes: %j', async (headers) => {
    expect((await stage(headers)).status).toBe(403);
  });
  it('rejects DNS rebinding and mismatched Host ports', async () => {
    for (const host of ['evil.test', 'localhost.evil.test', 'localhost:1']) {
      const response = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          origin + STUDIO_TRANSFER_PATH,
          { headers: { Host: host } },
          (response) => {
            response.resume();
            resolve(response.statusCode!);
          },
        );
        request.on('error', reject);
        request.end();
      });
      expect(response).toBe(403);
    }
  });
  it('rejects unsafe names, non-3MF data, and oversized bodies', async () => {
    expect((await stage({ 'X-Filename': '../label.3mf' })).status).toBe(400);
    expect((await stage({ 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(
      (await stage({}, new TextEncoder().encode('not a zip'))).status,
    ).toBe(400);
    expect(
      (await stage({}, new Uint8Array(STUDIO_TRANSFER_MAX_BYTES + 1))).status,
    ).toBe(413);
  });
  it('rejects browser cross-origin reads, unknown tokens, and extra URL arguments', async () => {
    const transfer = await staged();
    expect(
      (
        await fetch(origin + transfer.path, {
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(origin + transfer.path.replace('/files/', '/files/b')))
        .status,
    ).toBe(404);
    expect((await fetch(origin + transfer.path + '?other=yes')).status).toBe(
      400,
    );
  });

  it('drains an oversized chunked upload, returns 413, and releases the receiving slot', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        origin + STUDIO_TRANSFER_PATH,
        {
          method: 'POST',
          headers: {
            Origin: origin,
            'X-Filament-Label-Transfer': '1',
            'X-Filename': 'label.3mf',
            'Content-Type': 'application/octet-stream',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.write(new Uint8Array(STUDIO_TRANSFER_MAX_BYTES));
      request.end(new Uint8Array(1));
    });
    expect(status).toBe(413);
    expect((await stage()).status).toBe(201);
  });

  it('times out a slow unfinished upload even while bytes keep arriving', async () => {
    service = createLocalStudioTransfer(() => clock, 100);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        origin + STUDIO_TRANSFER_PATH,
        {
          method: 'POST',
          headers: {
            Origin: origin,
            'X-Filament-Label-Transfer': '1',
            'X-Filename': 'label.3mf',
            'Content-Type': 'application/octet-stream',
          },
        },
        (response) => {
          clearInterval(trickle);
          response.resume();
          response.on('end', () => {
            request.destroy();
            resolve(response.statusCode!);
          });
        },
      );
      request.on('error', (error) => {
        clearInterval(trickle);
        reject(error);
      });
      const trickle = setInterval(() => request.write('x'), 15);
      request.write('x');
    });
    expect(status).toBe(408);
    expect((await stage()).status).toBe(201);
  });
});
