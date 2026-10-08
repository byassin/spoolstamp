import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCloudAmsSession, CloudAmsError } from '../scripts/cloud-ams';
import { cloudEndpoints } from '../scripts/cloud-ams-errors';
import { readCloudSnapshot } from '../scripts/cloud-ams-network';
vi.mock('../scripts/cloud-ams-network', () => ({ readCloudSnapshot: vi.fn() }));
const TOKEN = 'test-only-token-1234567890';
const SERIAL = 'TESTPRINTER123';
const device = {
  dev_id: SERIAL,
  name: 'Desk\u001b[31m',
  dev_product_name: 'X2D',
  online: true,
  dev_access_code: 'PRIVATE-CODE',
  tag_uid: 'PRIVATE-TAG',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  const session = createCloudAmsSession('global', fetcher);
  return { fetcher, session };
}
beforeEach(() => vi.resetAllMocks());
describe('experimental cloud session', () => {
  it('does not resurrect a token when login completes after close', async () => {
    const { fetcher, session } = setup();
    let complete!: (value: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = session.loginWithEmailCode('test@example.org', '123456');
    session.close();
    complete(json({ accessToken: TOKEN }));
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(session.printers()).rejects.toMatchObject({
      code: 'authentication',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('uses only fixed region hosts', () => {
    expect(cloudEndpoints('global').broker).toBe('us.mqtt.bambulab.com');
    expect(cloudEndpoints('china').api).toBe('https://api.bambulab.cn');
    expect(() => cloudEndpoints('https://attacker.example' as never)).toThrow(
      CloudAmsError,
    );
  });
  it('requests exactly one email code, with honest client identity and no password', async () => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json({ code: 0 }));
    await session.requestEmailCode('test@example.org');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://api.bambulab.com/v1/user-service/user/sendemail/code',
    );
    expect(JSON.parse(options!.body as string)).toEqual({
      email: 'test@example.org',
      type: 'codeLogin',
    });
    expect(options).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(options!.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Spoolstamp/'),
    });
    expect(JSON.stringify(options)).not.toContain('BambuStudio');
    expect(JSON.stringify(options)).not.toContain('OrcaSlicer');
  });
  it('keeps login tokens private and strips device access codes from returned devices', async () => {
    const { fetcher, session } = setup();
    fetcher
      .mockResolvedValueOnce(
        json({ accessToken: TOKEN, refreshToken: 'PRIVATE-REFRESH' }),
      )
      .mockResolvedValueOnce(json({ devices: [device] }));
    expect(
      await session.loginWithEmailCode('test@example.org', '123456'),
    ).toBeUndefined();
    const printers = await session.printers();
    expect(printers).toEqual([
      { serial: SERIAL, name: 'Desk[31m', model: 'X2D', online: true },
    ]);
    expect(JSON.stringify(printers)).not.toMatch(
      /PRIVATE|token|access_code|tag_uid/,
    );
    expect(fetcher.mock.calls[1][1]!.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
    session.close();
    await expect(session.printers()).rejects.toMatchObject({
      code: 'authentication',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([403, 418, 429])(
    'stops on HTTP %s without exposing upstream body or retrying',
    async (status) => {
      const { fetcher, session } = setup();
      fetcher.mockResolvedValue(json({ message: TOKEN }, status));
      await expect(
        session.requestEmailCode('test@example.org'),
      ).rejects.toMatchObject({ code: 'blocked' });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it.each([400, 401])('sanitizes authentication HTTP %s', async (status) => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json({ message: TOKEN }, status));
    await expect(
      session.loginWithEmailCode('test@example.org', '123456'),
    ).rejects.toMatchObject({ code: 'authentication' });
  });
  it('does not leak network error details', async () => {
    const { fetcher, session } = setup();
    fetcher.mockRejectedValue(new Error(`PRIVATE ${TOKEN}`));
    await expect(session.requestEmailCode('test@example.org')).rejects.toThrow(
      'Bambu Cloud could not be reached.',
    );
  });
  it.each([
    [],
    'not json',
    { code: 9, message: TOKEN },
    { success: false },
    { error: TOKEN },
  ])('rejects unexpected successful responses: %j', async (result) => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json(result));
    await expect(
      session.requestEmailCode('test@example.org'),
    ).rejects.toMatchObject({ code: 'response' });
  });
  it.each([
    { body: '', status: 200 },
    { body: null, status: 204 },
    { body: 'null', status: 200 },
    { body: '{"code":"0"}', status: 200 },
    { body: '{"code":200,"success":true}', status: 200 },
    { body: '{"code":"200"}', status: 200 },
  ])(
    'accepts email acknowledgements without requiring the data-endpoint schema: %j',
    async ({ body, status }) => {
      const { fetcher, session } = setup();
      fetcher.mockResolvedValue(new Response(body, { status }));
      await expect(
        session.requestEmailCode('test@example.org'),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it.each([
    null,
    { code: 200, accessToken: TOKEN },
    { success: false, accessToken: TOKEN },
    { error: TOKEN, accessToken: TOKEN },
  ])('does not loosen the authenticated login schema: %j', async (body) => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json(body));
    await expect(
      session.loginWithEmailCode('test@example.org', '123456'),
    ).rejects.toMatchObject({ code: 'response' });
  });
  it('logs only bounded response shape diagnostics, never vendor values or keys', async () => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(
      json({
        code: TOKEN,
        success: false,
        error: TOKEN,
        message: TOKEN,
        'PRIVATE-KEY': TOKEN,
      }),
    );
    const error = (await session
      .requestEmailCode('test@example.org')
      .catch((error: unknown) => error)) as CloudAmsError;
    expect(error).toBeInstanceOf(CloudAmsError);
    expect(error.diagnostic).toEqual({
      operation: 'email-code',
      status: 200,
      body: 'json-object',
      apiCode: 'other-string',
      success: 'false',
      error: 'present',
    });
    expect(JSON.stringify(error) + error.message).not.toMatch(
      /PRIVATE|test-only-token|example.org/,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports malformed response shape without including body contents', async () => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(
      new Response('PRIVATE-TOKEN NOT JSON', { status: 200 }),
    );
    const error = (await session
      .requestEmailCode('test@example.org')
      .catch((error: unknown) => error)) as CloudAmsError;
    expect(error.diagnostic).toMatchObject({
      operation: 'email-code',
      status: 200,
      body: 'unreadable',
    });
    expect(JSON.stringify(error) + error.message).not.toContain('PRIVATE');
  });
  it('can use an existing email code without requesting a new email', async () => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json({ accessToken: TOKEN }));
    await session.loginWithEmailCode('test@example.org', '123456');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.bambulab.com/v1/user-service/user/login',
    );
  });
  it('bounds HTTP response bytes', async () => {
    const { fetcher, session } = setup();
    fetcher.mockResolvedValue(json({ padding: 'x'.repeat(600000) }));
    await expect(
      session.requestEmailCode('test@example.org'),
    ).rejects.toMatchObject({ code: 'response' });
  });
  it('rejects invalid inputs before any request', async () => {
    const { fetcher, session } = setup();
    await expect(
      session.requestEmailCode('test\n@example.org'),
    ).rejects.toMatchObject({ code: 'input' });
    await expect(
      session.loginWithEmailCode('test@example.org', 'not-a-code'),
    ).rejects.toMatchObject({ code: 'input' });
    expect(() => session.useAccessToken('short')).toThrow(CloudAmsError);
    expect(() => session.useAccessToken(TOKEN + '\n')).toThrow(CloudAmsError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not guess an email login flow for China accounts', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const session = createCloudAmsSession('china', fetcher);
    await expect(
      session.requestEmailCode('test@example.org'),
    ).rejects.toMatchObject({ code: 'input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rechecks ownership, gets UID via the preference API and returns only the snapshot', async () => {
    const { fetcher, session } = setup();
    session.useAccessToken(TOKEN);
    fetcher
      .mockResolvedValueOnce(json({ devices: [device] }))
      .mockResolvedValueOnce(json({ uid: '12345', private: 'ignored' }));
    vi.mocked(readCloudSnapshot).mockResolvedValue({
      updatedAt: 123,
      slots: [],
    });
    expect(await session.snapshot(SERIAL)).toEqual({
      updatedAt: 123,
      slots: [],
    });
    expect(readCloudSnapshot).toHaveBeenCalledWith({
      region: 'global',
      serial: SERIAL,
      userId: '12345',
      token: TOKEN,
    });
    expect(fetcher.mock.calls[0][0]).toContain('/user/bind');
    expect(fetcher.mock.calls[1][0]).toContain('/my/preference');
  });
  it('never opens MQTT for a printer not owned by the account', async () => {
    const { fetcher, session } = setup();
    session.useAccessToken(TOKEN);
    fetcher.mockResolvedValue(json({ devices: [] }));
    await expect(session.snapshot(SERIAL)).rejects.toMatchObject({
      code: 'ownership',
    });
    expect(readCloudSnapshot).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never opens MQTT for an offline printer', async () => {
    const { fetcher, session } = setup();
    session.useAccessToken(TOKEN);
    fetcher.mockResolvedValue(
      json({ devices: [{ ...device, online: false }] }),
    );
    await expect(session.snapshot(SERIAL)).rejects.toMatchObject({
      code: 'offline',
    });
    expect(readCloudSnapshot).not.toHaveBeenCalled();
  });
  it.each(['123/../../other', '123\n', Number.MAX_SAFE_INTEGER + 1, -1, null])(
    'rejects unsafe UID: %j',
    async (uid) => {
      const { fetcher, session } = setup();
      session.useAccessToken(TOKEN);
      fetcher
        .mockResolvedValueOnce(json({ devices: [device] }))
        .mockResolvedValueOnce(json({ uid }));
      await expect(session.snapshot(SERIAL)).rejects.toMatchObject({
        code: 'response',
      });
      expect(readCloudSnapshot).not.toHaveBeenCalled();
    },
  );
  it.each([
    { devices: [device, device] },
    { devices: [{ ...device, dev_id: 'evil/#' }] },
    { devices: [{ ...device, online: 'true' }] },
  ])('rejects malformed device lists: %j', async (body) => {
    const { fetcher, session } = setup();
    session.useAccessToken(TOKEN);
    fetcher.mockResolvedValue(json(body));
    await expect(session.printers()).rejects.toMatchObject({
      code: 'response',
    });
  });
  it('honors an already-cancelled read without network activity', async () => {
    const { fetcher, session } = setup();
    await expect(
      session.snapshot(SERIAL, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
