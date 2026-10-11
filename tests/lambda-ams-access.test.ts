import { describe, expect, it } from 'vitest';
import { allowedEmailHashForAccess } from '../scripts/lambda-ams-access';

const hash = 'a'.repeat(64);

describe('Lambda AMS access mode', () => {
  it('allows public access only through explicit opt-in, ignoring the rollback hash', () => {
    expect(allowedEmailHashForAccess('public', hash)).toBeUndefined();
    expect(allowedEmailHashForAccess('public', undefined)).toBeUndefined();
  });
  it('preserves private restrictions and backward-compatible deployments', () => {
    expect(allowedEmailHashForAccess('private', hash)).toBe(hash);
    expect(allowedEmailHashForAccess(undefined, hash)).toBe(hash);
  });
  it('fails closed on missing private hashes or unknown modes', () => {
    for (const mode of [undefined, 'private', '', 'PUBLIC', 'unknown']) {
      expect(() => allowedEmailHashForAccess(mode, undefined)).toThrow();
    }
    for (const invalid of ['', 'a'.repeat(63), 'A'.repeat(64)]) {
      expect(() => allowedEmailHashForAccess('private', invalid)).toThrow();
    }
    expect(() => allowedEmailHashForAccess('unknown', hash)).toThrow();
  });
});
