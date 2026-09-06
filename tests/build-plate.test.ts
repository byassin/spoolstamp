import { describe, expect, it } from 'vitest';
import {
  assemblyBounds,
  placeAssemblyOnBed,
  BED_PLACEMENT_MARGIN,
  type PrintBed,
} from '../lib/build-plate';
import { buildConfiguredMeshes } from '../lib/generate-3mf';
import { DEFAULT_FILAMENT, PRINTERS, type DesignId } from '../lib/catalog';
import { studioPresetFor } from '../lib/studio-project';

const testBed: PrintBed = {
  printableArea: ['0x0', '256x0', '256x256', '0x256'],
  printableHeight: '256',
  bedExcludeArea: ['0x0', '18x0', '18x28', '0x28'],
  extruderPrintableAreas: [],
  wrappingExcludeArea: [],
};
const cuboid = [{ vertices: [0, 0, 0, 60, 88, 4] }];

describe('export placement', () => {
  it('moves the whole assembly away from the front-left exclusion zone', () => {
    const before = structuredClone(cuboid);
    const placement = placeAssemblyOnBed(cuboid, testBed);
    expect(placement.translation).toEqual([98, 84, -0]);
    expect(placement.bounds).toEqual({ min: [98, 84, 0], max: [158, 172, 4] });
    expect(cuboid).toEqual(before);
  });

  it.each<DesignId>(['drybox-tab', 'clip-label'])(
    'places %s safely for every offered printer',
    async (design) => {
      const meshes = await buildConfiguredMeshes(DEFAULT_FILAMENT, design);
      const local = assemblyBounds(meshes);
      for (const item of PRINTERS) {
        const { printer } = studioPresetFor(DEFAULT_FILAMENT, item.fullName);
        const placement = placeAssemblyOnBed(meshes, printer);
        expect(placement.bounds.min[2]).toBe(0);
        for (const [axis, dimension] of [
          [0, 'x'],
          [1, 'y'],
        ] as const) {
          const coordinates = printer.printableArea.map((point) =>
            Number(point.trim().split('x')[axis]),
          );
          expect(
            placement.bounds.min[axis],
            `${item.name} ${dimension}`,
          ).toBeGreaterThanOrEqual(
            Math.min(...coordinates) + BED_PLACEMENT_MARGIN,
          );
          expect(
            placement.bounds.max[axis],
            `${item.name} ${dimension}`,
          ).toBeLessThanOrEqual(
            Math.max(...coordinates) - BED_PLACEMENT_MARGIN,
          );
          expect(
            placement.bounds.max[axis] - placement.bounds.min[axis],
          ).toBeCloseTo(local.max[axis] - local.min[axis], 8);
        }
      }
    },
  );

  it('centers within the common nozzle area on X2D, not the larger single-nozzle area', () => {
    const { printer } = studioPresetFor(DEFAULT_FILAMENT, 'Bambu Lab X2D');
    const placement = placeAssemblyOnBed(cuboid, printer);
    expect((placement.bounds.min[0] + placement.bounds.max[0]) / 2).toBe(
      138.25,
    );
  });

  it('accepts translated source coordinates and keeps every part together on Z=0', () => {
    const meshes = [{ vertices: [-40, -20, 7, 20, 68, 11] }];
    expect(placeAssemblyOnBed(meshes, testBed).bounds).toEqual({
      min: [98, 84, 0],
      max: [158, 172, 4],
    });
    expect(meshes[0].vertices).toEqual([-40, -20, 7, 20, 68, 11]);
  });

  it('refuses oversized, excluded, malformed or unsupported bed layouts', () => {
    expect(() =>
      placeAssemblyOnBed([{ vertices: [0, 0, 0, 250, 88, 4] }], testBed),
    ).toThrow('does not fit safely');
    expect(() =>
      placeAssemblyOnBed(cuboid, { ...testBed, printableHeight: '2' }),
    ).toThrow('does not fit safely');
    expect(() =>
      placeAssemblyOnBed(cuboid, {
        ...testBed,
        bedExcludeArea: ['100x100', '150x100', '150x150', '100x150'],
      }),
    ).toThrow('exclusion area');
    expect(() =>
      placeAssemblyOnBed(cuboid, {
        ...testBed,
        printableArea: ['0x0', '256x0', '100x256'],
      }),
    ).toThrow('not supported');
    expect(() =>
      placeAssemblyOnBed(cuboid, {
        ...testBed,
        printableArea: ['wrong', '0x0', '1x1'],
      }),
    ).toThrow('Invalid printer');
    expect(() => placeAssemblyOnBed([], testBed)).toThrow('empty model');
  });
});
