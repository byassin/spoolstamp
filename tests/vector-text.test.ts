import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { PathCommand } from '@shuding/opentype.js';
import {
  addVectorTextLine,
  appendOpenTypePathGeometry,
  openTypePathCommandsToShapes,
  setVectorTextFontBuffer,
} from '@/lib/vector-text';

const ringCommands: PathCommand[] = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0, y: 10 },
  { type: 'L', x: 20, y: 10 },
  { type: 'L', x: 20, y: 0 },
  { type: 'Z' },
  { type: 'M', x: 6, y: 3 },
  { type: 'L', x: 14, y: 3 },
  { type: 'L', x: 14, y: 7 },
  { type: 'L', x: 6, y: 7 },
  { type: 'Z' },
];

function coordinateBounds(vertices: number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    xs.push(vertices[index]);
    ys.push(vertices[index + 1]);
    zs.push(vertices[index + 2]);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function triangleAreaSquared(
  vertices: number[],
  a: number,
  b: number,
  c: number,
) {
  const ax = vertices[a * 3];
  const ay = vertices[a * 3 + 1];
  const az = vertices[a * 3 + 2];
  const abx = vertices[b * 3] - ax;
  const aby = vertices[b * 3 + 1] - ay;
  const abz = vertices[b * 3 + 2] - az;
  const acx = vertices[c * 3] - ax;
  const acy = vertices[c * 3 + 1] - ay;
  const acz = vertices[c * 3 + 2] - az;
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return crossX * crossX + crossY * crossY + crossZ * crossZ;
}

function expectNoZeroAreaTriangles(target: {
  vertices: number[];
  triangles: number[];
}) {
  for (let index = 0; index < target.triangles.length; index += 3) {
    expect(
      triangleAreaSquared(
        target.vertices,
        target.triangles[index],
        target.triangles[index + 1],
        target.triangles[index + 2],
      ),
    ).toBeGreaterThanOrEqual(1e-12);
  }
}

afterEach(() => setVectorTextFontBuffer(null));

describe('vector text geometry', () => {
  it('converts closed contours and retains counters as holes', () => {
    const shapes = openTypePathCommandsToShapes(ringCommands);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
  });

  it('centers, fits, extrudes, indexes, and welds a vector path', async () => {
    const target = { vertices: [] as number[], triangles: [] as number[] };
    const placement = await appendOpenTypePathGeometry(
      target,
      ringCommands,
      3,
      -2,
      1.2,
      20,
      20,
      0.8,
    );

    expect(placement).not.toBeNull();
    expect(placement?.width).toBeCloseTo(20);
    expect(placement?.height).toBeCloseTo(10);
    expect(placement?.depth).toBe(0.8);
    expect(target.vertices.length).toBeGreaterThan(0);
    expect(target.triangles.length).toBeGreaterThan(0);
    expect(target.triangles.length % 3).toBe(0);

    const bounds = coordinateBounds(target.vertices);
    expect(bounds.minX).toBeCloseTo(-7);
    expect(bounds.maxX).toBeCloseTo(13);
    expect(bounds.minY).toBeCloseTo(-7);
    expect(bounds.maxY).toBeCloseTo(3);
    expect(bounds.minZ).toBeCloseTo(1.2);
    expect(bounds.maxZ).toBeCloseTo(2);

    const vertexCount = target.vertices.length / 3;
    expect(Math.max(...target.triangles)).toBeLessThan(vertexCount);
    expect(vertexCount).toBeLessThan(target.triangles.length);
    expectNoZeroAreaTriangles(target);
  });

  it('parses the OFL Noto Sans WOFF from an injected buffer', async () => {
    const fontPath = fileURLToPath(
      new URL(
        '../node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
        import.meta.url,
      ),
    );
    setVectorTextFontBuffer(readFileSync(fontPath));
    const target = { vertices: [] as number[], triangles: [] as number[] };

    const placement = await addVectorTextLine(
      target,
      'Bambu Lab',
      4,
      -3,
      2.4,
      64,
      8,
      0.8,
    );

    expect(placement).not.toBeNull();
    expect(placement?.width).toBeLessThanOrEqual(64.000_001);
    expect(placement?.height).toBeLessThanOrEqual(8.000_001);
    expect(placement?.verticesAdded).toBeGreaterThan(100);
    expect(placement?.trianglesAdded).toBeGreaterThan(100);

    const bounds = coordinateBounds(target.vertices);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(4);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(-3);
    expect(bounds.minZ).toBeCloseTo(2.4);
    expect(bounds.maxZ).toBeCloseTo(3.2);
    expectNoZeroAreaTriangles(target);
  });
});
