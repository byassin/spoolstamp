import JSZip from 'jszip';
import { APP_VERSION } from './app-version';
import { type BatchLabel, MAX_BATCH_LABELS } from './generate-label-batch';
import { type DesignId } from './catalog';
import {
  buildConfiguredMeshes,
  escapeXml,
  objectXml,
  type LabelMesh,
} from './generate-3mf';
import {
  placeAssembliesOnBed,
  placeAssemblyOnBed,
  printBedLayout,
} from './build-plate';
import { effectiveLabelLayout, type LabelLayout } from './label-layout';
import { ADHESIVE_LABEL, ROUNDED_ADHESIVE_LABEL } from './adhesive-label';
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
  index: number;
};
type Plate = {
  rows: PreparedLabel[];
  placements: ReturnType<typeof placeAssembliesOnBed>;
  spools: Spool[];
};
export type BatchExportLayout = 'plates' | 'separate';
type PreviewRectangle = Readonly<ReturnType<typeof printBedLayout>['bounds']>;
type PreviewPoint = readonly [number, number, number];
export type PreviewPlacement = {
  readonly translation: PreviewPoint;
  readonly bounds: { readonly min: PreviewPoint; readonly max: PreviewPoint };
  readonly clearance: number;
};
export type PreparedPlatePreview = {
  readonly bed: {
    readonly bounds: PreviewRectangle;
    readonly common: PreviewRectangle;
    readonly restricted: readonly Readonly<
      ReturnType<typeof printBedLayout>['restricted'][number]
    >[];
  };
  readonly filaments: readonly Readonly<Spool>[];
  readonly labels: readonly {
    readonly index: number;
    readonly name: string;
    readonly product: string;
    readonly colorName: string;
    readonly bodyColor: string;
    readonly textColor: string;
    readonly placement: PreviewPlacement;
  }[];
};
export type PreparedLabelPlates = {
  readonly printer: string;
  readonly design: DesignId;
  readonly layout: BatchExportLayout;
  readonly labelCount: number;
  readonly plateCount: number;
  readonly plates: readonly PreparedPlatePreview[];
};
type PlanInternals = {
  plates: Plate[];
  printer: string;
  design: DesignId;
  layout: BatchExportLayout;
  labelCount: number;
};
// Meshes stay private and are reused from the bounded geometry cache. A forged or
// deserialized preview is not an export plan, and React can release obsolete plans.
const preparedPlans = new WeakMap<PreparedLabelPlates, PlanInternals>();
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
async function exportPlate(
  plate: Plate,
  printer: string,
  design: DesignId,
  check: () => void,
) {
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
    check();
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
    const name = `${row.index}. ${row.label.filament.product} · ${row.label.filament.colorName}`;
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
      previewIndex: row.index,
      filamentId: row.label.filament.id,
      bodyPalette: row.label.filament.colors,
      bodyColorType: row.label.filament.colorType,
      textProduct: row.text.product,
      textColor: row.text.color,
      labelLayout: row.label.labelLayout,
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
    `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" recommendedextensions="m"><metadata name="Title">Spoolstamp label plate</metadata><metadata name="Application">BambuStudio-02.08.02.61+Spoolstamp.${APP_VERSION}</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Description">Generated by Spoolstamp, not Bambu Studio. Confirm spool assignments and slice before printing.</metadata><resources><m:colorgroup id="1">${colors.map((color) => `<m:color color="${color}"/>`).join('')}</m:colorgroup>${objects.join('')}</resources><build>${build.join('')}</build></model>`,
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
        generatorVersion: APP_VERSION,
        printer,
        design,
        ...(['adhesive-label', 'rounded-adhesive-label'].includes(design)
          ? {
              template: {
                origin: 'Spoolstamp original',
                dimensions:
                  design === 'rounded-adhesive-label'
                    ? ROUNDED_ADHESIVE_LABEL
                    : ADHESIVE_LABEL,
                userSuppliedAdhesive: true,
              },
            }
          : {}),
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
  check();
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** Separate exact body/text product pairs; split again for bed space and four project filaments. */
export type PrepareLabelPlatesOptions = {
  labels: BatchLabel[];
  printer: string;
  design: DesignId;
  labelLayout?: LabelLayout;
  layout?: BatchExportLayout;
  isCurrent(): boolean;
  onProgress(done: number, total: number): void;
};

export async function prepareLabelPlates(
  options: PrepareLabelPlatesOptions,
): Promise<PreparedLabelPlates> {
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
  const layout = options.layout ?? 'plates';
  if (!['plates', 'separate'].includes(layout))
    throw new Error('Choose a supported batch layout.');
  for (const [index, input] of options.labels.entries()) {
    check();
    // Capture the user's catalog choice, not references to mutable caller input.
    const label: BatchLabel = {
      ...input,
      filament: structuredClone(input.filament),
      labelLayout: effectiveLabelLayout(
        options.design,
        input.labelLayout ?? options.labelLayout,
      ),
    };
    const { printer, preset } = studioPresetFor(
      label.filament,
      options.printer,
    );
    const textFilament = resolveTextFilament(
      label.filament,
      label.textFilamentProduct,
    );
    const textPreset = studioPresetFor(textFilament, options.printer).preset;
    if (
      layout === 'plates' &&
      (preset.isSupport === '1' || textPreset.isSupport === '1')
    )
      throw new Error(
        'Support filaments are not supported for combined label plates. Export separate projects instead.',
      );
    const meshes = await buildConfiguredMeshes(
      label.filament,
      options.design,
      label.textColor,
      label.labelLayout,
    );
    check();
    const row: PreparedLabel = {
      index: index + 1,
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
    if (layout === 'separate') {
      plates.push({
        rows: [row],
        placements: [placeAssemblyOnBed(meshes, printer)],
        spools: plateSpools([row]),
      });
      options.onProgress(index + 1, options.labels.length);
      continue;
    }
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
  check();
  const preview = plates.map((plate) => {
    const bed = printBedLayout(
      studioPresetFor(plate.rows[0].label.filament, options.printer).printer,
    );
    return Object.freeze({
      bed: Object.freeze({
        bounds: Object.freeze(bed.bounds),
        common: Object.freeze(bed.common),
        restricted: Object.freeze(
          bed.restricted.map((rect) => Object.freeze(rect)),
        ),
      }),
      filaments: Object.freeze(
        plate.spools.map((spool) => Object.freeze({ ...spool })),
      ),
      labels: Object.freeze(
        plate.rows.map((row, index) => {
          const placement = plate.placements[index];
          // JSON/3MF serialize -0 as 0; keep preview metadata canonical too.
          placement.translation = placement.translation.map((value) =>
            value === 0 ? 0 : value,
          ) as typeof placement.translation;
          Object.freeze(placement.translation);
          Object.freeze(placement.bounds.min);
          Object.freeze(placement.bounds.max);
          Object.freeze(placement.bounds);
          Object.freeze(placement);
          return Object.freeze({
            index: row.index,
            name: `${row.label.filament.product} · ${row.label.filament.colorName}`,
            product: row.label.filament.product,
            colorName: row.label.filament.colorName,
            bodyColor: row.body.color,
            textColor: row.text.color,
            placement,
          });
        }),
      ),
    });
  });
  const plan: PreparedLabelPlates = Object.freeze({
    printer: options.printer,
    design: options.design,
    layout,
    labelCount: options.labels.length,
    plateCount: plates.length,
    plates: Object.freeze(preview),
  });
  preparedPlans.set(plan, {
    plates,
    printer: options.printer,
    design: options.design,
    layout,
    labelCount: options.labels.length,
  });
  return plan;
}

/** Export the exact captured placements/meshes shown in the preview, never repack. */
export async function generatePreparedLabelPlates(
  plan: PreparedLabelPlates,
  options: {
    isCurrent(): boolean;
    onProgress?(done: number, total: number): void;
  },
) {
  const prepared = preparedPlans.get(plan);
  if (!prepared)
    throw new Error('Prepare the batch preview again before downloading.');
  const check = () => {
    if (!options.isCurrent())
      throw new Error(
        'Label selection changed. Review the labels and try again.',
      );
  };
  check();
  const zip = new JSZip();
  for (const [index, plate] of prepared.plates.entries()) {
    check();
    const blob = await exportPlate(
      plate,
      prepared.printer,
      prepared.design,
      check,
    );
    check();
    const choice = plate.rows[0].label;
    const name = [choice.filament.product, choice.filament.colorName]
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    zip.file(
      prepared.layout === 'plates'
        ? `plate-${index + 1}-${choice.filament.material.toLowerCase()}.3mf`
        : `label-${index + 1}-${name}-${prepared.design}-${choice.labelLayout}.3mf`,
      await blob.arrayBuffer(),
    );
    options.onProgress?.(index + 1, prepared.plates.length);
  }
  zip.file(
    'READ-ME.txt',
    `${prepared.plates.length} plate project(s), ${prepared.labelCount} labels.\nGrouped conservatively by exact body/text product pairs, printable area and a four-filament limit. No mechanics scaled or rotated.\nOpen each 3MF as a project in Bambu Studio. Confirm all physical AMS spool assignments, inspect placement and purge tower/brim clearance, then slice. Remaining bed space is not a guarantee that a purge tower fits; Studio collision checks are still required. Physical multi-label printing has not yet been qualified.\n`,
  );
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  check();
  return { blob, plates: prepared.plates.length, labels: prepared.labelCount };
}

/** Compatibility API for callers that do not render a preview. */
export async function generateLabelPlates(options: PrepareLabelPlatesOptions) {
  const plan = await prepareLabelPlates(options);
  return generatePreparedLabelPlates(plan, {
    isCurrent: () => options.isCurrent(),
  });
}
