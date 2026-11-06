import { describe, expect, it } from 'vitest';
import {
  ADHESIVE_LABEL,
  buildAdhesiveLabelMeshes,
} from '../lib/adhesive-label';
import {
  DEFAULT_FILAMENT,
  FILAMENTS,
  FILAMENTS_BY_PRODUCT,
  FILAMENT_TYPES,
} from '../lib/catalog';
import { assemblyBounds } from '../lib/build-plate';
import { auditMeshOnSerializedGrid } from './helpers/mesh-audit';
import { loadManifoldRuntime } from '../lib/manifold-cad';

describe('original flat adhesive label', () => {
  it('has a closed original body at Z0, 60×25 mm with 1.6 mm backing and 0.8 mm text', async () => {
    const meshes = await buildAdhesiveLabelMeshes(DEFAULT_FILAMENT);
    expect(assemblyBounds([meshes[0]])).toEqual({
      min: [0, 0, 0],
      max: [60, 25, 1.6],
    });
    expect(assemblyBounds(meshes).max[2]).toBeCloseTo(2.4, 5);
    expect(ADHESIVE_LABEL.physicalQualification).toBe('pending');
    for (const mesh of meshes) {
      const audit = auditMeshOnSerializedGrid(mesh);
      expect(audit.boundaryEdges).toEqual([]);
      expect(audit.degenerateTriangles).toEqual([]);
      expect(audit.duplicateTriangles).toEqual([]);
      expect(audit.nonManifoldEdges).toEqual([]);
      expect(audit.sameDirectionEdges).toEqual([]);
      expect(
        audit.componentVolumes6.every((volume) => volume > BigInt(0)),
      ).toBe(true);
    }
  });
  it('attaches every printable glyph to the backing instead of floating above it', async () => {
    const runtime = await loadManifoldRuntime();
    const meshes = await buildAdhesiveLabelMeshes(DEFAULT_FILAMENT);
    const solids = meshes.map(
      (mesh) =>
        new runtime.Manifold(
          new runtime.Mesh({
            numProp: 3,
            vertProperties: Float32Array.from(mesh.vertices),
            triVerts: Uint32Array.from(mesh.triangles),
          }),
        ),
    );
    const glyphs = solids[1].decompose();
    try {
      expect(solids.every((solid) => solid.status() === 'NoError')).toBe(true);
      expect(solids[0].volume()).toBeCloseTo(60 * 25 * 1.6, 3);
      for (const glyph of glyphs) {
        const intersection = glyph.intersect(solids[0]);
        try {
          expect(intersection.volume()).toBeGreaterThan(0);
        } finally {
          intersection.delete();
        }
      }
      expect(meshes[1].textRows?.every((row) => row.strokeAudit?.passes)).toBe(
        true,
      );
    } finally {
      glyphs.forEach((glyph) => glyph.delete());
      solids.forEach((solid) => solid.delete());
    }
  }, 15_000);
  it.each(FILAMENT_TYPES)(
    'fits every $product color without losing the full product/color names',
    async ({ product }) => {
      for (const filament of FILAMENTS_BY_PRODUCT.get(product) ?? []) {
        const [, text] = await buildAdhesiveLabelMeshes(filament);
        expect(text.textRows!.length).toBe(3);
        expect(text.textRows![0].sourceValue).toBe(filament.product);
        expect(
          text
            .textRows!.slice(1)
            .some((row) => row.sourceValue === filament.colorName),
        ).toBe(true);
        for (const row of text.textRows!) {
          expect(row.strokeAudit?.passes, `${product}: ${row.value}`).toBe(
            true,
          );
          expect(row.width).toBeLessThanOrEqual(56.0001);
          expect(row.centerY - row.height / 2).toBeGreaterThanOrEqual(1.4);
          expect(row.centerY + row.height / 2).toBeLessThanOrEqual(23.0001);
        }
      }
    },
    30_000,
  );
  it('wraps long names only when needed and never abbreviates the printed source text', async () => {
    const filament = FILAMENTS.find(
      (item) => item.colorName === 'UV Color Changing - White to Coral',
    )!;
    const [, text] = await buildAdhesiveLabelMeshes(filament);
    expect(
      text
        .textRows!.filter((row) => row.sourceValue === filament.colorName)
        .map((row) => row.value)
        .join(' '),
    ).toBe(filament.colorName);
  });
});
