import { describe, expect, it } from 'vitest';
import { FILAMENTS, FILAMENTS_BY_PRODUCT, PRINTERS } from '../lib/catalog';
import {
  filamentForProduct,
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  sameConfiguration,
} from '../lib/builder-configuration';

describe('builder configuration', () => {
  it('tracks text profile changes and resets them across material families', () => {
    const selected = resolveConfiguration(
      { textFilamentProduct: 'PLA Matte' },
      INITIAL_CONFIGURATION,
    );
    expect(sameConfiguration(selected, INITIAL_CONFIGURATION)).toBe(false);
    expect(
      resolveConfiguration({ filamentProduct: 'PLA Tough+' }, selected)
        .textFilamentProduct,
    ).toBe('PLA Matte');
    expect(
      resolveConfiguration({ filamentProduct: 'PETG HF' }, selected)
        .textFilamentProduct,
    ).toBeUndefined();
    expect(() =>
      resolveConfiguration({ textFilamentProduct: 'PETG HF' }, selected),
    ).toThrow('match the label material');
  });
  it('selects the X2D printer profile by default', () => {
    expect(
      PRINTERS.find((printer) => printer.id === INITIAL_CONFIGURATION.printerId)
        ?.fullName,
    ).toBe('Bambu Lab X2D');
  });

  it('retains a matching color name when changing type, otherwise chooses a valid color', () => {
    const black = FILAMENTS.find(
      (item) => item.product === 'PLA Basic' && item.colorName === 'Black',
    )!;
    expect(filamentForProduct('ABS', black).colorName).toBe('Black');
    expect(filamentForProduct('PLA Matte', black)).toBe(
      FILAMENTS_BY_PRODUCT.get('PLA Matte')![0],
    );
    const next = filamentForProduct('PLA Silk', INITIAL_CONFIGURATION.filament);
    expect(FILAMENTS_BY_PRODUCT.get('PLA Silk')).toContain(next);
  });

  it('accepts no-op and partial updates without losing existing settings', () => {
    expect(
      sameConfiguration(
        resolveConfiguration({}, INITIAL_CONFIGURATION),
        INITIAL_CONFIGURATION,
      ),
    ).toBe(true);
    const selected = resolveConfiguration(
      { printerId: PRINTERS[0].id, design: 'clip-label' },
      INITIAL_CONFIGURATION,
    );
    expect(selected).toEqual({
      ...INITIAL_CONFIGURATION,
      printerId: PRINTERS[0].id,
      design: 'clip-label',
    });
  });

  it('resolves an exact code to its filament type', () => {
    const filament = FILAMENTS.find((item) => item.product === 'PLA Silk')!;
    expect(
      resolveConfiguration(
        { filamentColorCode: filament.colorCode },
        INITIAL_CONFIGURATION,
      ).filament,
    ).toBe(filament);
    expect(
      resolveConfiguration(
        {
          filamentProduct: filament.product,
          filamentColorCode: filament.colorCode,
        },
        INITIAL_CONFIGURATION,
      ).filament,
    ).toBe(filament);
  });

  it('rejects a mismatched product and color atomically', () => {
    const before = { ...INITIAL_CONFIGURATION };
    expect(() =>
      resolveConfiguration(
        {
          filamentProduct: 'PLA Silk',
          filamentColorCode: before.filament.colorCode,
        },
        before,
      ),
    ).toThrow('does not belong');
    expect(before).toEqual(INITIAL_CONFIGURATION);
  });

  it.each([
    null,
    [],
    'PLA Basic',
    { printerId: 'missing' },
    { design: 'missing' },
    { design: 'spool-card' },
    { design: 'sample-chip' },
    { filamentColorCode: 'missing' },
    { filamentProduct: 'missing' },
    { filamentProduct: '' },
    { printerId: 1 },
    { unexpected: 'value' },
    { textFilamentProduct: 'missing' },
    { textFilamentProduct: 1 },
  ])('rejects malformed or unknown input: %j', (input) => {
    expect(() => resolveConfiguration(input, INITIAL_CONFIGURATION)).toThrow();
  });
});
