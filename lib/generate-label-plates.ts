import JSZip from 'jszip';
import { type BatchLabel, MAX_BATCH_LABELS } from './generate-label-batch';
import { type DesignId } from './catalog';
import {
  buildConfiguredMeshes,
  escapeXml,
  objectXml,
  type LabelMesh,
} from './generate-3mf';
import { placeAssembliesOnBed } from './build-plate';
import { resolveTextFilament } from './text-filament';
import { resolveTextColor } from './text-color';
import {
  studioBodyColor,
  studioPresetFor,
  studioProjectSettings,
} from './studio-project';

export const MAX_PLATE_FILAMENTS = 4;
type Spool = {
  product: string;
  color: string;
  amsId: string;
  material: string;
  preset: string;
  support: string;
};
type PreparedLabel = {
  label: BatchLabel;
  meshes: LabelMesh[];
  group: string;
  body: Spool;
  text: Spool;
};
type Plate = {
  rows: PreparedLabel[];
  placements: ReturnType<typeof placeAssembliesOnBed>;
  spools: Spool[];
};
const spoolKey = (spool: Spool) => JSON.stringify([spool.preset, spool.color]);
function plateSpools(rows: PreparedLabel[]) {
  const spools: Spool[] = [];
  for (const row of rows)
    for (const spool of [row.body, row.text])
      if (!spools.some((item) => spoolKey(item) === spoolKey(spool)))
        spools.push(spool);
  return spools;
}
function projectSettings(plate: Plate, printer: string) {
  const first = plate.rows[0].label;
  const base = studioProjectSettings(
    first.filament,
    printer,
    first.textFilamentProduct,
    first.textColor,
  );
  const n = plate.spools.length;
  return {
    ...base,
    filament_settings_id: plate.spools.map((spool) => spool.preset),
    filament_ids: plate.spools.map((spool) => spool.amsId),
    filament_type: plate.spools.map((spool) => spool.material),
    filament_vendor: plate.spools.map(() => 'Bambu Lab'),
    filament_is_support: plate.spools.map((spool) => spool.support),
    filament_diameter: plate.spools.map(() => '1.75'),
    filament_colour: plate.spools.map((spool) => spool.color),
    flush_volumes_vector: Array(n * 2).fill('140'),
    flush_volumes_matrix: base.nozzle_diameter.flatMap(() =>
      Array.from({ length: n * n }, (_, i) =>
        Math.floor(i / n) === i % n ? '0' : '280',
      ),
    ),
    inherits_group: Array(n + 2).fill(''),
    different_settings_to_system: Array(n + 2).fill(''),
  };
}
async function exportPlate(plate: Plate, printer: string, design: DesignId) {
  const colors = [
    ...new Set(
      plate.rows.flatMap((row) => row.meshes.map((part) => part.color)),
    ),
  ];
  const objects: string[] = [];
  const settings: string[] = [];
  const instances: string[] = [];
  const build: string[] = [];
  const manifest: unknown[] = [];
  let nextId = 2;
  for (const [index, row] of plate.rows.entries()) {
    const ids = row.meshes.map(() => nextId++);
    const assembly = nextId++;
    const body =
      plate.spools.findIndex(
        (spool) => spoolKey(spool) === spoolKey(row.body),
      ) + 1;
    const text =
      plate.spools.findIndex(
        (spool) => spoolKey(spool) === spoolKey(row.text),
      ) + 1;
    const name = `${index + 1}. ${row.label.filament.product} · ${row.label.filament.colorName}`;
    const faceCount = row.meshes.reduce(
      (total, part) => total + part.triangles.length / 3,
      0,
    );
    row.meshes.forEach((part, at) =>
      objects.push(objectXml(part, ids[at], 1, colors.indexOf(part.color))),
    );
    objects.push(
      `<object id="${assembly}" name="${escapeXml(name)}" type="model"><components>${ids.map((id) => `<component objectid="${id}"/>`).join('')}</components></object>`,
    );
    settings.push(
      `<object id="${assembly}"><metadata key="name" value="${escapeXml(name)}"/><metadata key="extruder" value="${body}"/><metadata face_count="${faceCount}"/>${row.meshes.map((part, at) => `<part id="${ids[at]}" subtype="normal_part"><metadata key="name" value="${escapeXml(part.name)}"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><metadata key="extruder" value="${part.materialRole === 'raised-text' ? text : body}"/><mesh_stat face_count="${part.triangles.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part>`).join('')}</object>`,
    );
    instances.push(
      `<model_instance><metadata key="object_id" value="${assembly}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${index + 1}"/></model_instance>`,
    );
    build.push(
      `<item objectid="${assembly}" transform="1 0 0 0 1 0 0 0 1 ${plate.placements[index].translation.join(' ')}" printable="1"/>`,
    );
    manifest.push({
      name,
      filamentId: row.label.filament.id,
      bodyPalette: row.label.filament.colors,
      bodyColorType: row.label.filament.colorType,
      textProduct: row.text.product,
      textColor: row.text.color,
      bodyFilament: body,
      textFilament: text,
      placement: plate.placements[index],
      textRows: row.meshes.find((part) => part.materialRole === 'raised-text')
        ?.textRows,
    });
  }
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/><Default Extension="json" ContentType="application/json"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  );
  zip.file(
    '3D/3dmodel.model',
    `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" recommendedextensions="m"><metadata name="Title">Spoolstamp label plate</metadata><metadata name="Application">BambuStudio-02.08.02.61+Spoolstamp.0.1.0</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Description">Generated by Spoolstamp, not Bambu Studio. Confirm spool assignments and slice before printing.</metadata><resources><m:colorgroup id="1">${colors.map((color) => `<m:color color="${color}"/>`).join('')}</m:colorgroup>${objects.join('')}</resources><build>${build.join('')}</build></model>`,
  );
  zip.file(
    'Metadata/model_settings.config',
    `<?xml version="1.0" encoding="UTF-8"?><config>${settings.join('')}<plate><metadata key="plater_id" value="1"/><metadata key="locked" value="false"/>${instances.join('')}</plate></config>`,
  );
  zip.file(
    'Metadata/project_settings.config',
    JSON.stringify(projectSettings(plate, printer), null, 2),
  );
  zip.file(
    'Metadata/spoolstamp-plate.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        generator: 'Spoolstamp',
        printer,
        design,
        labels: manifest,
        spools: plate.spools,
        slicingRequired: true,
        physicalQualification: 'pending',
        placementGapMm: 6,
        bedMarginMm: 10,
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** Separate exact body/text product pairs; split again for bed space and four project filaments. */
export async function generateLabelPlates(options: {
  labels: BatchLabel[];
  printer: string;
  design: DesignId;
  isCurrent(): boolean;
  onProgress(done: number, total: number): void;
}) {
  if (!options.labels.length || options.labels.length > MAX_BATCH_LABELS)
    throw new Error(`Select between 1 and ${MAX_BATCH_LABELS} labels.`);
  const check = () => {
    if (!options.isCurrent())
      throw new Error(
        'Label selection changed. Review the labels and try again.',
      );
  };
  check();
  const plates: Plate[] = [];
  for (const [index, label] of options.labels.entries()) {
    check();
    const { printer, preset } = studioPresetFor(
      label.filament,
      options.printer,
    );
    const textFilament = resolveTextFilament(
      label.filament,
      label.textFilamentProduct,
    );
    const textPreset = studioPresetFor(textFilament, options.printer).preset;
    if (preset.isSupport === '1' || textPreset.isSupport === '1')
      throw new Error(
        'Support filaments are not supported for combined label plates. Export separate projects instead.',
      );
    const meshes = await buildConfiguredMeshes(
      label.filament,
      options.design,
      label.textColor,
    );
    check();
    const row: PreparedLabel = {
      label,
      meshes,
      group: JSON.stringify([label.filament.product, textFilament.product]),
      body: {
        product: label.filament.product,
        color: studioBodyColor(label.filament),
        amsId: label.filament.amsId,
        material: label.filament.material,
        preset: preset.name,
        support: preset.isSupport,
      },
      text: {
        product: textFilament.product,
        color: resolveTextColor(label.filament, label.textColor).slice(0, 7),
        amsId: textFilament.amsId,
        material: textFilament.material,
        preset: textPreset.name,
        support: textPreset.isSupport,
      },
    };
    let fitted = false;
    for (const plate of plates) {
      if (plate.rows[0].group !== row.group) continue;
      const rows = [...plate.rows, row];
      const spools = plateSpools(rows);
      if (spools.length > MAX_PLATE_FILAMENTS) continue;
      let placements: Plate['placements'];
      try {
        placements = placeAssembliesOnBed(
          rows.map((item) => item.meshes),
          printer,
        );
      } catch {
        continue;
      }
      plate.rows = rows;
      plate.placements = placements;
      plate.spools = spools;
      fitted = true;
      break;
    }
    if (!fitted)
      plates.push({
        rows: [row],
        placements: placeAssembliesOnBed([meshes], printer),
        spools: plateSpools([row]),
      });
    options.onProgress(index + 1, options.labels.length);
  }
  const zip = new JSZip();
  for (const [index, plate] of plates.entries()) {
    check();
    const blob = await exportPlate(plate, options.printer, options.design);
    check();
    zip.file(
      `plate-${index + 1}-${plate.rows[0].label.filament.material.toLowerCase()}.3mf`,
      await blob.arrayBuffer(),
    );
  }
  zip.file(
    'READ-ME.txt',
    `${plates.length} plate project(s), ${options.labels.length} labels.\nGrouped conservatively by exact body/text product pairs, printable area and a four-filament limit. No mechanics scaled or rotated.\nOpen each 3MF as a project in Bambu Studio. Confirm all physical AMS spool assignments, inspect placement and purge tower/brim clearance, then slice. Remaining bed space is not a guarantee that a purge tower fits; Studio collision checks are still required. Physical multi-label printing has not yet been qualified.\n`,
  );
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  check();
  return { blob, plates: plates.length, labels: options.labels.length };
}
