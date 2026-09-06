import type { LabelMesh } from '@/lib/generate-3mf';

type Point3 = [number, number, number];
type Rectangle = { minX: number; minY: number; maxX: number; maxY: number };
export type PrintBed = {
  printableArea: string[];
  printableHeight: string;
  bedExcludeArea: string[];
  extruderPrintableAreas: string[];
  wrappingExcludeArea: string[];
};

// An additional layout margin, not a replacement for Studio's collision checks.
export const BED_PLACEMENT_MARGIN = 10;

function polygonBounds(values: string[]): Rectangle {
  const points = values.map((value) => {
    const coordinates = value.trim().split('x').map(Number);
    if (coordinates.length !== 2 || !coordinates.every(Number.isFinite))
      throw new Error('Invalid printer bed coordinates.');
    return coordinates;
  });
  if (points.length < 3) throw new Error('Invalid printer bed polygon.');
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function rectangularBed(values: string[]) {
  const bounds = polygonBounds(values);
  const corners = new Set(
    values.map((value) => value.trim().split('x').map(Number).join('x')),
  );
  // All supported Bambu beds are rectangular. Refuse new shapes rather than
  // assuming their bounding box is printable (unsafe for concave polygons).
  if (
    corners.size !== 4 ||
    ![bounds.minX, bounds.maxX].every((x) =>
      [bounds.minY, bounds.maxY].every((y) => corners.has(`${x}x${y}`)),
    )
  )
    throw new Error(
      'This printer bed shape is not supported for automatic placement.',
    );
  return bounds;
}

/** Shared profile layout for export placement and the slicer-style preview. */
export function printBedLayout(bed: PrintBed) {
  const bounds = rectangularBed(bed.printableArea);
  const common = { ...bounds };
  for (const area of bed.extruderPrintableAreas) {
    const extruder = rectangularBed(area.split(','));
    common.minX = Math.max(common.minX, extruder.minX);
    common.minY = Math.max(common.minY, extruder.minY);
    common.maxX = Math.min(common.maxX, extruder.maxX);
    common.maxY = Math.min(common.maxY, extruder.maxY);
  }
  if (common.minX >= common.maxX || common.minY >= common.maxY)
    throw new Error('This printer has no common nozzle area.');
  const restricted: Array<Rectangle & { kind: 'single-nozzle' | 'excluded' }> =
    [];
  const add = (rect: Rectangle, kind: 'single-nozzle' | 'excluded') => {
    const clipped = {
      minX: Math.max(bounds.minX, rect.minX),
      minY: Math.max(bounds.minY, rect.minY),
      maxX: Math.min(bounds.maxX, rect.maxX),
      maxY: Math.min(bounds.maxY, rect.maxY),
    };
    if (clipped.maxX > clipped.minX && clipped.maxY > clipped.minY)
      restricted.push({ ...clipped, kind });
  };
  add({ ...bounds, maxX: common.minX }, 'single-nozzle');
  add({ ...bounds, minX: common.maxX }, 'single-nozzle');
  add({ ...common, minY: bounds.minY, maxY: common.minY }, 'single-nozzle');
  add({ ...common, minY: common.maxY, maxY: bounds.maxY }, 'single-nozzle');
  for (const polygon of [bed.bedExcludeArea, bed.wrappingExcludeArea])
    if (polygon.length) add(polygonBounds(polygon), 'excluded');
  return { bounds, common, restricted };
}

export function assemblyBounds(meshes: Pick<LabelMesh, 'vertices'>[]) {
  const min: Point3 = [Infinity, Infinity, Infinity];
  const max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    if (mesh.vertices.length % 3 !== 0)
      throw new Error('Invalid model coordinates.');
    for (let index = 0; index < mesh.vertices.length; index++) {
      const value = mesh.vertices[index];
      if (!Number.isFinite(value))
        throw new Error('Invalid model coordinates.');
      const axis = index % 3;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  if (!min.every(Number.isFinite))
    throw new Error('Cannot place an empty model.');
  return { min, max };
}

export function placeAssemblyOnBed(
  meshes: Pick<LabelMesh, 'vertices'>[],
  bed: PrintBed,
) {
  const local = assemblyBounds(meshes);
  const { common: safeBed } = printBedLayout(bed);
  // Keep both materials reachable by either nozzle on dual-extruder machines.
  const translation: Point3 = [
    (safeBed.minX + safeBed.maxX - local.min[0] - local.max[0]) / 2,
    (safeBed.minY + safeBed.maxY - local.min[1] - local.max[1]) / 2,
    -local.min[2],
  ];
  const min = local.min.map(
    (value, axis) => value + translation[axis],
  ) as Point3;
  const max = local.max.map(
    (value, axis) => value + translation[axis],
  ) as Point3;
  const margin = BED_PLACEMENT_MARGIN;
  const height = Number(bed.printableHeight);
  if (
    !Number.isFinite(height) ||
    height <= 0 ||
    max[2] > height ||
    min[0] < safeBed.minX + margin ||
    max[0] > safeBed.maxX - margin ||
    min[1] < safeBed.minY + margin ||
    max[1] > safeBed.maxY - margin
  )
    throw new Error('The label does not fit safely on this printer’s bed.');

  for (const polygon of [bed.bedExcludeArea, bed.wrappingExcludeArea]) {
    if (!polygon.length) continue;
    // Conservative even if a future exclusion polygon is not rectangular.
    const excluded = polygonBounds(polygon);
    if (
      max[0] > excluded.minX - margin &&
      min[0] < excluded.maxX + margin &&
      max[1] > excluded.minY - margin &&
      min[1] < excluded.maxY + margin
    )
      throw new Error(
        'The centered label is too close to a printer exclusion area.',
      );
  }
  // This is an instance transform. Never translate vertices independently:
  // preview cache, hinge clearances, and exact source mesh hashes stay unchanged.
  return { translation, bounds: { min, max }, clearance: margin };
}
