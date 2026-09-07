import notoSansBoldUrl from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url';
import { parse, type Font, type PathCommand } from '@shuding/opentype.js';
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import {
  strengthenTextStrokes,
  auditTextStrokes,
  TEXT_PRINT_SPEC,
  type TextStrokeAudit,
} from '@/lib/text-printability';
import {
  copyManifoldMesh,
  deleteCrossSections,
  deleteManifolds,
  loadManifoldRuntime,
} from '@/lib/manifold-cad';

// Noto Sans Bold is provided by @fontsource/noto-sans under the SIL Open Font
// License 1.1. The browser bundle references that package asset; this module
// does not contain a separately copied or modified font binary.

export type VectorTextMeshTarget = {
  vertices: number[];
  triangles: number[];
};

export type VectorTextPlacement = {
  width: number;
  height: number;
  depth: number;
  scale: number;
  verticesAdded: number;
  trianglesAdded: number;
  strokeAudit?: TextStrokeAudit;
  outlineExpansion?: number;
};

export type VectorTextOptions = {
  /** Use a shared ascender/descender envelope instead of enlarging each word. */
  consistentFontSize?: boolean;
  /** Limit horizontal condensation; 1 retains the original letter proportions. */
  minimumAspectRatio?: number;
  contourTolerance?: number;
};

const FONT_PATH_SIZE = 1_000;
const CURVE_SEGMENTS = 12;

let fontPromise: Promise<Font> | undefined;

function ownedArrayBuffer(source: ArrayBuffer | ArrayBufferView) {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    ).slice().buffer;
  }
  return source.slice(0);
}

/**
 * Seeds (or clears) the parsed-font cache. Supplying a buffer keeps tests and
 * non-browser callers independent of fetch while exercising the real parser.
 */
export function setVectorTextFontBuffer(
  source: ArrayBuffer | ArrayBufferView | null,
) {
  fontPromise = source
    ? Promise.resolve().then(() => parse(ownedArrayBuffer(source)))
    : undefined;
}

async function loadFont() {
  if (!fontPromise) {
    const pending = fetch(notoSansBoldUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load Noto Sans Bold (${response.status} ${response.statusText})`,
          );
        }
        return response.arrayBuffer();
      })
      .then((buffer) => parse(buffer));
    fontPromise = pending.catch((error: unknown) => {
      fontPromise = undefined;
      throw error;
    });
  }
  return fontPromise;
}

function requireFinite(name: string, value: number) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function requirePositive(name: string, value: number) {
  requireFinite(name, value);
  if (value <= 0) throw new Error(`${name} must be greater than zero`);
}

/**
 * Converts OpenType/SVG-style commands to Three.js shapes. OpenType's path
 * coordinates use screen-style downward Y, so Y is inverted here to keep
 * lettering upright when viewed from the positive Z side of a printed part.
 */
export function openTypePathCommandsToShapes(commands: readonly PathCommand[]) {
  const path = new THREE.ShapePath();

  for (const command of commands) {
    switch (command.type) {
      case 'M':
        path.moveTo(command.x, -command.y);
        break;
      case 'L':
        path.lineTo(command.x, -command.y);
        break;
      case 'C':
        path.bezierCurveTo(
          command.x1,
          -command.y1,
          command.x2,
          -command.y2,
          command.x,
          -command.y,
        );
        break;
      case 'Q':
        path.quadraticCurveTo(command.x1, -command.y1, command.x, -command.y);
        break;
      case 'Z':
        if (path.currentPath) path.currentPath.autoClose = true;
        break;
    }
  }

  return path.toShapes();
}

/**
 * Pure geometry step used by addVectorTextLine and by Node-based tests.
 */
export async function appendOpenTypePathGeometry(
  target: VectorTextMeshTarget,
  commands: readonly PathCommand[],
  centerX: number,
  centerY: number,
  baseZ: number,
  maxWidth: number,
  targetHeight: number,
  depth: number,
  minimumLineWidth?: number,
  options: VectorTextOptions & { referenceHeight?: number } = {},
): Promise<VectorTextPlacement | null> {
  requireFinite('centerX', centerX);
  requireFinite('centerY', centerY);
  requireFinite('baseZ', baseZ);
  requirePositive('maxWidth', maxWidth);
  requirePositive('targetHeight', targetHeight);
  requirePositive('depth', depth);

  const shapes = openTypePathCommandsToShapes(commands);
  if (shapes.length === 0) return null;

  const contours = shapes.flatMap((shape) => {
    const points = shape.extractPoints(CURVE_SEGMENTS);
    return [points.shape, ...points.holes].map((contour) =>
      contour.map((point) => [point.x, point.y] as [number, number]),
    );
  });
  const allPoints = contours.flat();
  if (allPoints.length === 0) return null;
  const minX = Math.min(...allPoints.map(([x]) => x));
  const maxX = Math.max(...allPoints.map(([x]) => x));
  const minY = Math.min(...allPoints.map(([, y]) => y));
  const maxY = Math.max(...allPoints.map(([, y]) => y));
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const expansionMargin = minimumLineWidth
    ? 2 * TEXT_PRINT_SPEC.maximumOutlineExpansion
    : 0;
  const widthScale = (maxWidth - expansionMargin) / sourceWidth;
  const heightScale =
    (targetHeight - expansionMargin) /
    Math.max(sourceHeight, options.referenceHeight ?? sourceHeight);
  const scaleY = Math.min(
    heightScale,
    widthScale / (options.minimumAspectRatio ?? 1),
  );
  const scale = Math.min(widthScale, scaleY);
  requirePositive('fitted text scale', scale);
  const sourceCenterX = (minX + maxX) / 2;
  const sourceCenterY = (minY + maxY) / 2;
  const runtime = await loadManifoldRuntime();
  const crossSection = new runtime.CrossSection(contours, 'EvenOdd');
  const sections = [crossSection];
  const solids: Manifold[] = [];
  try {
    const scaled = crossSection.scale([scale, scaleY]);
    sections.push(scaled);
    const positioned = scaled.translate([
      centerX - sourceCenterX * scale,
      centerY - sourceCenterY * scaleY,
    ]);
    sections.push(positioned);
    const strengthened = minimumLineWidth
      ? strengthenTextStrokes(positioned, minimumLineWidth)
      : null;
    if (strengthened) sections.push(strengthened.section);
    const unsimplified = strengthened?.section ?? positioned;
    const finalSection = options.contourTolerance
      ? unsimplified.simplify(options.contourTolerance)
      : unsimplified;
    if (finalSection !== unsimplified) sections.push(finalSection);
    const finalAudit =
      options.contourTolerance && minimumLineWidth
        ? auditTextStrokes(finalSection, minimumLineWidth)
        : strengthened?.audit;
    if (
      finalAudit &&
      (!finalAudit.passes ||
        finalAudit.components !== strengthened?.audit.components ||
        finalAudit.counters !== strengthened?.audit.counters)
    ) {
      throw new Error(
        'This text is too small for a 0.4 mm nozzle. Use fewer characters or more space.',
      );
    }
    const extruded = runtime.Manifold.extrude(finalSection, depth);
    solids.push(extruded);
    const solid = extruded.translate([0, 0, baseZ]);
    solids.push(solid);
    const initialVertexCount = target.vertices.length / 3;
    const initialTriangleCount = target.triangles.length / 3;

    copyManifoldMesh(target, solid);

    return {
      width: sourceWidth * scale + 2 * (strengthened?.expansion ?? 0),
      height: sourceHeight * scaleY + 2 * (strengthened?.expansion ?? 0),
      depth,
      scale,
      verticesAdded: target.vertices.length / 3 - initialVertexCount,
      trianglesAdded: target.triangles.length / 3 - initialTriangleCount,
      ...(strengthened
        ? {
            strokeAudit: finalAudit!,
            outlineExpansion: strengthened.expansion,
          }
        : {}),
    };
  } finally {
    deleteManifolds(...solids.reverse());
    deleteCrossSections(...sections.reverse());
  }
}

export async function addVectorTextLine(
  target: VectorTextMeshTarget,
  value: string,
  centerX: number,
  centerY: number,
  baseZ: number,
  maxWidth: number,
  targetHeight: number,
  depth: number,
  minimumLineWidth?: number,
  options: VectorTextOptions = {},
) {
  if (value.trim().length === 0) return null;
  const font = await loadFont();
  // Extra tracking leaves room for strengthened strokes without joining
  // neighboring letters. The topology audit rejects any remaining collisions.
  const outline = font.getPath(
    value,
    0,
    0,
    FONT_PATH_SIZE,
    minimumLineWidth ? { tracking: 60 } : undefined,
  );
  // Include ascenders and descenders in every color's sizing envelope. Without
  // this, "Cyan" is reduced because of its y while "Black" is enlarged to fill
  // the same row. Actual outlines still cap the scale for taller glyphs.
  const referenceYs = options.consistentFontSize
    ? openTypePathCommandsToShapes(
        font.getPath('Hkgy', 0, 0, FONT_PATH_SIZE).commands,
      ).flatMap((shape) =>
        shape.extractPoints(CURVE_SEGMENTS).shape.map((point) => point.y),
      )
    : undefined;
  try {
    return await appendOpenTypePathGeometry(
      target,
      outline.commands,
      centerX,
      centerY,
      baseZ,
      maxWidth,
      targetHeight,
      depth,
      minimumLineWidth,
      {
        ...options,
        referenceHeight: referenceYs
          ? Math.max(...referenceYs) - Math.min(...referenceYs)
          : undefined,
      },
    );
  } catch (error) {
    throw new Error(
      `${value}: ${error instanceof Error ? error.message : 'Unable to generate printable text'}`,
    );
  }
}
