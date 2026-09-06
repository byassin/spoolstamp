import type { LabelMesh } from '../../lib/generate-3mf';

type Point = readonly [bigint, bigint, bigint];

export type MeshAudit = {
  boundaryEdges: string[];
  degenerateTriangles: number[];
  duplicateTriangles: number[];
  nonManifoldEdges: string[];
  sameDirectionEdges: string[];
  componentVolumes6: bigint[];
};

const GRID_SCALE = 100_000;

function quantize(value: number) {
  return BigInt(Math.round(value * GRID_SCALE));
}

function cross(a: Point, b: Point): Point {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Point, b: Point) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// A common exact integer scale (2^149) for all finite Float32 source values.
// This audits source geometry without silently applying the text export grid.
function exactFloat32(value: number) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  const bits = view.getUint32(0);
  const exponent = (bits >>> 23) & 255;
  const fraction = bits & 0x7fffff;
  const magnitude =
    exponent === 0
      ? BigInt(fraction)
      : BigInt(fraction | 0x800000) << BigInt(exponent - 1);
  return bits >>> 31 ? -magnitude : magnitude;
}

export function auditMeshAtFloat32Precision(mesh: LabelMesh): MeshAudit {
  return auditMeshOnSerializedGrid(mesh, exactFloat32);
}

export function auditMeshOnSerializedGrid(
  mesh: LabelMesh,
  coordinate = quantize,
): MeshAudit {
  const canonicalPoints: Point[] = [];
  const canonicalByPosition = new Map<string, number>();
  const remap: number[] = [];
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const point = [
      coordinate(mesh.vertices[index]),
      coordinate(mesh.vertices[index + 1]),
      coordinate(mesh.vertices[index + 2]),
    ] as const;
    const key = point.join(',');
    let canonical = canonicalByPosition.get(key);
    if (canonical === undefined) {
      canonical = canonicalPoints.length;
      canonicalByPosition.set(key, canonical);
      canonicalPoints.push(point);
    }
    remap[index / 3] = canonical;
  }

  const triangles: Array<readonly [number, number, number]> = [];
  const degenerateTriangles: number[] = [];
  const duplicateTriangles: number[] = [];
  const seenTriangles = new Map<string, number>();
  const edgeUses = new Map<
    string,
    Array<{ triangle: number; direction: number }>
  >();

  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const triangleIndex = index / 3;
    const triangle = [
      remap[mesh.triangles[index]],
      remap[mesh.triangles[index + 1]],
      remap[mesh.triangles[index + 2]],
    ] as const;
    triangles.push(triangle);
    const [a, b, c] = triangle;
    const area = cross(
      subtract(canonicalPoints[b], canonicalPoints[a]),
      subtract(canonicalPoints[c], canonicalPoints[a]),
    );
    if (
      a === b ||
      b === c ||
      c === a ||
      area.every((value) => value === BigInt(0))
    ) {
      degenerateTriangles.push(triangleIndex);
    }
    const triangleKey = [...triangle]
      .sort((left, right) => left - right)
      .join(',');
    if (seenTriangles.has(triangleKey)) duplicateTriangles.push(triangleIndex);
    else seenTriangles.set(triangleKey, triangleIndex);

    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const key = `${low},${high}`;
      const uses = edgeUses.get(key) ?? [];
      uses.push({ triangle: triangleIndex, direction: from === low ? 1 : -1 });
      edgeUses.set(key, uses);
    }
  }

  const boundaryEdges: string[] = [];
  const nonManifoldEdges: string[] = [];
  const sameDirectionEdges: string[] = [];
  const adjacency = Array.from(
    { length: triangles.length },
    () => new Set<number>(),
  );
  for (const [key, uses] of edgeUses) {
    if (uses.length === 1) boundaryEdges.push(key);
    else if (uses.length !== 2) nonManifoldEdges.push(key);
    else {
      adjacency[uses[0].triangle].add(uses[1].triangle);
      adjacency[uses[1].triangle].add(uses[0].triangle);
      if (uses[0].direction === uses[1].direction) sameDirectionEdges.push(key);
    }
  }

  const visited = new Set<number>();
  const componentVolumes6: bigint[] = [];
  for (let start = 0; start < triangles.length; start += 1) {
    if (visited.has(start)) continue;
    const pending = [start];
    let volume6 = BigInt(0);
    while (pending.length > 0) {
      const triangleIndex = pending.pop()!;
      if (visited.has(triangleIndex)) continue;
      visited.add(triangleIndex);
      const [a, b, c] = triangles[triangleIndex];
      volume6 += dot(
        canonicalPoints[a],
        cross(canonicalPoints[b], canonicalPoints[c]),
      );
      for (const neighbor of adjacency[triangleIndex]) {
        if (!visited.has(neighbor)) pending.push(neighbor);
      }
    }
    componentVolumes6.push(volume6);
  }

  return {
    boundaryEdges,
    degenerateTriangles,
    duplicateTriangles,
    nonManifoldEdges,
    sameDirectionEdges,
    componentVolumes6,
  };
}
