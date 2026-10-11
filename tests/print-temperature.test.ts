import { describe, expect, it } from 'vitest';
import rangeData from '../data/bambu-print-ranges.json';
import { DEFAULT_FILAMENT, FILAMENTS, FILAMENT_TYPES } from '../lib/catalog';
import {
  formatNozzleRange,
  printTemperatureLabel,
  recommendedNozzleRange,
} from '../lib/print-temperature';
import { buildConfiguredMeshes } from '../lib/generate-3mf';

describe('manufacturer print-temperature ranges', () => {
  it('keeps PLA Basic and Tough+ recommendations distinct from their preset', () => {
    expect(formatNozzleRange(recommendedNozzleRange('PLA Basic'))).toBe(
      '190–230 °C',
    );
    expect(formatNozzleRange(recommendedNozzleRange('PLA Tough+'))).toBe(
      '220–250 °C',
    );
    const tough = FILAMENTS.find((item) => item.product === 'PLA Tough+')!;
    expect(tough.nozzleTemperature).toBe(245);
    expect(tough.nozzleTemperatureRange).toEqual(
      recommendedNozzleRange('PLA Tough+'),
    );
  });

  it('accounts for each catalog product with a source or an explicit unresolved status', () => {
    const covered = [
      ...rangeData.ranges.map((row) => row.product),
      ...rangeData.unverifiedProducts,
      ...rangeData.conflictingProducts.map((row) => row.product),
    ];
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.sort()).toEqual(
      FILAMENT_TYPES.map((row) => row.product).sort(),
    );
    for (const row of rangeData.ranges) {
      expect(Number.isInteger(row.min) && Number.isInteger(row.max)).toBe(true);
      expect(row.min).toBeGreaterThan(0);
      expect(row.max).toBeGreaterThan(row.min);
      expect(new URL(row.sourceUrl).protocol).toBe('https:');
    }
  });

  it('never invents a family fallback for unknown or conflicting products', () => {
    for (const product of [
      'PLA',
      'PLA Tough',
      'PLA Basic New',
      'toString',
      ...rangeData.conflictingProducts.map((row) => row.product),
    ])
      expect(recommendedNozzleRange(product)).toBeNull();
    expect(formatNozzleRange(null)).toBe('Not verified');
    expect(printTemperatureLabel(null)).toBe('Print: see guide');
  });

  it('embosses a printable range with dash and degree symbol', async () => {
    for (const product of ['PLA Basic', 'PLA Tough+', 'PPS-CF']) {
      const filament = FILAMENTS.find((row) => row.product === product)!;
      const meshes = await buildConfiguredMeshes(filament, 'drybox-tab');
      const row = meshes
        .find((mesh) => mesh.name === 'raised-text')!
        .textRows!.at(-1)!;
      expect(row.value).toBe(
        printTemperatureLabel(filament.nozzleTemperatureRange),
      );
      expect(row.strokeAudit?.passes).toBe(true);
      expect(row.width).toBeLessThanOrEqual(54.0001);
    }
  });

  it('invalidates preview/export mesh caching when only the range changes', async () => {
    const first = buildConfiguredMeshes(DEFAULT_FILAMENT, 'drybox-tab');
    const changed = buildConfiguredMeshes(
      { ...DEFAULT_FILAMENT, nozzleTemperatureRange: null },
      'drybox-tab',
    );
    expect(first).not.toBe(changed);
    const meshes = await changed;
    expect(
      meshes.find((mesh) => mesh.name === 'raised-text')!.textRows!.at(-1)!
        .value,
    ).toBe('Print: see guide');
    await first;
  });

  it('leaves the two-line clip label unchanged', async () => {
    const meshes = await buildConfiguredMeshes(DEFAULT_FILAMENT, 'clip-label');
    const rows = meshes.find((mesh) => mesh.name === 'raised-text')!.textRows!;
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.value.startsWith('Print:'))).toBe(false);
  });
});
