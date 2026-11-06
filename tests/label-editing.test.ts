import { describe, it, expect } from 'vitest';
import { INITIAL_CONFIGURATION } from '../lib/builder-configuration';
import { FILAMENTS } from '../lib/catalog';
import { labelLink, configurationFromLink } from '../lib/label-link';
import {
  initialHistory,
  recordConfiguration,
  undoConfiguration,
  redoConfiguration,
  MAX_HISTORY,
} from '../lib/configuration-history';

describe('label editing history', () => {
  it('supports bounded undo/redo and clears redo on a new branch', () => {
    const original = initialHistory(INITIAL_CONFIGURATION);
    expect(undoConfiguration(original)).toBe(original);
    expect(redoConfiguration(original)).toBe(original);
    const changed = recordConfiguration(original, {
      ...INITIAL_CONFIGURATION,
      textColor: 'red',
    });
    expect(undoConfiguration(changed).present).toEqual(INITIAL_CONFIGURATION);
    expect(
      redoConfiguration(undoConfiguration(changed)).present.textColor,
    ).toBe('red');
    expect(
      recordConfiguration(undoConfiguration(changed), {
        ...INITIAL_CONFIGURATION,
        textColor: 'blue',
      }).future,
    ).toEqual([]);
    let many = original;
    for (let i = 0; i < MAX_HISTORY + 5; i++)
      many = recordConfiguration(many, {
        ...INITIAL_CONFIGURATION,
        filament: FILAMENTS[i],
      });
    expect(many.past).toHaveLength(MAX_HISTORY);
    expect(recordConfiguration(many, many.present)).toBe(many);
  });
});
describe('catalog-only label links', () => {
  it('round-trips all catalog IDs and does not put data in the server query', () => {
    for (const filament of FILAMENTS) {
      const config = {
        ...INITIAL_CONFIGURATION,
        filament,
        textColor: 'gray' as const,
        textFilamentProduct: undefined,
      };
      const url = new URL(
        labelLink(config, 'https://spoolstamp.bourhan.org/?old=true#old'),
      );
      expect(url.search).toBe('');
      expect(configurationFromLink(url.hash)).toEqual(config);
    }
  });
  it('strips unexpected fields on export and rejects unsafe, oversized or invalid input', () => {
    const link = labelLink(
      {
        ...INITIAL_CONFIGURATION,
        token: 'DO-NOT-SHARE',
      } as typeof INITIAL_CONFIGURATION,
      'https://spoolstamp.bourhan.org/',
    );
    expect(link).not.toContain('DO-NOT-SHARE');
    expect(configurationFromLink('#other')).toBeNull();
    for (const hash of [
      '#label=broken',
      '#label=' + 'a'.repeat(4096),
      '#label=' +
        encodeURIComponent(
          JSON.stringify({
            version: 1,
            label: {
              filamentId: FILAMENTS[0].id,
              printerId: 'secret-serial',
              design: 'drybox-tab',
            },
          }),
        ),
      '#label=' +
        encodeURIComponent(
          JSON.stringify({ version: 1, label: { token: 'SECRET' } }),
        ),
    ])
      expect(() => configurationFromLink(hash)).toThrow();
    expect(() => labelLink(INITIAL_CONFIGURATION, 'javascript:bad')).toThrow();
  });
});
