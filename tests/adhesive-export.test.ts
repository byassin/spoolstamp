import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_FILAMENT } from '../lib/catalog';
import { generate3mf } from '../lib/generate-3mf';
import { generateLabelBatch } from '../lib/generate-label-batch';
import { generateLabelPlates } from '../lib/generate-label-plates';
import { APP_VERSION } from '../lib/app-version';
describe('flat-label export integration', () => {
  it('exports original provenance, requested text color, full names and valid placement', async () => {
    const model = await generate3mf({
      filament: DEFAULT_FILAMENT,
      design: 'adhesive-label',
      printer: 'Bambu Lab A1 mini',
      textColor: 'red',
    });
    const zip = await JSZip.loadAsync(await model.blob.arrayBuffer());
    const data = JSON.parse(
      await zip.file('Metadata/filament-label-lab.json')!.async('string'),
    );
    expect(data.design).toBe('adhesive-label');
    expect(data.template.origin).toBe('Spoolstamp original');
    expect(data.template.sourceSha256).toBeUndefined();
    expect(data.generator.version).toBe(APP_VERSION);
    expect(data.buildPlatePlacement.bounds.min[2]).toBe(0);
    expect(data.materialRoles[1].color).toBe('#C12E1F');
    expect(
      data.textRows.map(
        (row: { sourceValue?: string; value: string }) =>
          row.sourceValue ?? row.value,
      ),
    ).toContain(DEFAULT_FILAMENT.colorName);
    expect(await zip.file('docProps/core.xml')!.async('string')).not.toContain(
      'User-supplied filament clip',
    );
    expect(model.filename).toContain('adhesive-label');
  });
  it('supports separate and arranged batch projects', async () => {
    const options = {
      labels: [{ filament: DEFAULT_FILAMENT }, { filament: DEFAULT_FILAMENT }],
      design: 'adhesive-label' as const,
      printer: 'Bambu Lab A1 mini',
      isCurrent: () => true,
      onProgress() {},
    };
    const separate = await JSZip.loadAsync(
      await (await generateLabelBatch(options)).arrayBuffer(),
    );
    expect(
      Object.keys(separate.files).filter((name) => name.endsWith('.3mf')),
    ).toHaveLength(2);
    const plate = await generateLabelPlates(options);
    expect(plate.plates).toBe(1);
  }, 15000);
});
