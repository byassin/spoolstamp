import { expect, it } from 'vitest';
import { DEFAULT_FILAMENT, FILAMENTS } from '../lib/catalog';
import { CLIP_LABEL } from '../lib/clip-label';
import { buildConfiguredMeshes } from '../lib/generate-3mf';

it.each(['drybox-tab', 'clip-label'] as const)(
  '%s keeps short color names at one font scale and fits long names',
  async (design) => {
    const rows = [];
    for (const colorName of [
      'Black',
      'Cyan',
      'White',
      'Gray',
      'Sunflower Yellow',
    ]) {
      const meshes = await buildConfiguredMeshes(
        { ...DEFAULT_FILAMENT, product: 'PLA Tough+', colorName },
        design,
      );
      const row = meshes
        .find((part) => part.textRows)
        ?.textRows?.find((row) => row.value === colorName);
      expect(row).toBeDefined();
      expect(row!.strokeAudit?.passes).toBe(true);
      expect(row!.width).toBeLessThanOrEqual(
        design === 'drybox-tab' ? 54.00001 : 36.50001,
      );
      expect(row!.height).toBeLessThanOrEqual(
        design === 'drybox-tab' ? 8.8 : 5.4,
      );
      rows.push(row!);
    }
    for (const row of rows.slice(1, 4)) {
      expect(row.scale).toBeCloseTo(rows[0].scale, 8);
    }
    expect(rows[4].scale).toBeLessThanOrEqual(rows[0].scale);
    if (design === 'drybox-tab') expect(rows[0].height).toBeGreaterThan(6.5);
  },
  30_000,
);

it.each(['drybox-tab', 'clip-label'] as const)(
  '%s keeps catalog lettering printable and inside the face',
  async (design) => {
    for (const filament of FILAMENTS) {
      const meshes = await buildConfiguredMeshes(filament, design);
      const text = meshes.find((part) => part.textRows)!;
      expect(
        text.textRows!.every((row) => row.strokeAudit?.passes),
        filament.id,
      ).toBe(true);
      const xs = text.vertices.filter((_, index) => index % 3 === 0);
      const vertical = text.vertices.filter(
        (_, index) => index % 3 === (design === 'drybox-tab' ? 1 : 2),
      );
      const area =
        design === 'drybox-tab'
          ? { minX: 3, maxX: 57, minZ: 3, maxZ: 58 }
          : CLIP_LABEL.textArea;
      expect(Math.min(...xs), filament.id).toBeGreaterThanOrEqual(
        area.minX - 0.0001,
      );
      expect(Math.max(...xs), filament.id).toBeLessThanOrEqual(
        area.maxX + 0.0001,
      );
      expect(Math.min(...vertical), filament.id).toBeGreaterThanOrEqual(
        area.minZ - 0.0001,
      );
      expect(Math.max(...vertical), filament.id).toBeLessThanOrEqual(
        area.maxZ + 0.0001,
      );
    }
  },
  120_000,
);
