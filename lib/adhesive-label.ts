import type { LabelMesh } from '@/lib/generate-3mf';
import type { Filament } from '@/lib/catalog';
import {
  normalizeColor,
  textColorForFilament,
} from '@/lib/filament-appearance';
import { addVectorTextLine } from '@/lib/vector-text';
import { TEXT_PRINT_SPEC } from '@/lib/text-printability';
import type { LabelLayout } from './label-layout';

/** Original flat design; attachment/adhesive is supplied by the user. */
export const ADHESIVE_LABEL = {
  width: 60,
  height: 25,
  bodyThickness: 1.6,
  textRelief: TEXT_PRINT_SPEC.relief,
  textMargin: 2,
  physicalQualification: 'pending',
} as const;

export const ROUNDED_ADHESIVE_LABEL = {
  ...ADHESIVE_LABEL,
  cornerRadius: 2,
  cornerSegments: 8,
} as const;

function roundedBodyMesh(color: string): LabelMesh {
  const {
    width: w,
    height: h,
    bodyThickness: z,
    cornerRadius: r,
    cornerSegments: segments,
  } = ROUNDED_ADHESIVE_LABEL;
  const points: [number, number][] = [];
  for (const [centerX, centerY, start] of [
    [w - r, r, -90],
    [w - r, h - r, 0],
    [r, h - r, 90],
    [r, r, 180],
  ]) {
    for (let step = 0; step <= segments; step++) {
      const angle = ((start + (90 * step) / segments) * Math.PI) / 180;
      points.push([
        centerX + r * Math.cos(angle),
        centerY + r * Math.sin(angle),
      ]);
    }
  }
  const vertices = [w / 2, h / 2, 0, w / 2, h / 2, z];
  for (const [x, y] of points) vertices.push(x, y, 0, x, y, z);
  const triangles: number[] = [];
  for (let at = 0; at < points.length; at++) {
    const bottom = 2 + at * 2,
      top = bottom + 1,
      nextBottom = 2 + ((at + 1) % points.length) * 2,
      nextTop = nextBottom + 1;
    triangles.push(
      0,
      nextBottom,
      bottom,
      1,
      top,
      nextTop,
      bottom,
      nextBottom,
      nextTop,
      bottom,
      nextTop,
      top,
    );
  }
  return {
    name: 'rounded-adhesive-label-body',
    color: normalizeColor(color),
    materialRole: 'structure',
    vertices,
    triangles,
  };
}

function bodyMesh(color: string): LabelMesh {
  const { width: w, height: h, bodyThickness: z } = ADHESIVE_LABEL;
  return {
    name: 'adhesive-label-body',
    color: normalizeColor(color),
    materialRole: 'structure',
    vertices: [
      0,
      0,
      0,
      w,
      0,
      0,
      w,
      h,
      0,
      0,
      h,
      0,
      0,
      0,
      z,
      w,
      0,
      z,
      w,
      h,
      z,
      0,
      h,
      z,
    ],
    triangles: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
      3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ],
  };
}

/** Balance long color names across complete words; preserve their full text. */
function wrapColor(value: string) {
  const words = value.trim().split(/\s+/);
  if (words.length < 2) return [value];
  let split = 1;
  let width = Infinity;
  for (let at = 1; at < words.length; at++) {
    const candidate = Math.max(
      words.slice(0, at).join(' ').length,
      words.slice(at).join(' ').length,
    );
    if (candidate < width) {
      width = candidate;
      split = at;
    }
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
}

export async function buildAdhesiveLabelMeshes(
  filament: Filament,
  options: { rounded?: boolean; labelLayout?: LabelLayout } = {},
): Promise<LabelMesh[]> {
  const body = options.rounded
    ? roundedBodyMesh(filament.colors[0])
    : bodyMesh(filament.colors[0]);
  const simple = options.labelLayout === 'simple';
  const text: LabelMesh = {
    name: 'raised-text',
    color: textColorForFilament(filament.colors),
    materialRole: 'raised-text',
    vertices: [],
    triangles: [],
    textRows: [],
  };
  async function addRow(
    value: string,
    centerY: number,
    height: number,
    sourceValue = value,
  ) {
    // Stage each row so a failed fit never leaves partial lettering behind.
    const row = { vertices: [] as number[], triangles: [] as number[] };
    const placement = await addVectorTextLine(
      row,
      value,
      30,
      centerY,
      ADHESIVE_LABEL.bodyThickness - TEXT_PRINT_SPEC.attachmentOverlap,
      ADHESIVE_LABEL.width - ADHESIVE_LABEL.textMargin * 2,
      height,
      TEXT_PRINT_SPEC.relief + TEXT_PRINT_SPEC.attachmentOverlap,
      TEXT_PRINT_SPEC.lineWidth,
      {
        minimumAspectRatio: 0.65,
        contourTolerance: 0.0001,
        consistentFontSize: true,
      },
    );
    if (!placement)
      throw new Error('The flat label must contain readable text.');
    const offset = text.vertices.length / 3;
    for (const coordinate of row.vertices) text.vertices.push(coordinate);
    for (const index of row.triangles) text.triangles.push(index + offset);
    text.textRows!.push({
      ...placement,
      value,
      sourceValue,
      centerX: 30,
      centerY,
    });
  }
  await addRow(filament.product, simple ? 18.6 : 19.8, simple ? 7.8 : 6);
  try {
    await addRow(filament.colorName, simple ? 8.7 : 10.8, simple ? 10.4 : 7.4);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('too small for a 0.4 mm nozzle')
    )
      throw error;
    const lines = wrapColor(filament.colorName);
    if (lines.length !== 2) throw error;
    await addRow(lines[0], simple ? 10.9 : 11.8, 5.6, filament.colorName);
    await addRow(lines[1], simple ? 4.9 : 5.2, 5.6, filament.colorName);
    return [body, text];
  }
  if (!simple) await addRow(`SKU: ${filament.colorCode}`, 3.4, 3.8);
  return [body, text];
}
