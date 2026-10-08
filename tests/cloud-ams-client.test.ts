import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHostedAmsClient,
  validateCloudApiOrigin,
} from '../lib/cloud-ams-client';

const APP = 'https://spoolstamp.bourhan.org';
const API = 'https://ams.spoolstamp.bourhan.org';
const state = (csrf = 'a'.repeat(64)) => ({
  csrf,
  authenticated: false,
  printers: [],
  inventory: { slots: [] },
});
afterEach(() => vi.unstubAllGlobals());
describe('browser cloud client', () => {
  it('sanitizes fetch and malformed-JSON errors too', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('PRIVATE-TOKEN'))
      .mockResolvedValueOnce(new Response('PRIVATE-TOKEN'));
    vi.stubGlobal('fetch', fetcher);
    const client = createHostedAmsClient(API);
    for (let i = 0; i < 2; i++)
      await expect(client.read()).rejects.toThrow(
        'Cloud service could not be reached or returned an invalid response.',
      );
  });
  it('permits only same-site child HTTPS origins or explicit same-host loopback development', () => {
    expect(validateCloudApiOrigin(API, APP)).toBe(API);
    expect(
      validateCloudApiOrigin('http://localhost:3100', 'http://localhost:3000'),
    ).toBe('http://localhost:3100');
    expect(
      validateCloudApiOrigin('http://127.0.0.1:3100', 'http://127.0.0.1:3000'),
    ).toBe('http://127.0.0.1:3100');
    for (const value of [
      undefined,
      APP,
      'https://evil.example',
      API + '/path',
      API + '/',
      'http://ams.spoolstamp.bourhan.org',
      'https://user@ams.spoolstamp.bourhan.org',
      'https://ams.spoolstamp.bourhan.org.evil.example',
      'https://ams.spoolstamp.bourhan.org:8443',
      'javascript:alert(1)',
      'http://localhost:3100',
    ])
      expect(validateCloudApiOrigin(value, APP)).toBeNull();
  });
  it('sends credentialed, no-store requests, CSRF and only the expected public fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify(state())));
    vi.stubGlobal('fetch', fetcher);
    const client = createHostedAmsClient(API);
    await client.read();
    await client.sendCode('test@example.org');
    await client.login('123456');
    await client.snapshot('TESTPRINTER123');
    expect(fetcher.mock.calls[0]).toMatchObject([
      API + '/session',
      { credentials: 'include', cache: 'no-store', redirect: 'error' },
    ]);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: {
        'X-Spoolstamp-CSRF': 'a'.repeat(64),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'test@example.org', consent: true }),
    });
    expect(fetcher.mock.calls[2][1]?.body).toBe(
      JSON.stringify({ code: '123456' }),
    );
    expect(fetcher.mock.calls[3][1]?.body).toBe(
      JSON.stringify({ serial: 'TESTPRINTER123' }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(
      /Bearer|accessToken|password/,
    );
  });
  it('never shows upstream/raw error text to a user', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('PRIVATE-CODE-AND-TOKEN', { status: 502 }),
        ),
    );
    const client = createHostedAmsClient(API);
    await expect(client.read()).rejects.toThrow('Cloud request failed.');
  });
  it('fences a late poll from overwriting a CSRF nonce rotated by login', async () => {
    let complete!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(state())))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(state('b'.repeat(64)))),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(state('b'.repeat(64)))),
      );
    vi.stubGlobal('fetch', fetcher);
    const client = createHostedAmsClient(API);
    await client.read();
    const oldPoll = client.read();
    await client.login('123456');
    complete(new Response(JSON.stringify(state())));
    await oldPoll;
    await client.snapshot('TESTPRINTER123');
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({
      'X-Spoolstamp-CSRF': 'b'.repeat(64),
    });
  });
});
