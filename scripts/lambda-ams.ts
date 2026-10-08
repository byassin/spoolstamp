import { createCloudAmsSession } from './cloud-ams.ts';
import { createAwsAmsDependencies } from './lambda-ams-aws.ts';
import { createLambdaAmsService, type ApiEvent } from './lambda-ams-core.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Cloud AMS configuration is incomplete.');
  return value;
}
// Only SDK clients/configuration are reusable. No user sessions or credentials
// are cached across invocations; handlers never log events, headers, or errors.
function service() {
  if (process.env.SPOOLSTAMP_AMS_ENABLE !== 'experimental')
    throw new Error('Cloud AMS is disabled.');
  return createLambdaAmsService({
    appOrigin: required('SPOOLSTAMP_AMS_APP_ORIGIN'),
    apiHost: required('AMS_API_HOST'),
    allowedEmailHash: required('AMS_ALLOWED_EMAIL_SHA256'),
    ...createAwsAmsDependencies({
      table: required('AMS_TABLE'),
      credentialKey: required('AMS_CREDENTIAL_KEY'),
      accountKey: process.env.AMS_ACCOUNT_KEY ?? '',
      worker: process.env.AMS_WORKER ?? '',
    }),
    provider: (signal) => createCloudAmsSession('global', fetch, { signal }),
  });
}
export async function apiHandler(event: ApiEvent) {
  if (
    event?.version === '2.0' &&
    event.rawPath === '/healthz' &&
    !event.rawQueryString &&
    event.requestContext?.http?.method === 'GET' &&
    event.requestContext.domainName === process.env.AMS_API_HOST
  )
    return {
      statusCode: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ok: true,
        enabled: process.env.SPOOLSTAMP_AMS_ENABLE === 'experimental',
      }),
    };
  try {
    return await service().api(event);
  } catch {
    return {
      statusCode: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Cloud service is unavailable.' }),
    };
  }
}
export async function workerHandler(event: unknown) {
  if (!event || typeof event !== 'object') return;
  const input = event as Record<string, unknown>;
  if (
    typeof input.key !== 'string' ||
    typeof input.job !== 'string' ||
    Object.keys(input).some((key) => !['key', 'job'].includes(key))
  )
    return;
  // A fixed safe error preserves failure metrics without leaking SDK/provider
  // errors in the Lambda runtime's automatic exception log. Retry count is zero.
  try {
    await service().worker({ key: input.key, job: input.job });
  } catch {
    throw new Error('Cloud AMS worker failed.');
  }
}
