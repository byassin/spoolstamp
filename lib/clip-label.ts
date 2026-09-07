import templateUrl from '../assets/clip-label.mesh?url';
import manifest from '@/data/clip-label.json';
import type { LabelMesh } from '@/lib/generate-3mf';
import type { Filament } from '@/lib/catalog';
import {
  normalizeColor,
  textColorForFilament,
} from '@/lib/filament-appearance';
import { addVectorTextLine } from '@/lib/vector-text';
import { TEXT_PRINT_SPEC } from '@/lib/text-printability';

export const CLIP_LABEL = manifest;
let templatePromise: Promise<LabelMesh> | undefined;

export function decodeClipLabel(buffer: ArrayBuffer): LabelMesh {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 16 ||
    new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== 'FLLCLIP1'
  )
    throw new Error('Invalid clip template');
  const vertexCount = view.getUint32(8, true),
    triangleCount = view.getUint32(12, true);
  if (
    vertexCount !== manifest.vertexCount ||
    triangleCount !== manifest.triangleCount ||
    buffer.byteLength !== 16 + vertexCount * 12 + triangleCount * 12
  )
    throw new Error('Unexpected clip geometry');
  const vertices = Array.from({ length: vertexCount * 3 }, (_, i) =>
    view.getFloat32(16 + i * 4, true),
  );
  const triangles = Array.from({ length: triangleCount * 3 }, (_, i) =>
    view.getUint32(16 + vertexCount * 12 + i * 4, true),
  );
  if (
    vertices.some((v) => !Number.isFinite(v)) ||
    triangles.some((i) => i >= vertexCount)
  )
    throw new Error('Invalid clip coordinate or index');
  return {
    name: 'flat-front-clip',
    color: '#FFFFFFFF',
    materialRole: 'structure',
    vertices,
    triangles,
    preserveSourceCoordinates: true,
  };
}

export function setClipLabelBuffer(buffer: ArrayBuffer | null) {
  templatePromise = buffer
    ? Promise.resolve(decodeClipLabel(buffer))
    : undefined;
}

/** Remove repeated finish descriptions only when the full name will not print. */
function compactClipLine(value: string, product: string) {
  let compact = value.replace(/^Support for /, 'Support ');
  if (/Translucent/.test(product))
    compact = compact.replace(/^Translucent /, '');
  if (product === 'PLA Metal') compact = compact.replace(/ Metallic$/, '');
  if (product === 'PLA Sparkle') compact = compact.replace(/ Sparkle$/, '');
  if (product === 'PLA Dynamic')
    compact = compact.replace(/^UV Color Changing - /, '');
  return compact
    .replace(/ \(Black-Red\)$/, '')
    .replace(/^Blueberry Bubblegum$/, 'Blueb. Bubblegum');
}

export async function buildClipLabelMeshes(
  filament: Filament,
): Promise<LabelMesh[]> {
  if (!templatePromise)
    templatePromise = fetch(templateUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load the clip template');
        return decodeClipLabel(await response.arrayBuffer());
      })
      .catch((error: unknown) => {
        templatePromise = undefined;
        throw error;
      });
  const body = {
    ...(await templatePromise),
    color: normalizeColor(filament.colors[0]),
  };
  const lettering: LabelMesh = {
    name: 'raised-text',
    color: textColorForFilament(filament.colors),
    materialRole: 'raised-text',
    vertices: [],
    triangles: [],
    textRows: [],
  };
  const { minX, maxX } = manifest.textArea;
  const centerX = (minX + maxX) / 2;
  for (const [value, centerY] of [
    [filament.product, 10.6],
    [filament.colorName, 4.6],
  ] as const) {
    let printedValue = value;
    const appendLine = (line: string) =>
      addVectorTextLine(
        lettering,
        line,
        centerX,
        centerY,
        -TEXT_PRINT_SPEC.attachmentOverlap,
        maxX - minX,
        5.4,
        TEXT_PRINT_SPEC.relief + TEXT_PRINT_SPEC.attachmentOverlap,
        TEXT_PRINT_SPEC.lineWidth,
        {
          minimumAspectRatio: 0.65,
          contourTolerance: 0.0001,
          consistentFontSize: true,
        },
      );
    const placement = await appendLine(value).catch((error: unknown) => {
      const compact = compactClipLine(value, filament.product);
      if (
        !(error instanceof Error) ||
        !error.message.includes('too small for a 0.4 mm nozzle') ||
        compact === value
      )
        throw error;
      printedValue = compact;
      return appendLine(compact);
    });
    if (!placement) throw new Error('Both clip label lines must contain text.');
    lettering.textRows!.push({
      ...placement,
      value: printedValue,
      sourceValue: value,
      centerX,
      centerY,
    });
  }
  // Rigid +90° X rotation: font +Y becomes source +Z, and relief +Z
  // becomes source -Y. Keep the clip in its original print orientation.
  for (let i = 0; i < lettering.vertices.length; i += 3) {
    const vertical = lettering.vertices[i + 1],
      depth = lettering.vertices[i + 2];
    lettering.vertices[i + 1] = manifest.textFaceY - depth;
    lettering.vertices[i + 2] = vertical;
  }
  return [body, lettering];
}
