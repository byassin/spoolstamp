import { restoreLabel, saveLabel } from './saved-workspace';
import type { BuilderConfiguration } from './builder-configuration';

const allowed = [
  'filamentId',
  'printerId',
  'design',
  'textColor',
  'textFilamentProduct',
];
/** Fragment-only, catalog-only sharing: no login/session data, and no data sent in the HTTP request. */
export function labelLink(configuration: BuilderConfiguration, base: string) {
  const url = new URL(base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Unsupported link origin.');
  url.search = '';
  url.hash = `label=${encodeURIComponent(JSON.stringify({ version: 1, label: saveLabel(configuration) }))}`;
  return url.toString();
}
export function configurationFromLink(
  hash: string,
): BuilderConfiguration | null {
  if (!hash.startsWith('#label=')) return null;
  if (hash.length > 4096) throw new Error('This label link is too large.');
  try {
    const value: unknown = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    const envelope = value as Record<string, unknown>;
    if (
      envelope.version !== 1 ||
      Object.keys(envelope).some((key) => !['version', 'label'].includes(key))
    )
      throw new Error();
    if (
      !envelope.label ||
      typeof envelope.label !== 'object' ||
      Array.isArray(envelope.label) ||
      Object.keys(envelope.label).some((key) => !allowed.includes(key))
    )
      throw new Error();
    const restored = restoreLabel(envelope.label);
    if (!restored) throw new Error();
    return restored;
  } catch {
    throw new Error(
      'This label link is invalid or uses an unavailable catalog choice.',
    );
  }
}
