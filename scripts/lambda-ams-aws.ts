import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
  GenerateMacCommand,
} from '@aws-sdk/client-kms';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  digest,
  LambdaRequestError,
  type LambdaSession,
  type SessionStore,
  type CredentialVault,
} from './lambda-ams-core.ts';

const conditional = (error: unknown) =>
  error instanceof Error &&
  ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(
    error.name,
  );
const sdkOptions = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
};
type Envelope = { wrapped: string; iv: string; tag: string; data: string };

/** AES-256-GCM envelope encryption supports Bambu tokens above KMS's 4KiB limit. */
export function sealEnvelope(
  value: string,
  key: Uint8Array,
  wrapped: Uint8Array,
  binding: string,
): string {
  if (Buffer.byteLength(value) > 18_000 || key.length !== 32)
    throw new Error('Invalid credential envelope.');
  const plaintext = Buffer.from(value);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(binding));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify({
      wrapped: Buffer.from(wrapped).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      tag: Buffer.from(cipher.getAuthTag()).toString('base64'),
      data: data.toString('base64'),
    });
  } finally {
    plaintext.fill(0);
  }
}
export function openEnvelope(
  envelope: Envelope,
  key: Uint8Array,
  binding: string,
): string {
  if (
    key.length !== 32 ||
    Buffer.from(envelope.iv, 'base64').length !== 12 ||
    Buffer.from(envelope.tag, 'base64').length !== 16
  )
    throw new Error('Invalid credential envelope.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  try {
    return plaintext.toString('utf8');
  } finally {
    plaintext.fill(0);
  }
}
export function createAwsAmsDependencies(config: {
  table: string;
  credentialKey: string;
  accountKey: string;
  worker: string;
}) {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(sdkOptions), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const kms = new KMSClient(sdkOptions);
  const lambda = new LambdaClient(sdkOptions);
  const TableName = config.table;
  const pk = (key: string) => `session:${key}`;
  const item = (s: LambdaSession) => ({
    ...s,
    // Derive storage metadata last: a rehydrated record must never overwrite
    // the rotated primary key or the absolute-expiry TTL.
    pk: pk(s.key),
    expires: Math.ceil(s.expiresAt / 1000),
  });
  const store: SessionStore = {
    async get(key) {
      const result = await ddb.send(
        new GetCommand({
          TableName,
          Key: { pk: pk(key) },
          ConsistentRead: true,
        }),
      );
      if (!result.Item) return undefined;
      const { pk: _pk, expires: _expires, ...session } = result.Item;
      return session as LambdaSession;
    },
    async create(session) {
      try {
        await ddb.send(
          new PutCommand({
            TableName,
            Item: item(session),
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        );
        return true;
      } catch (error) {
        if (conditional(error)) return false;
        throw error;
      }
    },
    async swap(session, previousVersion, now) {
      try {
        await ddb.send(
          new PutCommand({
            TableName,
            Item: item(session),
            ConditionExpression: '#version = :version AND expiresAt > :now',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: {
              ':version': previousVersion,
              ':now': now,
            },
          }),
        );
        return true;
      } catch (error) {
        if (conditional(error)) return false;
        throw error;
      }
    },
    async rotate(session, oldKey, previousVersion, now) {
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName,
                  Key: { pk: pk(oldKey) },
                  ConditionExpression:
                    '#version = :version AND expiresAt > :now',
                  ExpressionAttributeNames: { '#version': 'version' },
                  ExpressionAttributeValues: {
                    ':version': previousVersion,
                    ':now': now,
                  },
                },
              },
              {
                Put: {
                  TableName,
                  Item: item(session),
                  ConditionExpression: 'attribute_not_exists(pk)',
                },
              },
            ],
          }),
        );
        return true;
      } catch (error) {
        if (conditional(error)) return false;
        throw error;
      }
    },
    async remove(key, csrf) {
      try {
        await ddb.send(
          new DeleteCommand({
            TableName,
            Key: { pk: pk(key) },
            ConditionExpression: 'csrf = :csrf',
            ExpressionAttributeValues: { ':csrf': csrf },
          }),
        );
      } catch (error) {
        if (!conditional(error)) throw error;
      }
    },
    async rate(key, maximum, windowMs, now) {
      const Key = { pk: `limit:${digest(key)}` };
      // Anchor windows to the first request, not wall-clock boundaries. Reads
      // therefore cannot slip two status requests through a five-minute boundary.
      try {
        await ddb.send(
          new UpdateCommand({
            TableName,
            Key,
            UpdateExpression:
              'SET #count = :one, untilMs = :until, expires = :expires',
            ConditionExpression: 'attribute_not_exists(pk) OR untilMs <= :now',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':until': now + windowMs,
              ':expires': Math.ceil((now + windowMs) / 1000),
              ':now': now,
            },
          }),
        );
        return;
      } catch (error) {
        if (!conditional(error)) throw error;
      }
      try {
        await ddb.send(
          new UpdateCommand({
            TableName,
            Key,
            UpdateExpression: 'ADD #count :one',
            ConditionExpression: 'untilMs > :now AND #count < :max',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':now': now,
              ':max': maximum,
            },
          }),
        );
      } catch (error) {
        if (conditional(error))
          throw new LambdaRequestError(
            429,
            'Request limit reached. Try later.',
          );
        throw error;
      }
    },
  };
  const context = (key: string) => ({
    purpose: 'spoolstamp-ams-session',
    session: key,
  });
  const binding = (key: string) => `spoolstamp-ams-session:${key}`;
  const vault: CredentialVault = {
    async seal(value, sessionKey) {
      const result = await kms.send(
        new GenerateDataKeyCommand({
          KeyId: config.credentialKey,
          KeySpec: 'AES_256',
          EncryptionContext: context(sessionKey),
        }),
      );
      if (!result.Plaintext || !result.CiphertextBlob)
        throw new Error('Credential encryption unavailable.');
      try {
        return sealEnvelope(
          value,
          result.Plaintext,
          result.CiphertextBlob,
          binding(sessionKey),
        );
      } finally {
        result.Plaintext.fill(0);
      }
    },
    async open(value, sessionKey) {
      if (value.length > 32_000)
        throw new Error('Invalid credential envelope.');
      const envelope = JSON.parse(value) as Envelope;
      if (
        !envelope ||
        ['wrapped', 'iv', 'tag', 'data'].some(
          (key) => typeof envelope[key as keyof Envelope] !== 'string',
        )
      )
        throw new Error('Invalid credential envelope.');
      const result = await kms.send(
        new DecryptCommand({
          KeyId: config.credentialKey,
          CiphertextBlob: Buffer.from(envelope.wrapped, 'base64'),
          EncryptionContext: context(sessionKey),
        }),
      );
      if (!result.Plaintext)
        throw new Error('Credential decryption unavailable.');
      try {
        return openEnvelope(envelope, result.Plaintext, binding(sessionKey));
      } finally {
        result.Plaintext.fill(0);
      }
    },
    async account(email) {
      // Do not pass plaintext email as KMS metadata or a CloudTrail context.
      const result = await kms.send(
        new GenerateMacCommand({
          KeyId: config.accountKey,
          MacAlgorithm: 'HMAC_SHA_256',
          Message: Buffer.from(digest(email.toLowerCase()), 'hex'),
        }),
      );
      if (!result.Mac) throw new Error('Account rate protection unavailable.');
      return Buffer.from(result.Mac).toString('hex');
    },
  };
  async function enqueue(key: string, job: string) {
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: config.worker,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ key, job })),
      }),
    );
    if (result.StatusCode !== 202) throw new Error('Cloud job unavailable.');
  }
  return { store, vault, enqueue };
}
