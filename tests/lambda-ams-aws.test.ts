import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
const mocks = vi.hoisted(() => ({
  ddb: vi.fn(),
  kms: vi.fn(),
  lambda: vi.fn(),
}));
vi.mock('@aws-sdk/client-dynamodb', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-dynamodb')>()),
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', async (load) => ({
  ...(await load<typeof import('@aws-sdk/lib-dynamodb')>()),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.ddb }) },
}));
vi.mock('@aws-sdk/client-kms', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-kms')>()),
  KMSClient: class {
    send = mocks.kms;
  },
}));
vi.mock('@aws-sdk/client-lambda', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-lambda')>()),
  LambdaClient: class {
    send = mocks.lambda;
  },
}));
import { createAwsAmsDependencies } from '../scripts/lambda-ams-aws';
import {
  digest,
  emptyInventory,
  type LambdaSession,
} from '../scripts/lambda-ams-core';
const config = {
  table: 'test-table',
  credentialKey: 'test-encryption-key',
  accountKey: 'test-hmac-key',
  worker: 'test-worker',
};
const key = 'a'.repeat(64);
const session: LambdaSession = {
  key,
  version: 1,
  csrf: 'b'.repeat(64),
  expiresAt: 10000,
  authenticated: false,
  secret: null,
  challengeUntil: 0,
  account: '',
  printers: [],
  selectedSerial: null,
  refreshAfter: 0,
  busyUntil: 0,
  inventory: emptyInventory(),
  job: null,
};
const conditional = () =>
  Object.assign(new Error('private SDK detail'), {
    name: 'ConditionalCheckFailedException',
  });
beforeEach(() => vi.resetAllMocks());
describe('AWS AMS persistence adapter, mocked SDK only', () => {
  it('uses strongly consistent reads and version/expiry-fenced writes', async () => {
    const { store } = createAwsAmsDependencies(config);
    mocks.ddb.mockResolvedValue({ Item: session });
    expect(await store.get(key)).toEqual(session);
    expect(mocks.ddb.mock.calls[0][0].input).toMatchObject({
      TableName: config.table,
      ConsistentRead: true,
      Key: { pk: `session:${key}` },
    });
    await store.swap(session, 0, 500);
    const write = mocks.ddb.mock.calls[1][0].input;
    expect(write.ConditionExpression).toBe(
      '#version = :version AND expiresAt > :now',
    );
    expect(write.ExpressionAttributeValues).toEqual({
      ':version': 0,
      ':now': 500,
    });
    expect(write.Item.expires).toBe(10);
    mocks.ddb.mockRejectedValueOnce(conditional());
    expect(await store.swap(session, 0, 500)).toBe(false);
    mocks.ddb.mockRejectedValueOnce(new Error('AWS down'));
    await expect(store.swap(session, 0, 500)).rejects.toThrow('AWS down');
  });
  it('rotates atomically and does not mistake unrelated transaction failures for success', async () => {
    const { store } = createAwsAmsDependencies(config);
    mocks.ddb.mockResolvedValue({});
    expect(await store.rotate(session, 'c'.repeat(64), 0, 500)).toBe(true);
    const items = mocks.ddb.mock.calls[0][0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Delete.Key.pk).toBe(`session:${'c'.repeat(64)}`);
    expect(items[0].Delete.ConditionExpression).toContain('expiresAt > :now');
    expect(items[1].Put.ConditionExpression).toBe('attribute_not_exists(pk)');
    mocks.ddb.mockRejectedValueOnce(
      Object.assign(new Error('private'), {
        name: 'TransactionCanceledException',
      }),
    );
    expect(await store.rotate(session, 'c'.repeat(64), 0, 500)).toBe(false);
  });
  it('rate resets are atomic and anchored to first request; increments are capped', async () => {
    const { store } = createAwsAmsDependencies(config);
    mocks.ddb
      .mockRejectedValueOnce(conditional())
      .mockRejectedValueOnce(conditional());
    await expect(
      store.rate('read:account:device', 1, 300000, 299999),
    ).rejects.toMatchObject({ status: 429 });
    const reset = mocks.ddb.mock.calls[0][0].input;
    expect(reset.ExpressionAttributeValues[':until']).toBe(599999);
    expect(reset.ConditionExpression).toBe(
      'attribute_not_exists(pk) OR untilMs <= :now',
    );
    const increment = mocks.ddb.mock.calls[1][0].input;
    expect(increment.ConditionExpression).toBe(
      'untilMs > :now AND #count < :max',
    );
    expect(increment.Key.pk).not.toContain('account:device');
  });
  it('KMS-wrapped envelope data keys are zeroed, session-bound, and never persisted plaintext', async () => {
    const { vault } = createAwsAmsDependencies(config);
    const original = randomBytes(32);
    const plaintext = Buffer.from(original);
    const wrapped = Buffer.from('fake-wrapped-key');
    mocks.kms.mockResolvedValueOnce({
      Plaintext: plaintext,
      CiphertextBlob: wrapped,
    });
    const sealed = await vault.seal('synthetic-only-secret', key);
    expect([...plaintext]).toEqual(Array(32).fill(0));
    expect(sealed).not.toContain('synthetic-only-secret');
    expect(mocks.kms.mock.calls[0][0].input).toMatchObject({
      KeyId: config.credentialKey,
      KeySpec: 'AES_256',
      EncryptionContext: { purpose: 'spoolstamp-ams-session', session: key },
    });
    const openedKey = Buffer.from(original);
    mocks.kms.mockResolvedValueOnce({ Plaintext: openedKey });
    expect(await vault.open(sealed, key)).toBe('synthetic-only-secret');
    expect([...openedKey]).toEqual(Array(32).fill(0));
    expect(mocks.kms.mock.calls[1][0].input).toMatchObject({
      KeyId: config.credentialKey,
      CiphertextBlob: wrapped,
      EncryptionContext: { purpose: 'spoolstamp-ams-session', session: key },
    });
  });
  it('HMAC account pseudonyms do not send plaintext email or expose a key', async () => {
    const { vault } = createAwsAmsDependencies(config);
    mocks.kms.mockResolvedValue({ Mac: Buffer.from('d'.repeat(64), 'hex') });
    expect(await vault.account('Preview@example.org')).toBe('d'.repeat(64));
    const command = mocks.kms.mock.calls[0][0].input;
    expect(command.MacAlgorithm).toBe('HMAC_SHA_256');
    expect(command.KeyId).toBe(config.accountKey);
    expect(Buffer.from(command.Message).toString('hex')).toBe(
      digest('preview@example.org'),
    );
    expect(JSON.stringify(command)).not.toContain('example.org');
  });
  it('queues only opaque job identifiers, requires AWS acknowledgement, and never retries vendor calls', async () => {
    const { enqueue } = createAwsAmsDependencies(config);
    mocks.lambda.mockResolvedValueOnce({ StatusCode: 202 });
    await enqueue(key, 'e'.repeat(64));
    const command = mocks.lambda.mock.calls[0][0].input;
    expect(command.InvocationType).toBe('Event');
    expect(command.FunctionName).toBe(config.worker);
    expect(JSON.parse(Buffer.from(command.Payload).toString())).toEqual({
      key,
      job: 'e'.repeat(64),
    });
    mocks.lambda.mockResolvedValueOnce({ StatusCode: 200 });
    await expect(enqueue(key, 'e'.repeat(64))).rejects.toThrow();
  });
});
