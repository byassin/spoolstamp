import { describe, expect, it } from 'vitest';
import report from '../data/sync-report.json';
import {
  CATALOG_META,
  DESIGNS,
  FILAMENTS,
  FILAMENTS_BY_PRODUCT,
  FILAMENT_TYPES,
  PRINTERS,
} from '../lib/catalog';
import { buildConfiguredMeshes } from '../lib/generate-3mf';

describe('generated Bambu catalog', () => {
  it('offers only the two supplied mechanical designs', () => {
    expect(DESIGNS.map((design) => design.id)).toEqual([
      'drybox-tab',
      'clip-label',
    ]);
  });

  it('matches the committed sync report and provenance contract', () => {
    expect(FILAMENTS).toHaveLength(report.catalogRows);
    expect(PRINTERS).toHaveLength(report.machineModels);
    expect(report.unmatchedProfileTypes).toEqual([]);
    expect(CATALOG_META.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('keeps color codes unique and every preview color normalized', () => {
    expect(new Set(FILAMENTS.map((item) => item.colorCode)).size).toBe(
      FILAMENTS.length,
    );
    for (const filament of FILAMENTS) {
      expect(filament.colors.length).toBeGreaterThan(0);
      expect(
        filament.colors.every((color) => /^#[0-9A-F]{8}$/.test(color)),
      ).toBe(true);
    }
  });

  it('groups the catalog into a type-first color hierarchy', () => {
    expect(FILAMENT_TYPES).toHaveLength(46);
    const groupedIds: string[] = [];
    for (const type of FILAMENT_TYPES) {
      const colors = FILAMENTS_BY_PRODUCT.get(type.product) ?? [];
      expect(colors).toHaveLength(type.colorCount);
      expect(colors.length).toBeGreaterThan(0);
      expect(
        colors.every((filament) => filament.product === type.product),
      ).toBe(true);
      groupedIds.push(...colors.map((filament) => filament.id));
    }
    expect(groupedIds.sort()).toEqual(
      FILAMENTS.map((filament) => filament.id).sort(),
    );
  });

  it('builds printable text strokes for every catalog row and built-in design', async () => {
    const failures: string[] = [];
    for (const filament of FILAMENTS) {
      for (const design of DESIGNS) {
        const meshes = await buildConfiguredMeshes(filament, design.id).catch(
          (error) => {
            failures.push(
              `${filament.product} / ${filament.colorName} / ${design.id}: ${error.message}`,
            );
            return [];
          },
        );
        if (!meshes.length) continue;
        expect(meshes.length).toBeGreaterThanOrEqual(2);
        const lettering = meshes.find((mesh) => mesh.name === 'raised-text');
        expect(lettering).toBeDefined();
        if (design.id === 'clip-label') {
          expect(lettering?.textRows).toHaveLength(2);
          for (const row of lettering?.textRows ?? []) {
            expect(
              row.strokeAudit?.passes,
              `${filament.product}: ${row.value}`,
            ).toBe(true);
            expect(row.width).toBeLessThanOrEqual(36.5001);
            expect(row.centerY - row.height / 2).toBeGreaterThanOrEqual(1.2);
            expect(row.centerY + row.height / 2).toBeLessThanOrEqual(13.8);
          }
          continue;
        }
        if (design.id === 'drybox-tab') {
          expect(lettering?.textRows?.length).toBeGreaterThanOrEqual(6);
          for (const row of lettering?.textRows ?? []) {
            expect(
              row.strokeAudit?.passes,
              `${filament.product}: ${row.value}`,
            ).toBe(true);
            expect(
              row.strokeAudit?.minimumComponentAreaRecovery,
            ).toBeGreaterThanOrEqual(0.98);
            expect(row.width).toBeLessThanOrEqual(54.0001);
            expect(row.centerY - row.height / 2).toBeGreaterThanOrEqual(2.9999);
            expect(row.centerY + row.height / 2).toBeLessThanOrEqual(58.0001);
          }
          continue;
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
