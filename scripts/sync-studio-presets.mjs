// Build-time references only: Studio supplies the full installed system presets.
// Never synthesize machine suffixes or export inherited machine G-code.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const machines = JSON.parse(await readFile('data/bambu-machines.json', 'utf8'));
const catalog = JSON.parse(await readFile('data/bambu-catalog.json', 'utf8'));
const commit = machines.source.commit;
if (catalog.source.commit !== commit)
  throw new Error('Catalog snapshot commits differ');
const root = `https://raw.githubusercontent.com/bambulab/BambuStudio/${commit}/resources/profiles`;
const cache = new Map();
const hashes = new Map();
async function load(relative) {
  if (!cache.has(relative))
    cache.set(
      relative,
      (async () => {
        const response = await fetch(
          `${root}/${relative.split('/').map(encodeURIComponent).join('/')}`,
        );
        if (!response.ok) throw new Error(`${response.status}: ${relative}`);
        const text = await response.text();
        hashes.set(relative, createHash('sha256').update(text).digest('hex'));
        return JSON.parse(text);
      })(),
    );
  return cache.get(relative);
}
const index = await load('BBL.json');
const entries = new Map(
  [...index.machine_list, ...index.process_list, ...index.filament_list].map(
    (entry) => [entry.name, entry],
  ),
);
async function resolve(name, stack = []) {
  if (stack.includes(name)) throw new Error(`Preset cycle: ${name}`);
  const entry = entries.get(name);
  if (!entry) throw new Error(`Missing preset ${name}`);
  const own = await load(`BBL/${entry.sub_path}`);
  const parent = own.inherits
    ? await resolve(own.inherits, [...stack, name])
    : {};
  return {
    ...parent,
    ...own,
    ancestors: [...(parent.ancestors || []), own.inherits].filter(Boolean),
  };
}
async function mapLimit(values, fn) {
  let next = 0;
  const result = [];
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < values.length) {
        const position = next++;
        result[position] = await fn(values[position]);
      }
    }),
  );
  return result;
}
const bases = [
  ...new Set(catalog.catalog.map((row) => row.specs.profile).filter(Boolean)),
];
const candidates = index.filament_list.filter(
  (entry) =>
    bases.some((base) =>
      entry.name.startsWith(base.replace(/ @base$/, ' @')),
    ) &&
    !entry.name.endsWith(' @base') &&
    !/ 0\.[268](?: |$)/.test(entry.name),
);
const profiles = await mapLimit(candidates, (entry) => resolve(entry.name));
const printers = await mapLimit(machines.machines, async (machine) => {
  const printer = await resolve(`${machine.fullName} 0.4 nozzle`);
  const process = await resolve(printer.default_print_profile);
  if (
    !process.compatible_printers?.includes(printer.name) ||
    Number(process.layer_height) !== 0.2
  )
    throw new Error(`No compatible 0.20 mm process for ${printer.name}`);
  const filaments = {};
  for (const base of bases) {
    const prefix = base.replace(/ @base$/, ' @');
    const matches = profiles.filter(
      (profile) =>
        profile.name.startsWith(prefix) &&
        String(profile.instantiation) === 'true' &&
        profile.ancestors.includes(base) &&
        profile.compatible_printers?.includes(printer.name),
    );
    if (matches.length > 1)
      throw new Error(`Ambiguous preset: ${base} / ${printer.name}`);
    if (
      matches.length &&
      catalog.catalog.some(
        (row) =>
          row.specs.profile === base && row.amsId !== matches[0].filament_id,
      )
    )
      throw new Error(`Filament family mismatch for ${base}`);
    if (matches.length)
      filaments[base] = {
        name: matches[0].name,
        settingId: matches[0].setting_id,
        isSupport: matches[0].filament_is_support[0],
      };
  }
  return [
    machine.fullName,
    {
      printerPreset: printer.name,
      processPreset: process.name,
      nozzleDiameter: '0.4',
      nozzleDiameters: printer.nozzle_diameter,
      extruderTypes: printer.extruder_type,
      printableArea: printer.printable_area,
      printableHeight: printer.printable_height,
      bedExcludeArea: printer.bed_exclude_area,
      extruderPrintableAreas: printer.extruder_printable_area || [],
      wrappingExcludeArea: printer.wrapping_exclude_area || [],
      filaments,
    },
  ];
});
const output = {
  schemaVersion: 1,
  source: {
    repository: machines.source.repository,
    commit,
    profileVersion: index.version,
    license: 'AGPL-3.0-only',
    inputsSha256: createHash('sha256')
      .update(
        JSON.stringify(
          [...hashes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
      )
      .digest('hex'),
    inputFiles: hashes.size,
  },
  printers: Object.fromEntries(printers),
};
await writeFile(
  path.resolve('data/bambu-studio-presets.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(
  `Saved ${printers.length} printer mappings from ${hashes.size} pinned upstream files.`,
);
