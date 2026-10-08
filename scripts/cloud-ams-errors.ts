export type CloudRegion = 'global' | 'china';
export type CloudErrorCode =
  | 'input'
  | 'network'
  | 'blocked'
  | 'authentication'
  | 'response'
  | 'ownership'
  | 'offline'
  | 'mqtt'
  | 'timeout'
  | 'cancelled';
const messages: Record<CloudErrorCode, string> = {
  input: 'Invalid cloud connection input.',
  network: 'Bambu Cloud could not be reached. No retry was attempted.',
  blocked:
    'Bambu Cloud refused this request. Stop here; do not bypass its challenge or access restrictions.',
  authentication:
    'Bambu Cloud authentication failed or expired. Sign in again; do not disable two-factor authentication.',
  response: 'Bambu Cloud returned an unexpected response.',
  ownership: 'The selected printer is not bound to this Bambu account.',
  offline: 'The selected printer is offline or not connected to Bambu Cloud.',
  mqtt: 'Bambu Cloud telemetry connection failed. No retry was attempted.',
  timeout: 'No fresh, complete AMS snapshot arrived before the deadline.',
  cancelled: 'Cloud AMS test cancelled.',
};
export type CloudResponseDiagnostic = {
  operation: 'email-code' | 'login' | 'printers' | 'preference';
  status: number;
  body: 'empty' | 'json-object' | 'json-null' | 'json-other' | 'unreadable';
  apiCode:
    | 'absent'
    | 'null'
    | 'zero'
    | 'http-success'
    | 'other-number'
    | 'other-string'
    | 'other';
  success: 'absent' | 'true' | 'false' | 'other';
  error: 'absent' | 'present';
};
export class CloudAmsError extends Error {
  readonly code: CloudErrorCode;
  readonly diagnostic?: CloudResponseDiagnostic;
  constructor(code: CloudErrorCode, diagnostic?: CloudResponseDiagnostic) {
    super(messages[code]);
    this.code = code;
    this.diagnostic = diagnostic;
  }
}
export function cloudEndpoints(region: CloudRegion) {
  if (region === 'global')
    return { api: 'https://api.bambulab.com', broker: 'us.mqtt.bambulab.com' };
  if (region === 'china')
    return { api: 'https://api.bambulab.cn', broker: 'cn.mqtt.bambulab.com' };
  throw new CloudAmsError('input');
}

/** Remove terminal control characters from untrusted vendor display strings. */
export function cloudDisplayText(value: unknown, maxLength = 100) {
  return typeof value === 'string'
    ? Array.from(value)
        .filter((character) => {
          const code = character.codePointAt(0)!;
          return code >= 32 && (code < 127 || code > 159);
        })
        .join('')
        .slice(0, maxLength)
    : '';
}
