import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeSuppliedDryBox,
  buildSuppliedDryBoxMeshes,
} from '../lib/supplied-drybox';
import { HINGE_CLEARANCE, relieveHingeBearings } from '../lib/hinge-clearance';
import { assemblyBounds } from '../lib/build-plate';
import { loadManifoldRuntime } from '../lib/manifold-cad';

const raw = () => {
  const b = readFileSync(
    new URL('../assets/supplied-drybox.mesh', import.meta.url),
  );
  return decodeSuppliedDryBox(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
};

describe('minimal hinge bearing relief', () => {
  it('changes only the two moving links, never the source asset or overall dimensions', async () => {
    const source = raw();
    const before = source.map((p) => [...p.vertices]);
    const revised = source.map(relieveHingeBearings);
    expect(revised[0]).toBe(source[0]);
    expect(revised[1]).toBe(source[1]);
    expect(assemblyBounds(revised)).toEqual(assemblyBounds(source));
    for (let i = 0; i < source.length; i++) {
      expect(source[i].vertices).toEqual(before[i]);
      expect(revised[i].triangles).toBe(source[i].triangles);
    }
    // The preview/export builder uses the revision, not the untouched template.
    const built = await buildSuppliedDryBoxMeshes('#009BD8FF');
    expect(built.map((p) => p.vertices)).toEqual(
      revised.map((p) => p.vertices),
    );
  });

  it('adds 0.075 mm radial room (0.025 mm more than R1) and leaves non-bearing vertices alone', () => {
    expect(HINGE_CLEARANCE.radialReliefMm).toBe(0.075);
    expect(HINGE_CLEARANCE.radialReliefMm - 0.05).toBeCloseTo(0.025);
    const source = raw();
    for (let partIndex = 2; partIndex < 4; partIndex++) {
      const part = source[partIndex],
        revised = relieveHingeBearings(part);
      const ends =
        partIndex === 2
          ? [
              [12.15, 1.4],
              [23.85, 1.3],
            ]
          : [
              [36.15, 1.3],
              [47.85, 1.4],
            ];
      let moved = 0;
      for (let i = 0; i < part.vertices.length; i += 3) {
        const a = part.vertices.slice(i, i + 3),
          b = revised.vertices.slice(i, i + 3);
        const bearing = ends
          .flatMap(([x, r]) => [62.4, 66].map((y) => ({ c: [x, y, 1.6], r })))
          .find(
            ({ c, r }) =>
              Math.abs(Math.hypot(...a.map((v, k) => v - c[k])) - r) < 0.00005,
          );
        if (!bearing) {
          expect(b).toEqual(a);
          continue;
        }
        moved++;
        const { c, r } = bearing;
        const change =
          Math.hypot(...b.map((v, k) => v - c[k])) -
          Math.hypot(...a.map((v, k) => v - c[k]));
        expect(Math.abs(change - (r === 1.4 ? 0.075 : -0.075))).toBeLessThan(
          0.00001,
        );
        expect(Math.hypot(...b.map((v, k) => v - a[k]))).toBeLessThan(0.07501);
      }
      expect(moved).toBe(16134);
      expect(assemblyBounds([revised]).min[2]).toBe(0); // no floating link
    }
  });

  it('removes material rather than adding collisions and retains one solid per link', async () => {
    const runtime = await loadManifoldRuntime();
    for (const part of raw().slice(2)) {
      const revised = relieveHingeBearings(part);
      const asSolid = (p: typeof part) =>
        new runtime.Manifold(
          new runtime.Mesh({
            numProp: 3,
            vertProperties: new Float32Array(p.vertices),
            triVerts: new Uint32Array(p.triangles),
          }),
        );
      const original = asSolid(part),
        relieved = asSolid(revised);
      const added = relieved.subtract(original);
      const pieces = relieved.decompose();
      try {
        expect(relieved.status()).toBe('NoError');
        expect(pieces).toHaveLength(1);
        expect(relieved.volume()).toBeLessThan(original.volume());
        expect(relieved.volume()).toBeGreaterThan(original.volume() * 0.95);
        expect(added.volume()).toBeLessThan(0.0001);
      } finally {
        pieces.forEach((p) => p.delete());
        added.delete();
        relieved.delete();
        original.delete();
      }
    }
  });

  it('rejects a changed source bearing instead of silently applying a partial adjustment', () => {
    const link = raw()[2];
    expect(() =>
      relieveHingeBearings({
        ...link,
        vertices: link.vertices.map((v) => v * 2),
      }),
    ).toThrow('Unexpected source hinge');
  });
});
