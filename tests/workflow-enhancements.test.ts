import { describe, expect, it } from 'vitest';
import { DEFAULT_FILAMENT, FILAMENTS } from '../lib/catalog';
import { INITIAL_CONFIGURATION } from '../lib/builder-configuration';
import {
  emptyWorkspace,
  parseWorkspace,
  restoreLabel,
  saveLabel,
} from '../lib/saved-workspace';
import { textContrastWarning } from '../lib/text-color';
import { cloudPollDelay, snapshotStatus } from '../lib/ams-freshness';
import type { AmsInventory } from '../lib/ams';

describe('browser-only saved choices', () => {
  it('round-trips every catalog filament without accepting arbitrary products', () => {
    for (const filament of FILAMENTS) {
      const configuration = {
        ...INITIAL_CONFIGURATION,
        filament,
        textColor: 'gray' as const,
      };
      expect(restoreLabel(saveLabel(configuration))).toEqual(configuration);
    }
    expect(
      restoreLabel({
        ...saveLabel(INITIAL_CONFIGURATION),
        filamentId: 'custom-brand',
      }),
    ).toBeNull();
    expect(
      restoreLabel({
        ...saveLabel(INITIAL_CONFIGURATION),
        printerId: 'unknown',
      }),
    ).toBeNull();
    expect(
      restoreLabel({ ...saveLabel(INITIAL_CONFIGURATION), textColor: 'evil' }),
    ).toBeNull();
  });
  it('strips credentials, inventory, identifiers and unknown fields when loading', () => {
    const row = {
      ...saveLabel(INITIAL_CONFIGURATION),
      email: 'secret@example.com',
      token: 'secret-token',
      serial: 'printer-secret',
      remaining: 50,
      updatedAt: 123,
    };
    const saved = parseWorkspace(
      JSON.stringify({
        ...emptyWorkspace(),
        remember: true,
        setup: row,
        drafts: [row, row],
        favorites: [DEFAULT_FILAMENT.id, 'unknown', DEFAULT_FILAMENT.id],
        code: '123456',
        csrf: 'secret',
      }),
    );
    expect(saved.drafts).toHaveLength(1);
    expect(saved.favorites).toEqual([DEFAULT_FILAMENT.id]);
    expect(saved.setup).toEqual(saveLabel(INITIAL_CONFIGURATION));
    expect(JSON.stringify(saved)).not.toMatch(
      /secret|123456|remaining|updatedAt|serial|csrf|email/,
    );
  });
  it('restoring an automatic draft clears the current manual text overrides', () => {
    const restored = restoreLabel(saveLabel(INITIAL_CONFIGURATION))!;
    const current = {
      ...INITIAL_CONFIGURATION,
      textColor: 'gray' as const,
      textFilamentProduct: 'PLA Matte',
    };
    const merged = { ...current, ...restored };
    expect(merged.textColor).toBeUndefined();
    expect(merged.textFilamentProduct).toBeUndefined();
    expect(Object.hasOwn(restored, 'textFilamentProduct')).toBe(true);
  });
  it('recovers corrupted/obsolete storage and removes remembered setup when disabled', () => {
    for (const raw of [
      'broken',
      'null',
      '[]',
      '{"version":2}',
      'a'.repeat(32_001),
    ])
      expect(parseWorkspace(raw)).toEqual(emptyWorkspace());
    expect(
      parseWorkspace(
        JSON.stringify({
          ...emptyWorkspace(),
          setup: saveLabel(INITIAL_CONFIGURATION),
        }),
      ).setup,
    ).toBeNull();
    expect(
      parseWorkspace(
        JSON.stringify({
          ...emptyWorkspace(),
          drafts: [
            {
              ...saveLabel(INITIAL_CONFIGURATION),
              textFilamentProduct: 'PETG Basic',
            },
          ],
        }),
      ).drafts,
    ).toEqual([]);
  });
});
describe('contrast and AMS clarity', () => {
  it('warns without blocking same-color text and suggests the contrasting color', () => {
    const black = { ...DEFAULT_FILAMENT, colors: ['#000000FF'] };
    expect(textContrastWarning(black, 'black')?.suggested).toBe('white');
    expect(textContrastWarning(black, 'white')).toBeNull();
    expect(textContrastWarning(black)).toBeNull();
    expect(
      textContrastWarning({ ...black, transparent: true }, 'black'),
    ).toBeNull();
    expect(
      textContrastWarning({ ...black, colors: ['#00000080'] }, 'black'),
    ).toBeNull();
  });
  it('expires the badge at exactly 45 seconds, rejects future and disconnected reads', () => {
    const inventory: AmsInventory = {
      available: true,
      connected: true,
      printerName: null,
      firmware: null,
      updatedAt: 1000,
      stale: false,
      slots: [],
      message: '',
    };
    expect(snapshotStatus(inventory, 45_999).fresh).toBe(true);
    expect(snapshotStatus(inventory, 46_000).fresh).toBe(false);
    expect(snapshotStatus({ ...inventory, connected: false }, 2000).fresh).toBe(
      false,
    );
    expect(snapshotStatus(inventory, 999).fresh).toBe(false);
    expect(snapshotStatus(null, 2000).text).toContain('No current');
    expect(snapshotStatus(inventory, 61_000).text).toContain('1m 0s');
  });
  it('bounds outage backoff and immediately resets normal polling after recovery', () => {
    expect([0, 1, 2, 3, 4, 9].map(cloudPollDelay)).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000,
    ]);
  });
});
