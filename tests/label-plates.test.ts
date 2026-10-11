import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_FILAMENT, FILAMENTS, PRINTERS } from '../lib/catalog';
import {
  generateLabelPlates,
  MAX_PLATE_FILAMENTS,
} from '../lib/generate-label-plates';
import { buildConfiguredMeshes, objectXml } from '../lib/generate-3mf';
import { placeAssembliesOnBed, LABEL_PLACEMENT_GAP } from '../lib/build-plate';
import { studioPresetFor } from '../lib/studio-project';
const options = () => ({
  labels: [{ filament: DEFAULT_FILAMENT, textColor: 'white' as const }],
  printer: 'Bambu Lab X2D',
  design: 'clip-label' as const,
  isCurrent: () => true,
  onProgress() {},
});
const bed = {
  printableArea: ['0x0', '180x0', '180x180', '0x180'],
  printableHeight: '180',
  bedExcludeArea: ['0x0', '30x0', '30x30', '0x30'],
  extruderPrintableAreas: [],
  wrappingExcludeArea: [],
};
describe('multi-label plates', () => {
  it('packs whole assemblies without changing vertices and clears exclusions', () => {
    const meshes = [{ vertices: [-10, -20, 2, 50, 60, 6] }];
    const before = structuredClone(meshes);
    const placements = placeAssembliesOnBed([meshes, meshes], bed);
    expect(meshes).toEqual(before);
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.bounds.min[2] === 0)).toBe(true);
    const [a, b] = placements;
    expect(
      b.bounds.min[0] >= a.bounds.max[0] + LABEL_PLACEMENT_GAP ||
        b.bounds.min[1] >= a.bounds.max[1] + LABEL_PLACEMENT_GAP,
    ).toBe(true);
    expect(() =>
      placeAssembliesOnBed([[{ vertices: [0, 0, 0, 180, 180, 2] }]], bed),
    ).toThrow('fit safely');
  });
  it.each(['drybox-tab', 'clip-label'] as const)(
    'packs %s within every supported printer common-nozzle bed',
    async (design) => {
      const meshes = await buildConfiguredMeshes(DEFAULT_FILAMENT, design);
      for (const printer of PRINTERS) {
        const profile = studioPresetFor(
          DEFAULT_FILAMENT,
          printer.fullName,
        ).printer;
        const places = placeAssembliesOnBed([meshes], profile);
        expect(places[0].bounds.min[2]).toBe(0);
      }
    },
  );
  it('exports two independent multipart objects and correctly sized filament vectors', async () => {
    const request = options();
    request.labels.push(request.labels[0]);
    const result = await generateLabelPlates(request);
    expect(result.plates).toBe(1);
    const outer = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const model = await JSZip.loadAsync(
      await outer.file('plate-1-pla.3mf')!.async('arraybuffer'),
    );
    const xml = await model.file('3D/3dmodel.model')!.async('string');
    expect(xml.match(/<item objectid=/g)).toHaveLength(2);
    const ids = [...xml.matchAll(/<object id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const source = await buildConfiguredMeshes(
      DEFAULT_FILAMENT,
      'clip-label',
      'white',
    );
    const colors = [...new Set(source.map((part) => part.color))];
    // The objects retain exactly the single-label vertex/triangle serialization;
    // only whole-assembly build transforms differ between label instances.
    for (const [index, part] of source.entries())
      expect(xml).toContain(
        objectXml(part, index + 2, 1, colors.indexOf(part.color)),
      );
    const settings = JSON.parse(
      await model.file('Metadata/project_settings.config')!.async('string'),
    );
    const n = settings.filament_colour.length;
    expect(n).toBeLessThanOrEqual(MAX_PLATE_FILAMENTS);
    for (const key of [
      'filament_settings_id',
      'filament_ids',
      'filament_type',
      'filament_vendor',
      'filament_is_support',
      'filament_diameter',
    ])
      expect(settings[key]).toHaveLength(n);
    expect(settings.flush_volumes_vector).toHaveLength(n * 2);
    expect(settings.flush_volumes_matrix).toHaveLength(
      n * n * settings.nozzle_diameter.length,
    );
    const manifest = JSON.parse(
      await model.file('Metadata/spoolstamp-plate.json')!.async('string'),
    );
    expect(manifest.labels).toHaveLength(2);
    for (const label of manifest.labels) {
      expect(label.bodyFilament).toBeGreaterThan(0);
      expect(label.textFilament).toBeLessThanOrEqual(n);
      expect(label.bodyPalette).toEqual(DEFAULT_FILAMENT.colors);
      expect(label.textColor).toBe('#FFFFFF');
    }
    expect(
      (
        await model.file('Metadata/model_settings.config')!.async('string')
      ).match(/<model_instance>/g),
    ).toHaveLength(2);
  });
  it('separates material/product pairs, excess colors and small-bed layouts', async () => {
    const colors = FILAMENTS.filter(
      (row) => row.product === 'PLA Basic' && row.colorType === 'single',
    ).slice(0, 5);
    const result = await generateLabelPlates({
      ...options(),
      labels: colors.map((filament) => ({ filament, textColor: 'white' })),
    });
    expect(result.plates).toBeGreaterThan(1);
    const petg = FILAMENTS.find((row) => row.product === 'PETG Basic')!;
    expect(
      (
        await generateLabelPlates({
          ...options(),
          labels: [{ filament: DEFAULT_FILAMENT }, { filament: petg }],
        })
      ).plates,
    ).toBe(2);
    const hinged = await generateLabelPlates({
      ...options(),
      design: 'drybox-tab',
      printer: 'Bambu Lab A1 mini',
      labels: Array(8).fill({ filament: DEFAULT_FILAMENT }),
    });
    expect(hinged.plates).toBeGreaterThan(1);
  }, 30_000);
  it('refuses empty, oversized, stale, incompatible and support-filament requests', async () => {
    await expect(
      generateLabelPlates({ ...options(), labels: [] }),
    ).rejects.toThrow('Select between');
    await expect(
      generateLabelPlates({
        ...options(),
        labels: Array(9).fill(options().labels[0]),
      }),
    ).rejects.toThrow('Select between');
    await expect(
      generateLabelPlates({ ...options(), isCurrent: () => false }),
    ).rejects.toThrow('changed');
    let calls = 0;
    await expect(
      generateLabelPlates({ ...options(), isCurrent: () => ++calls < 3 }),
    ).rejects.toThrow('changed');
    await expect(
      generateLabelPlates({ ...options(), printer: 'Unknown' }),
    ).rejects.toThrow('preset');
    const support = FILAMENTS.find((row) => row.product === 'Support for PLA')!;
    expect(support).toBeDefined();
    await expect(
      generateLabelPlates({
        ...options(),
        labels: [{ filament: support }],
      }),
    ).rejects.toThrow('Support filaments');
  });
});
