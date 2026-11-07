import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILAMENT } from '../lib/catalog';
import {
  batchQuantityTotal,
  expandBatchQuantities,
} from '../lib/batch-quantity';
import { generateLabelBatch } from '../lib/generate-label-batch';
import {
  prepareLabelPlates,
  generatePreparedLabelPlates,
  type PrepareLabelPlatesOptions,
} from '../lib/generate-label-plates';
import { BatchPreview } from '../components/batch-preview';
import * as geometry from '../lib/generate-3mf';
import * as placement from '../lib/build-plate';

const options = () => ({
  labels: [{ filament: DEFAULT_FILAMENT, textColor: 'white' as const }],
  printer: 'Bambu Lab X2D',
  design: 'clip-label' as const,
  isCurrent: () => true,
  onProgress() {},
});

describe('bounded batch quantities', () => {
  it('expands selected copies without mutating or merging label choices', () => {
    const first = { id: 'one' };
    const second = { id: 'two' };
    const rows = [
      { label: first, copies: 2 },
      { label: second, copies: 3 },
    ];
    expect(batchQuantityTotal(rows)).toBe(5);
    expect(expandBatchQuantities(rows)).toEqual([
      first,
      first,
      second,
      second,
      second,
    ]);
    expect(rows.map((row) => row.copies)).toEqual([2, 3]);
    expect(batchQuantityTotal([])).toBe(0);
    expect(() => expandBatchQuantities([])).toThrow('Select');
  });
  it('rejects fractional, missing, negative, oversized and nonnumeric copies and total overflow', () => {
    for (const copies of [0, -1, 1.5, 9, NaN, Infinity, undefined, '2'])
      expect(() =>
        expandBatchQuantities([{ label: 'one', copies: copies as number }]),
      ).toThrow('copies');
    expect(() =>
      expandBatchQuantities([
        { label: 'one', copies: 8 },
        { label: 'two', copies: 1 },
      ]),
    ).toThrow('including copies');
    expect(expandBatchQuantities([{ label: 'one', copies: 8 }])).toHaveLength(
      8,
    );
  });
});

describe('one prepared batch plan for preview and download', () => {
  it('exports exactly the preview transforms, without rebuilding meshes or repacking', async () => {
    const input = options();
    input.labels = expandBatchQuantities([
      { label: input.labels[0], copies: 3 },
    ]);
    const plan = await prepareLabelPlates(input);
    expect(plan.labelCount).toBe(3);
    expect(plan.plateCount).toBe(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(
      Object.isFrozen(plan.plates[0].labels[0].placement.translation),
    ).toBe(true);
    const build = vi.spyOn(geometry, 'buildConfiguredMeshes');
    const pack = vi.spyOn(placement, 'placeAssembliesOnBed');
    try {
      const result = await generatePreparedLabelPlates(plan, {
        isCurrent: () => true,
      });
      expect(build).not.toHaveBeenCalled();
      expect(pack).not.toHaveBeenCalled();
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      const project = await JSZip.loadAsync(
        await zip.file('plate-1-pla.3mf')!.async('arraybuffer'),
      );
      const xml = await project.file('3D/3dmodel.model')!.async('string');
      const manifest = JSON.parse(
        await project.file('Metadata/spoolstamp-plate.json')!.async('string'),
      );
      for (const [index, label] of plan.plates[0].labels.entries()) {
        expect(xml).toContain(
          `transform="1 0 0 0 1 0 0 0 1 ${label.placement.translation.join(' ')}"`,
        );
        expect(manifest.labels[index].placement).toEqual(label.placement);
        expect(manifest.labels[index].previewIndex).toBe(label.index);
      }
      const markup = renderToStaticMarkup(
        createElement(BatchPreview, { plan }),
      );
      expect(markup).toContain('top-down bounds preview');
      expect(markup).toContain('3 labels');
      expect(markup).toContain('not a slice');
      expect(markup).not.toContain('LOCAL-FIXTURE');
    } finally {
      build.mockRestore();
      pack.mockRestore();
    }
  });
  it('captures input catalog metadata and rejects forged or stale plans', async () => {
    const input: PrepareLabelPlatesOptions = options();
    input.labels = [
      { ...input.labels[0], filament: structuredClone(DEFAULT_FILAMENT) },
    ];
    const plan = await prepareLabelPlates(input);
    input.labels[0].filament.colorName = 'changed after preview';
    input.labels[0].textColor = 'black';
    input.labels[0].textFilamentProduct = 'PLA Matte';
    input.labels = [];
    const result = await generatePreparedLabelPlates(plan, {
      isCurrent: () => true,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const project = await JSZip.loadAsync(
      await zip.file('plate-1-pla.3mf')!.async('arraybuffer'),
    );
    expect(
      await project.file('Metadata/spoolstamp-plate.json')!.async('string'),
    ).not.toContain('changed after preview');
    const projectSettings = JSON.parse(
      await project.file('Metadata/project_settings.config')!.async('string'),
    );
    expect(projectSettings.filament_colour).toContain('#FFFFFF');
    expect(
      projectSettings.filament_settings_id.every(
        (name: string) => !name.includes('PLA Matte'),
      ),
    ).toBe(true);
    await expect(
      generatePreparedLabelPlates({ ...plan }, { isCurrent: () => true }),
    ).rejects.toThrow('Prepare');
    await expect(
      generatePreparedLabelPlates(plan, { isCurrent: () => false }),
    ).rejects.toThrow('changed');
    let calls = 0;
    await expect(
      generatePreparedLabelPlates(plan, { isCurrent: () => ++calls < 3 }),
    ).rejects.toThrow('changed');
  });
  it('shows and exports centered separate-copy projects with unique archive names', async () => {
    const input = options();
    const plan = await prepareLabelPlates({
      ...input,
      labels: [input.labels[0], input.labels[0]],
      layout: 'separate',
    });
    expect(plan.layout).toBe('separate');
    expect(plan.plateCount).toBe(2);
    const centered = placement.placeAssemblyOnBed(
      await geometry.buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        'clip-label',
        'white',
      ),
      (await import('../lib/studio-project')).studioPresetFor(
        DEFAULT_FILAMENT,
        input.printer,
      ).printer,
    );
    expect(
      plan.plates.every(
        (plate) =>
          JSON.stringify(plate.labels[0].placement) ===
          JSON.stringify(centered),
      ),
    ).toBe(true);
    const result = await generatePreparedLabelPlates(plan, {
      isCurrent: () => true,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(
      Object.keys(zip.files).filter((name) => name.endsWith('.3mf')),
    ).toEqual([
      'label-1-pla-basic-bambu-green-clip-label-simple.3mf',
      'label-2-pla-basic-bambu-green-clip-label-simple.3mf',
    ]);
  });
  it('carries per-label and default content layouts through legacy separate exports', async () => {
    const blob = await generateLabelBatch({
      ...options(),
      design: 'adhesive-label',
      labelLayout: 'detailed',
      labels: [
        { filament: DEFAULT_FILAMENT, labelLayout: 'simple' },
        { filament: DEFAULT_FILAMENT },
      ],
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((name) =>
      name.endsWith('.3mf'),
    );
    expect(new Set(names).size).toBe(2);
    const layouts = [];
    for (const name of names) {
      const project = await JSZip.loadAsync(
        await zip.file(name)!.async('arraybuffer'),
      );
      const metadata = JSON.parse(
        await project.file('Metadata/filament-label-lab.json')!.async('string'),
      );
      layouts.push(metadata.labelLayout);
    }
    expect(layouts).toEqual(['simple', 'detailed']);
  }, 15000);
  it('retains rounded design provenance and each label content layout in the captured plate', async () => {
    const plan = await prepareLabelPlates({
      ...options(),
      design: 'rounded-adhesive-label',
      labels: [
        { filament: DEFAULT_FILAMENT, labelLayout: 'simple' },
        { filament: DEFAULT_FILAMENT, labelLayout: 'detailed' },
      ],
    });
    const result = await generatePreparedLabelPlates(plan, {
      isCurrent: () => true,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const project = await JSZip.loadAsync(
      await zip.file('plate-1-pla.3mf')!.async('arraybuffer'),
    );
    const manifest = JSON.parse(
      await project.file('Metadata/spoolstamp-plate.json')!.async('string'),
    );
    expect(manifest.template.origin).toBe('Spoolstamp original');
    expect(manifest.template.dimensions).toMatchObject({
      width: 60,
      height: 25,
      cornerRadius: 2,
    });
    expect(
      manifest.labels.map(
        (label: { labelLayout: string }) => label.labelLayout,
      ),
    ).toEqual(['simple', 'detailed']);
    expect(manifest.physicalQualification).toBe('pending');
  }, 15000);
});
