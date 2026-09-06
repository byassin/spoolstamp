'use client';

import {
  normalizeColor as rgb,
  textColorForFilament,
} from '@/lib/filament-appearance';
import type { DesignId, Filament } from '@/lib/catalog';
import {
  buildSuppliedDryBoxMeshes,
  SUPPLIED_DRYBOX,
} from '@/lib/supplied-drybox';
import { addVectorTextLine, type VectorTextPlacement } from '@/lib/vector-text';
import { TEXT_PRINT_SPEC } from '@/lib/text-printability';
import { buildClipLabelMeshes, CLIP_LABEL } from '@/lib/clip-label';
import {
  studioBodyColor,
  studioPresetFor,
  studioProjectSettings,
} from '@/lib/studio-project';
import { placeAssemblyOnBed } from '@/lib/build-plate';
import { HINGE_CLEARANCE } from '@/lib/hinge-clearance';
import { resolveTextFilament } from '@/lib/text-filament';

export type LabelMesh = {
  name: string;
  color: string;
  materialRole: 'structure' | 'raised-text';
  preserveSourceCoordinates?: boolean;
  textRows?: Array<
    VectorTextPlacement & {
      value: string;
      sourceValue?: string;
      centerX: number;
      centerY: number;
    }
  >;
  vertices: number[];
  triangles: number[];
};

type GenerateOptions = {
  filament: Filament;
  design: DesignId;
  printer: string;
  textFilamentProduct?: string;
};

function mesh(
  name: string,
  color: string,
  materialRole: LabelMesh['materialRole'] = 'structure',
): LabelMesh {
  return {
    name,
    color: rgb(color),
    materialRole,
    vertices: [],
    triangles: [],
  };
}

function validateMesh(value: LabelMesh) {
  if (!value.vertices.length || value.triangles.length % 3 !== 0)
    throw new Error(`${value.name}: invalid mesh arrays`);
  const vertexCount = value.vertices.length / 3;
  for (const coordinate of value.vertices) {
    if (!Number.isFinite(coordinate))
      throw new Error(`${value.name}: non-finite coordinate`);
  }
  for (let index = 0; index < value.triangles.length; index += 3) {
    const a = value.triangles[index];
    const b = value.triangles[index + 1];
    const c = value.triangles[index + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount)
      throw new Error(`${value.name}: triangle index out of range`);
    const ax = value.vertices[a * 3];
    const ay = value.vertices[a * 3 + 1];
    const az = value.vertices[a * 3 + 2];
    const abx = value.vertices[b * 3] - ax;
    const aby = value.vertices[b * 3 + 1] - ay;
    const abz = value.vertices[b * 3 + 2] - az;
    const acx = value.vertices[c * 3] - ax;
    const acy = value.vertices[c * 3 + 1] - ay;
    const acz = value.vertices[c * 3 + 2] - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-12) {
      throw new Error(`${value.name}: zero-area triangle`);
    }
  }
}

async function buildLabelMeshes(filament: Filament, design: DesignId) {
  if (design === 'drybox-tab') return buildDryBoxLabelMeshes(filament);
  if (design === 'clip-label') {
    const output = await buildClipLabelMeshes(filament);
    output.forEach(validateMesh);
    return output;
  }
  throw new Error('Unknown design.');
}

function wrapLabelLine(value: string, maxCharacters: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['?'];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(' ')];
}

async function buildDryBoxLabelMeshes(filament: Filament) {
  const structuralParts = await buildSuppliedDryBoxMeshes(filament.colors[0]);
  const lettering = mesh(
    'raised-text',
    textColorForFilament(filament.colors),
    'raised-text',
  );
  const maxWidth = 54;
  const top = 58;
  const bottom = 3;
  const usableHeight = top - bottom;
  const hex = filament.colors[0].slice(0, 7).toUpperCase();
  const nozzle =
    filament.nozzleTemperature == null
      ? 'Nozzle: profile default'
      : `Nozzle: ${filament.nozzleTemperature} °C`;

  const productLines = wrapLabelLine(filament.product, 16);
  const colorLines = wrapLabelLine(filament.colorName, 18);
  const rows = [
    ...productLines.map((value) => ({
      value,
      height: productLines.length === 1 ? 8.6 : 5.7,
    })),
    ...colorLines.map((value) => ({
      value,
      height: colorLines.length === 1 ? 7.4 : 5.2,
    })),
    { value: 'Bambu Lab', height: 5.2 },
    { value: `SKU: ${filament.colorCode}`, height: 5.2 },
    { value: `HEX: ${hex}`, height: 5.2 },
    { value: nozzle, height: 5.2 },
  ];
  const desiredHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const minimumGap = 1.4;
  const scale = Math.min(
    1,
    usableHeight / (desiredHeight + minimumGap * (rows.length - 1)),
  );
  const scaledHeight = desiredHeight * scale;
  const gap =
    rows.length === 1
      ? 0
      : Math.min(
          5.2,
          Math.max(
            minimumGap * scale,
            (usableHeight - scaledHeight) / (rows.length - 1),
          ),
        );
  let cursorY = top;
  const baseZ = SUPPLIED_DRYBOX.textFaceZ - TEXT_PRINT_SPEC.attachmentOverlap;
  const textDepth = TEXT_PRINT_SPEC.relief + TEXT_PRINT_SPEC.attachmentOverlap;
  lettering.textRows = [];

  for (const row of rows) {
    const height = row.height * scale;
    const centerY = cursorY - height / 2;
    const placement = await addVectorTextLine(
      lettering,
      row.value,
      30,
      centerY,
      baseZ,
      maxWidth,
      height,
      textDepth,
      TEXT_PRINT_SPEC.lineWidth,
    );
    if (placement)
      lettering.textRows.push({
        ...placement,
        value: row.value,
        centerX: 30,
        centerY,
      });
    cursorY -= height + gap;
  }

  const output = [...structuralParts, lettering];
  validateMesh(lettering);
  return output;
}

const meshCache = new Map<string, Promise<LabelMesh[]>>();

export function buildConfiguredMeshes(filament: Filament, design: DesignId) {
  const key = JSON.stringify([
    design,
    filament.product,
    filament.colorName,
    filament.material,
    filament.colorCode,
    filament.colors,
    filament.nozzleTemperature,
  ]);
  const existing = meshCache.get(key);
  if (existing) {
    meshCache.delete(key);
    meshCache.set(key, existing);
    return existing;
  }
  const pending = buildLabelMeshes(filament, design).catch((error: unknown) => {
    if (meshCache.get(key) === pending) meshCache.delete(key);
    throw error;
  });
  meshCache.set(key, pending);
  if (meshCache.size > 3) meshCache.delete(meshCache.keys().next().value!);
  return pending;
}

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] || character,
  );
}

function objectXml(
  value: LabelMesh,
  objectId: number,
  colorGroupId: number,
  colorIndex: number,
) {
  const vertices = [];
  for (let index = 0; index < value.vertices.length; index += 3) {
    vertices.push(
      `<vertex x="${value.preserveSourceCoordinates ? value.vertices[index].toString() : value.vertices[index].toFixed(5)}" y="${value.preserveSourceCoordinates ? value.vertices[index + 1].toString() : value.vertices[index + 1].toFixed(5)}" z="${value.preserveSourceCoordinates ? value.vertices[index + 2].toString() : value.vertices[index + 2].toFixed(5)}"/>`,
    );
  }
  const triangles = [];
  for (let index = 0; index < value.triangles.length; index += 3) {
    triangles.push(
      `<triangle v1="${value.triangles[index]}" v2="${value.triangles[index + 1]}" v3="${value.triangles[index + 2]}" pid="${colorGroupId}" p1="${colorIndex}" p2="${colorIndex}" p3="${colorIndex}"/>`,
    );
  }
  return `<object id="${objectId}" name="${escapeXml(value.name)}" type="model" pid="${colorGroupId}" pindex="${colorIndex}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}

function modelXml(
  meshes: LabelMesh[],
  options: GenerateOptions,
  placement: ReturnType<typeof placeAssemblyOnBed>,
) {
  const colorGroupId = 1;
  const firstObjectId = 2;
  const assemblyId = firstObjectId + meshes.length;
  const colors = [...new Set(meshes.map((value) => value.color))];
  const objects = meshes.map((value, index) =>
    objectXml(
      value,
      firstObjectId + index,
      colorGroupId,
      colors.indexOf(value.color),
    ),
  );
  const components = meshes
    .map((_, index) => `<component objectid="${firstObjectId + index}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:fll="https://filament-label-lab.dev/3mf/2026/metadata" recommendedextensions="m">
  <metadata name="Title">${escapeXml(`${options.filament.product} · ${options.filament.colorName} label`)}</metadata>
  <metadata name="Application">BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="fll:generator">Filament Label Lab</metadata>
  <metadata name="fll:compatibility">Application is an importer compatibility identifier; the actual generator is Filament Label Lab, not Bambu Studio.</metadata>
  <metadata name="fll:target_printer">${escapeXml(options.printer)}</metadata>
  <metadata name="fll:design">${escapeXml(options.design)}</metadata>
  <metadata name="fll:filament_color_code">${escapeXml(options.filament.colorCode)}</metadata>
  <metadata name="fll:ams_filament_id">${escapeXml(options.filament.amsId)}</metadata>
  <metadata name="fll:profile_colors">${escapeXml(options.filament.colors.join(','))}</metadata>
  <resources>
    <m:colorgroup id="${colorGroupId}">${colors.map((color) => `<m:color color="${color}"/>`).join('')}</m:colorgroup>
    ${objects.join('')}
    <object id="${assemblyId}" name="Filament label" type="model"><components>${components}</components></object>
  </resources>
  <build><item objectid="${assemblyId}" transform="1 0 0 0 1 0 0 0 1 ${placement.translation.join(' ')}" printable="1"/></build>
</model>`;
}

function modelSettingsXml(meshes: LabelMesh[]) {
  const firstObjectId = 2;
  const assemblyId = firstObjectId + meshes.length;
  const totalTriangles = meshes.reduce(
    (sum, value) => sum + value.triangles.length / 3,
    0,
  );
  const identity = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';
  const parts = meshes
    .map((value, index) => {
      const objectId = firstObjectId + index;
      const extruder = value.materialRole === 'raised-text' ? 2 : 1;
      return `    <part id="${objectId}" subtype="normal_part">
      <metadata key="name" value="${escapeXml(value.name)}"/>
      <metadata key="matrix" value="${identity}"/>
      <metadata key="extruder" value="${extruder}"/>
      <mesh_stat face_count="${value.triangles.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${assemblyId}">
    <metadata key="name" value="Filament Label"/>
    <metadata key="extruder" value="1"/>
    <metadata face_count="${totalTriangles}"/>
${parts}
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${assemblyId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
</config>`;
}

function generatorMetadata(
  options: GenerateOptions,
  meshes: LabelMesh[],
  placement: ReturnType<typeof placeAssemblyOnBed>,
) {
  const bodyColor = studioBodyColor(options.filament);
  const textColor = textColorForFilament(options.filament.colors).slice(0, 7);
  const textFilament = resolveTextFilament(
    options.filament,
    options.textFilamentProduct,
  );
  return JSON.stringify(
    {
      schemaVersion: 1,
      generator: { name: 'Filament Label Lab', version: '0.1.0' },
      design: options.design,
      targetPrinter: options.printer,
      slicingRequired: true,
      buildPlatePlacement: placement,
      ...(options.design === 'drybox-tab'
        ? {
            template: {
              sourceFilename: SUPPLIED_DRYBOX.sourceFilename,
              sourceSha256: SUPPLIED_DRYBOX.sourceSha256,
              retainedMechanicalTriangles:
                SUPPLIED_DRYBOX.retainedTriangleCount,
              sourceExtraction: SUPPLIED_DRYBOX.operation,
              mechanicalGeometry:
                'Source card and hook unchanged; moving link sockets enlarged and pins reduced radially by 0.05 mm.',
              hingeClearance: HINGE_CLEARANCE,
            },
            textPrintSettings: TEXT_PRINT_SPEC,
            textRows: meshes.find((part) => part.materialRole === 'raised-text')
              ?.textRows,
          }
        : {
            template: {
              sourceFilename: CLIP_LABEL.sourceFilename,
              sourceSha256: CLIP_LABEL.sourceSha256,
              mechanicalGeometry: CLIP_LABEL.operation,
            },
            textPrintSettings: TEXT_PRINT_SPEC,
            textRows: meshes.find((part) => part.materialRole === 'raised-text')
              ?.textRows,
            textFace: {
              normal: CLIP_LABEL.faceNormal,
              y: CLIP_LABEL.textFaceY,
            },
          }),
      filament: {
        product: options.filament.product,
        material: options.filament.material,
        colorName: options.filament.colorName,
        colorCode: options.filament.colorCode,
        amsId: options.filament.amsId,
        profileColors: options.filament.colors.map((color) => rgb(color)),
      },
      materialRoles: [
        { id: 1, role: 'structure', color: bodyColor },
        {
          id: 2,
          role: 'raised-text',
          color: textColor,
          product: textFilament.product,
          amsId: textFilament.amsId,
        },
      ],
      parts: meshes.map((value) => ({
        name: value.name,
        materialRole: value.materialRole === 'raised-text' ? 2 : 1,
        triangles: value.triangles.length / 3,
      })),
      qualification: {
        digitalGeometry:
          options.design === 'drybox-tab'
            ? `source card and hook preserved; ${HINGE_CLEARANCE.radialReliefMm} mm link bearing relief; generated text validated`
            : 'source clip preserved; pocket capped; generated text validated',
        physicalFitAndCycle: 'pending',
      },
    },
    null,
    2,
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function generate3mf(options: GenerateOptions) {
  const projectSettings = studioProjectSettings(
    options.filament,
    options.printer,
    options.textFilamentProduct,
  );
  const { default: JSZip } = await import('jszip');
  const meshes = await buildConfiguredMeshes(options.filament, options.design);
  const placement = placeAssemblyOnBed(
    meshes,
    studioPresetFor(options.filament, options.printer).printer,
  );
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/><Default Extension="json" ContentType="application/json"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  zip
    .folder('_rels')
    ?.file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/docProps/core.xml" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"/></Relationships>`,
    );
  zip.folder('3D')?.file('3dmodel.model', modelXml(meshes, options, placement));
  zip
    .folder('Metadata')
    ?.file('project_settings.config', JSON.stringify(projectSettings, null, 2));
  zip
    .folder('Metadata')
    ?.file('model_settings.config', modelSettingsXml(meshes));
  zip
    .folder('Metadata')
    ?.file(
      'filament-label-lab.json',
      generatorMetadata(options, meshes, placement),
    );
  zip
    .folder('docProps')
    ?.file(
      'core.xml',
      `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(`${options.filament.product} ${options.filament.colorName} label`)}</dc:title><dc:creator>Filament Label Lab</dc:creator><dc:description>${options.design === 'drybox-tab' ? `User-supplied dry-box STL with unchanged card and hook, ${HINGE_CLEARANCE.radialReliefMm} mm moving-link bearing relief, and separately generated lettering.` : 'User-supplied filament clip STL with a filled label recess and two lines of generated lettering.'} Slicing is required.</dc:description></cp:coreProperties>`,
    );
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return {
    blob,
    filename: `${slug(`${options.filament.product}-${options.filament.colorName}-${options.design}`)}${options.design === 'drybox-tab' ? `-${HINGE_CLEARANCE.filenameSuffix}` : ''}.3mf`,
    parts: meshes.length,
    triangles: meshes.reduce(
      (sum, value) => sum + value.triangles.length / 3,
      0,
    ),
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
