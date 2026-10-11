import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import JSZip from 'jszip';
import { DEFAULT_FILAMENT } from '../lib/catalog';
import {
  TEXT_COLORS,
  commonTextTypes,
  resolveTextColor,
} from '../lib/text-color';
import {
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  sameConfiguration,
} from '../lib/builder-configuration';
import { buildConfiguredMeshes, generate3mf } from '../lib/generate-3mf';
import { TextFilamentControl } from '../components/text-filament-control';
import { generateLabelBatch } from '../lib/generate-label-batch';

describe('optional text color override', () => {
  it('carries a manual color through AMS batch ZIP export', async () => {
    const blob = await generateLabelBatch({
      labels: [
        {
          filament: DEFAULT_FILAMENT,
          textColor: 'gray',
          textFilamentProduct: 'PLA Matte',
        },
      ],
      design: 'clip-label',
      printer: 'Bambu Lab X2D',
      isCurrent: () => true,
      onProgress() {},
    });
    const batch = await JSZip.loadAsync(await blob.arrayBuffer());
    const entry = Object.values(batch.files).find((file) =>
      file.name.endsWith('.3mf'),
    )!;
    const model = await JSZip.loadAsync(await entry.async('arraybuffer'));
    const settings = JSON.parse(
      await model.file('Metadata/project_settings.config')!.async('string'),
    );
    expect(settings.filament_colour[1]).toBe('#AFB1AE');
    expect(settings.filament_settings_id[1]).toContain('PLA Matte');
  });
  it('keeps automatic contrast by default and rejects arbitrary colors', () => {
    expect(resolveTextColor(DEFAULT_FILAMENT)).toMatch(/^#(000000|FFFFFF)FF$/);
    for (const choice of TEXT_COLORS)
      expect(resolveTextColor(DEFAULT_FILAMENT, choice.id)).toBe(choice.hex);
    expect(() =>
      resolveConfiguration({ textColor: '#123456' }, INITIAL_CONFIGURATION),
    ).toThrow('supported text color');
    const custom = resolveConfiguration(
      { textColor: 'gray' },
      INITIAL_CONFIGURATION,
    );
    expect(sameConfiguration(custom, INITIAL_CONFIGURATION)).toBe(false);
    expect(
      resolveConfiguration({ textColor: 'automatic' }, custom).textColor,
    ).toBeUndefined();
  });
  it('shows a discoverable override and a restricted same-material profile list', () => {
    const defaults = renderToStaticMarkup(
      createElement(TextFilamentControl, {
        body: DEFAULT_FILAMENT,
        onChange() {},
        onAutomatic() {},
      }),
    );
    expect(defaults).toContain('Customize text color');
    expect(defaults).toContain('Automatic contrast');
    const custom = renderToStaticMarkup(
      createElement(TextFilamentControl, {
        body: DEFAULT_FILAMENT,
        color: 'gray',
        onChange() {},
        onAutomatic() {},
      }),
    );
    expect(custom).toContain('Use automatic text');
    expect(custom).toContain('aria-pressed="true"');
    expect(custom).not.toMatch(/Support for|PLA Glow|PLA Silk|PLA Metal/);
    expect(
      commonTextTypes(DEFAULT_FILAMENT).every(
        (item) => item.material === DEFAULT_FILAMENT.material,
      ),
    ).toBe(true);
    expect(commonTextTypes(DEFAULT_FILAMENT).length).toBeLessThanOrEqual(4);
  });
  it.each(['drybox-tab', 'clip-label'] as const)(
    'exports %s text color consistently without changing cached automatic meshes',
    async (design) => {
      const original = await buildConfiguredMeshes(DEFAULT_FILAMENT, design);
      const oldColor = original.find(
        (part) => part.materialRole === 'raised-text',
      )!.color;
      const custom = await buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        design,
        'red',
      );
      expect(
        custom.find((part) => part.materialRole === 'raised-text')!.color,
      ).toBe('#C12E1FFF');
      expect(
        original.find((part) => part.materialRole === 'raised-text')!.color,
      ).toBe(oldColor);
      const result = await generate3mf({
        filament: DEFAULT_FILAMENT,
        design,
        printer: 'Bambu Lab X2D',
        textColor: 'red',
        textFilamentProduct: 'PLA Matte',
      });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      const project = JSON.parse(
        await zip.file('Metadata/project_settings.config')!.async('string'),
      );
      expect(project.filament_colour[1]).toBe('#C12E1F');
      expect(project.filament_settings_id[1]).toContain('PLA Matte');
      const metadata = JSON.parse(
        await zip.file('Metadata/filament-label-lab.json')!.async('string'),
      );
      expect(
        metadata.materialRoles.find(
          (part: { role: string }) => part.role === 'raised-text',
        ).color,
      ).toBe('#C12E1F');
      expect(await zip.file('3D/3dmodel.model')!.async('string')).toContain(
        '#C12E1FFF',
      );
    },
  );
});
