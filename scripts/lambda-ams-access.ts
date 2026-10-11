/** Public access must be explicit; missing/malformed private settings fail closed. */
export function allowedEmailHashForAccess(
  mode: string | undefined,
  hash: string | undefined,
): string | undefined {
  if (mode === 'public') return undefined;
  if (
    (mode === undefined || mode === 'private') &&
    /^[a-f0-9]{64}$/.test(hash ?? '')
  )
    return hash;
  throw new Error('Cloud AMS access configuration is incomplete.');
}
