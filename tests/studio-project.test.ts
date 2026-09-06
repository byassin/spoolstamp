import { describe, expect, it } from 'vitest';
import { FILAMENTS, PRINTERS, DEFAULT_FILAMENT } from '../lib/catalog';
import { studioProjectSettings } from '../lib/studio-project';
import snapshot from '../data/bambu-studio-presets.json';
import { textColorForFilament } from '../lib/filament-appearance';
import { generate3mf } from '../lib/generate-3mf';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

describe('Bambu project presets', () => {
  it('exports Tough+ Cyan with independent PLA Basic black text', async () => {
    const filament = FILAMENTS.find(
      (row) => row.product === 'PLA Tough+' && row.colorName === 'Cyan',
    )!;
    const basic = FILAMENTS.find((row) => row.product === 'PLA Basic')!;
    const printer = 'Bambu Lab X2D';
    const project = studioProjectSettings(filament, printer);
    expect(project.filament_ids).toEqual([filament.amsId, basic.amsId]);
    expect(project.filament_settings_id[0]).toContain('Bambu PLA Tough+');
    expect(project.filament_settings_id[1]).toContain('Bambu PLA Basic');
    expect(project.filament_colour).toEqual(['#009BD8', '#000000']);
    const { blob, filename } = await generate3mf({
      filament,
      printer,
      design: 'drybox-tab',
    });
    expect(filename).toContain('-hinge-r2.3mf');
    const bytes = Buffer.from(await blob.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    expect(
      JSON.parse(
        await zip.file('Metadata/project_settings.config')!.async('string'),
      ),
    ).toEqual(project);
    const metadata = JSON.parse(
      await zip.file('Metadata/filament-label-lab.json')!.async('string'),
    );
    expect(JSON.stringify(metadata)).toContain('bearing-relief-0.075mm-v2');
    expect(
      metadata.materialRoles.find(
        (role: { role: string }) => role.role === 'raised-text',
      ),
    ).toMatchObject({
      product: 'PLA Basic',
      amsId: basic.amsId,
    });
    await mkdir('.tmp/studio-config-verification', { recursive: true });
    await writeFile(
      '.tmp/studio-config-verification/tough-basic-x2d.3mf',
      bytes,
    );
  });

  it('uses the chosen text profile without changing either color', () => {
    const body = FILAMENTS.find(
      (row) => row.product === 'PLA Tough+' && row.colorName === 'Cyan',
    )!;
    const basic = studioProjectSettings(body, 'Bambu Lab X2D');
    const matte = studioProjectSettings(body, 'Bambu Lab X2D', 'PLA Matte');
    expect(matte.filament_settings_id[1]).toContain('Bambu PLA Matte');
    expect(matte.filament_ids[1]).toBe(
      FILAMENTS.find((row) => row.product === 'PLA Matte')!.amsId,
    );
    expect(matte.filament_settings_id[0]).toBe(basic.filament_settings_id[0]);
    expect(matte.filament_colour).toEqual(basic.filament_colour);
    expect(() =>
      studioProjectSettings(body, 'Bambu Lab X2D', 'PETG HF'),
    ).toThrow('match the label material');
    expect(() =>
      studioProjectSettings(body, 'Bambu Lab X2D', 'missing'),
    ).toThrow('Unknown text');
  });

  it.each([
    ['PLA Basic', 'Bambu Lab P1S', 'Bambu PLA Basic @BBL P1S 0.4 nozzle'],
    ['PETG HF', 'Bambu Lab A1 mini', 'Bambu PETG HF @BBL A1M'],
    ['PLA Basic', 'Bambu Lab X1 Carbon', 'Bambu PLA Basic @BBL X1C'],
    ['PLA Basic', 'Bambu Lab H2D', 'Bambu PLA Basic @BBL H2D'],
  ])(
    'selects the actual %s system preset for %s',
    (product, printer, preset) => {
      const filament = FILAMENTS.find((row) => row.product === product)!;
      const project = studioProjectSettings(filament, printer);
      expect(project.filament_settings_id).toEqual([preset, preset]);
      expect(project.filament_type).toEqual([
        filament.material,
        filament.material,
      ]);
      expect(project.filament_ids).toEqual([filament.amsId, filament.amsId]);
      expect(project.printer_model).toBe(printer);
      expect(project.nozzle_diameter).toEqual(
        printer === 'Bambu Lab H2D' ? ['0.4', '0.4'] : ['0.4'],
      );
      expect(project.extruder_type).toHaveLength(
        project.nozzle_diameter.length,
      );
      expect(project.different_settings_to_system).toEqual(['', '', '', '']);
      expect(JSON.stringify(project)).not.toContain('gcode');
    },
  );

  it('exports exactly two spools for every supported catalog/printer pair', () => {
    for (const printer of PRINTERS) {
      const mapping =
        snapshot.printers[printer.fullName as keyof typeof snapshot.printers];
      expect(mapping).toBeDefined();
      for (const filament of FILAMENTS) {
        const supported =
          !!filament.profile && filament.profile in mapping.filaments;
        if (!supported) {
          expect(() =>
            studioProjectSettings(filament, printer.fullName),
          ).toThrow('no compatible');
          continue;
        }
        const project = studioProjectSettings(filament, printer.fullName);
        expect(project.filament_diameter).toEqual(['1.75', '1.75']);
        expect(project.filament_colour).toEqual([
          filament.colors[0].endsWith('00')
            ? '#D9E0DB'
            : filament.colors[0].slice(0, 7).toUpperCase(),
          textColorForFilament(filament.colors).slice(0, 7),
        ]);
        expect(project.filament_colour[1]).toMatch(/^#(?:000000|FFFFFF)$/);
        expect(project.filament_type).toEqual([
          filament.material,
          filament.material,
        ]);
        expect(project.filament_settings_id).toHaveLength(2);
        expect(project.flush_volumes_vector).toEqual([
          '140',
          '140',
          '140',
          '140',
        ]);
        expect(project.flush_volumes_matrix).toHaveLength(
          project.nozzle_diameter.length * 4,
        );
        for (
          let nozzle = 0;
          nozzle < project.nozzle_diameter.length;
          nozzle++
        ) {
          expect(
            project.flush_volumes_matrix.slice(nozzle * 4, nozzle * 4 + 4),
          ).toEqual(['0', '280', '280', '0']);
          expect(Number(project.flush_multiplier[nozzle])).toBe(1);
          expect(Number(project.flush_multiplier_fast[nozzle])).toBe(1.2);
        }
      }
    }
  });

  it('does not silently substitute PLA or PETG when a printer cannot use a product', () => {
    const abs = FILAMENTS.find((row) => row.product === 'ABS')!;
    expect(() => studioProjectSettings(abs, 'Bambu Lab A1 mini')).toThrow(
      'no compatible ABS preset',
    );
    expect(() =>
      studioProjectSettings(DEFAULT_FILAMENT, 'Unknown printer'),
    ).toThrow('No Bambu Studio preset');
    expect(() =>
      studioProjectSettings(
        { ...DEFAULT_FILAMENT, profile: null },
        'Bambu Lab P1S',
      ),
    ).toThrow('no compatible');
  });

  it.each([
    ['PETG HF', 'Bambu Lab P1S', 'petg-p1s'],
    ['PLA Basic', 'Bambu Lab X2D', 'pla-x2d'],
  ])(
    'writes a native-import fixture for %s on %s',
    async (product, printer, name) => {
      const filament = FILAMENTS.find(
        (row) => row.product === product && row.colorName === 'Black',
      )!;
      expect(filament).toBeDefined();
      const project = studioProjectSettings(filament, printer);
      expect(project.filament_colour[1]).toBe('#FFFFFF');
      if (printer.endsWith('X2D')) {
        expect(project.nozzle_diameter).toEqual(['0.4', '0.4']);
        expect(project.extruder_type).toEqual(['Direct Drive', 'Bowden']);
      }
      const { blob } = await generate3mf({
        filament,
        printer,
        design: 'clip-label',
      });
      await mkdir('.tmp/studio-config-verification', { recursive: true });
      await writeFile(
        `.tmp/studio-config-verification/${name}.3mf`,
        Buffer.from(await blob.arrayBuffer()),
      );
    },
  );
});
