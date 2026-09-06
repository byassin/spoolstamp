import snapshot from '@/data/bambu-studio-presets.json';
import type { Filament } from '@/lib/catalog';
import { resolveTextFilament } from '@/lib/text-filament';
import {
  normalizeColor,
  textColorForFilament,
} from '@/lib/filament-appearance';

type PrinterPresets = {
  printerPreset: string;
  processPreset: string;
  nozzleDiameter: string;
  nozzleDiameters: string[];
  extruderTypes: string[];
  printableArea: string[];
  printableHeight: string;
  bedExcludeArea: string[];
  extruderPrintableAreas: string[];
  wrappingExcludeArea: string[];
  filaments: Record<
    string,
    { name: string; settingId: string; isSupport: string }
  >;
};
const printers: Record<string, PrinterPresets> = snapshot.printers;

export function studioBodyColor(filament: Filament) {
  const color = normalizeColor(filament.colors[0]);
  // Studio project swatches are opaque RGB. Clear is not black; retain the
  // true RGBA/palette in our manifest and use the preview's neutral here.
  return color.endsWith('00') ? '#D9E0DB' : color.slice(0, 7);
}

export function studioPrinterFor(printerName: string) {
  const printer = printers[printerName];
  if (!printer)
    throw new Error(`No Bambu Studio preset is available for ${printerName}.`);
  return printer;
}

export function studioPresetFor(filament: Filament, printerName: string) {
  const printer = studioPrinterFor(printerName);
  const preset = filament.profile && printer.filaments[filament.profile];
  if (!preset) {
    throw new Error(
      `Bambu Studio has no compatible ${filament.product} preset for ${printerName} with a 0.4 mm nozzle. Choose a compatible printer or filament to export.`,
    );
  }
  return { printer, preset };
}

export function studioProjectSettings(
  filament: Filament,
  printerName: string,
  textFilamentProduct?: string,
) {
  const { printer, preset } = studioPresetFor(filament, printerName);
  const textFilament = resolveTextFilament(filament, textFilamentProduct);
  const { preset: textPreset } = studioPresetFor(textFilament, printerName);
  // Exact system IDs let Studio restore the complete compatible presets. Empty
  // differences mean we do not override their machine G-code or slicing values.
  // Colour belongs to the project, not to a customized filament preset.
  // Diameter MUST have one entry per spool: Studio normalizes all filament
  // vectors to its length, even when filament_colour already has two entries.
  return {
    name: 'project_settings',
    from: 'project',
    printer_technology: 'FFF',
    printer_model: printerName,
    printer_variant: printer.nozzleDiameter,
    printer_settings_id: printer.printerPreset,
    print_settings_id: printer.processPreset,
    nozzle_diameter: [...printer.nozzleDiameters],
    extruder_type: [...printer.extruderTypes],
    printable_area: [...printer.printableArea],
    printable_height: printer.printableHeight,
    bed_exclude_area: [...printer.bedExcludeArea],
    filament_settings_id: [preset.name, textPreset.name],
    filament_ids: [filament.amsId, textFilament.amsId],
    filament_type: [filament.material, textFilament.material],
    filament_vendor: ['Bambu Lab', 'Bambu Lab'],
    filament_is_support: [preset.isSupport, textPreset.isSupport],
    filament_diameter: ['1.75', '1.75'],
    filament_colour: [
      studioBodyColor(filament),
      textColorForFilament(filament.colors).slice(0, 7),
    ],
    // Explicit two-filament project defaults; never inherit a previous job's
    // zero entries. Studio stores one row-major N*N table per physical nozzle.
    // 140 load/unload and 280 transitions are Studio PrintConfig defaults, not
    // color-calibrated purge volumes. Only self-transitions should be zero.
    flush_volumes_vector: ['140', '140', '140', '140'],
    flush_volumes_matrix: printer.nozzleDiameters.flatMap(() => [
      '0',
      '280',
      '280',
      '0',
    ]),
    flush_multiplier: printer.nozzleDiameters.map(() => '1'),
    flush_multiplier_fast: printer.nozzleDiameters.map(() => '1.2'),
    inherits_group: ['', '', '', ''],
    different_settings_to_system: ['', '', '', ''],
  };
}
