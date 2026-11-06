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
  codeRequested: false,
  expiresAt: Date.now() + 1_800_000,
  pending: false,
  refreshAfter: 0,
  selectedSerial: null as string | null,
  printers: [] as Array<{
    serial: string;
    name: string;
    model: string;
    online: boolean;
  }>,
  inventory: {
    available: true,
    connected: false,
    printerName: null,
    firmware: null,
    updatedAt: null,
    stale: true,
    message: 'Sign in to read your AMS.',
    slots: [] as unknown[],
  },
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
    await expect(client.read()).rejects.toThrow(
      'Cloud service is temporarily unavailable.',
    );
  });
  it('rejects malformed nested public data before it reaches UI consumers', async () => {
    const valid = state();
    const printer = {
      serial: 'TESTPRINTER123',
      name: 'Test printer',
      model: 'X2D',
      online: true,
    };
    const slot = {
      key: '0:0',
      unit: '0',
      slot: '0',
      label: 'A1',
      present: true,
      reading: false,
      material: 'PLA',
      productId: 'GFA00',
      color: '#000000FF',
      colors: ['#000000FF'],
      remaining: 28,
    };
    const malformed: unknown[] = [
      { ...valid, printers: [null] },
      { ...valid, printers: [{ ...printer, online: 'yes' }] },
      { ...valid, printers: [{ ...printer, serial: 'bad' }] },
      { ...valid, printers: [printer, printer] },
      { ...valid, printers: Array(201).fill(printer) },
      { ...valid, authenticated: true, selectedSerial: 'TESTPRINTER123' },
      { ...valid, pending: 'false' },
      { ...valid, codeRequested: 0 },
      { ...valid, expiresAt: -1 },
      { ...valid, refreshAfter: 1.25 },
      { ...valid, expiresAt: Number.MAX_SAFE_INTEGER },
      { ...valid, inventory: { ...valid.inventory, slots: [null] } },
      ...[
        { ...slot, key: 'wrong' },
        { ...slot, unit: '1000' },
        { ...slot, present: 'true' },
        { ...slot, reading: 0 },
        { ...slot, color: '#123456' },
        { ...slot, colors: ['bad'] },
        { ...slot, colors: Array(9).fill('#000000FF') },
        { ...slot, remaining: 101 },
        { ...slot, remaining: -1 },
        { ...slot, label: 'PRIVATE\nVALUE' },
      ].map((row) => ({
        ...valid,
        inventory: { ...valid.inventory, slots: [row] },
      })),
      { ...valid, inventory: { ...valid.inventory, slots: [slot, slot] } },
      {
        ...valid,
        inventory: { ...valid.inventory, slots: Array(129).fill(slot) },
      },
      { ...valid, inventory: { ...valid.inventory, updatedAt: -1 } },
      { ...valid, inventory: { ...valid.inventory, connected: 'false' } },
      {
        ...valid,
        inventory: { ...valid.inventory, message: 'PRIVATE'.repeat(100) },
      },
    ];
    for (const value of malformed) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
      );
      await expect(createHostedAmsClient(API).read()).rejects.toThrow(
        'Unexpected cloud service response.',
      );
    }
  });
  it('retains only the validated public fields, including unknown presence and empty palettes', async () => {
    const value = {
      ...state(),
      accessToken: 'PRIVATE-TOKEN',
      accountEmail: 'PRIVATE-EMAIL',
      authenticated: true,
      printers: [
        {
          serial: 'TESTPRINTER123',
          name: 'Test printer',
          model: 'X2D',
          online: true,
          password: 'PRIVATE',
        },
      ],
      selectedSerial: 'TESTPRINTER123',
      inventory: {
        ...state().inventory,
        slots: [
          {
            key: '128:0',
            unit: '128',
            slot: '0',
            label: 'HT 1',
            present: null,
            reading: false,
            material: '',
            productId: '',
            color: null,
            colors: [],
            remaining: null,
            tagUid: 'PRIVATE-TAG',
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
    );
    const parsed = await createHostedAmsClient(API).read();
    expect(parsed.printers[0].serial).toBe('TESTPRINTER123');
    expect(parsed.inventory.slots[0].present).toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(
      /PRIVATE|accessToken|accountEmail|password|tagUid/,
    );
  });
  it('bounds response bytes and reports only its own fixed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('PRIVATE'.repeat(100_000))),
    );
    await expect(createHostedAmsClient(API).read()).rejects.toThrow(
      'Unexpected cloud service response.',
    );
  });
  it('does not automatically resend emails, sign-ins or printer reads during outages', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('PRIVATE', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const client = createHostedAmsClient(API);
    for (const operation of [
      () => client.sendCode('test@example.org'),
      () => client.login('123456'),
      () => client.snapshot('TESTPRINTER123'),
    ])
      await expect(operation()).rejects.toThrow(
        'saved drafts or the manual picker',
      );
    expect(fetcher).toHaveBeenCalledTimes(3);
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
