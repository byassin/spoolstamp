import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { CLIP_LABEL, decodeClipLabel } from '../lib/clip-label';
import { DEFAULT_FILAMENT, FILAMENTS } from '../lib/catalog';
import {
  buildConfiguredMeshes,
  generate3mf,
  type LabelMesh,
} from '../lib/generate-3mf';
import { loadManifoldRuntime } from '../lib/manifold-cad';
import { auditMeshOnSerializedGrid } from './helpers/mesh-audit';
import { TEXT_PRINT_SPEC } from '../lib/text-printability';
import { geometryFromLabelMesh } from '../lib/preview-geometry';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function assertClosed(mesh: LabelMesh) {
  const audit = auditMeshOnSerializedGrid(mesh);
  expect(audit.boundaryEdges).toEqual([]);
  expect(audit.degenerateTriangles).toEqual([]);
  expect(audit.duplicateTriangles).toEqual([]);
  expect(audit.nonManifoldEdges).toEqual([]);
  expect(audit.sameDirectionEdges).toEqual([]);
  expect(audit.componentVolumes6.every((volume) => volume > BigInt(0))).toBe(
    true,
  );
}

describe('flat-front filament clip', () => {
  it('keeps long names printable on exactly two lines, preserving full names in metadata', async () => {
    const longNames = FILAMENTS.filter(
      (filament) =>
        filament.product.startsWith('Support for ') ||
        [
          'Blueberry Bubblegum',
          'Translucent Light Blue',
          'UV Color Changing - White to Coral',
          'Copper Brown Metallic',
          'Oxide Green Metallic',
          'Velvet Eclipse (Black-Red)',
          'Onyx Black Sparkle',
        ].includes(filament.colorName),
    );
    for (const filament of longNames) {
      const [, text] = await buildConfiguredMeshes(filament, 'clip-label');
      expect(text.textRows).toHaveLength(2);
      expect(text.textRows?.map((row) => row.sourceValue)).toEqual([
        filament.product,
        filament.colorName,
      ]);
      expect(text.textRows?.every((row) => row.strokeAudit?.passes)).toBe(true);
      assertClosed(text);
    }
  }, 30_000); // Multiple font/solid audits also run on shared CI CPUs.
  it('preserves all non-pocket, nondegenerate source triangles byte-for-byte', async () => {
    const bytes = readFileSync(
      new URL('../assets/clip-label.mesh', import.meta.url),
    );
    expect(hash(bytes)).toBe(CLIP_LABEL.assetSha256);
    const [body] = await buildConfiguredMeshes(DEFAULT_FILAMENT, 'clip-label');
    expect(body.triangles.length / 3).toBe(4206);
    const sourceBytes = Buffer.alloc(CLIP_LABEL.retainedTriangleCount * 36);
    for (let i = 0; i < CLIP_LABEL.retainedTriangleCount * 3; i++)
      for (let axis = 0; axis < 3; axis++)
        sourceBytes.writeFloatLE(
          body.vertices[body.triangles[i] * 3 + axis],
          i * 12 + axis * 4,
        );
    expect(hash(sourceBytes)).toBe(
      CLIP_LABEL.retainedTriangleCoordinatesSha256,
    );
    expect(
      CLIP_LABEL.retainedTriangleCount +
        CLIP_LABEL.removedPocketTriangleCount +
        CLIP_LABEL.removedDegenerateFaces.length,
    ).toBe(CLIP_LABEL.sourceTriangleCount);
    expect(() => decodeClipLabel(new ArrayBuffer(15))).toThrow(
      'Invalid clip template',
    );
    const bad = Uint8Array.from(bytes).buffer;
    new DataView(bad).setUint32(8, 999999, true);
    expect(() => decodeClipLabel(bad)).toThrow('Unexpected clip geometry');
  });

  it('caps the 1.2 mm recess with an outward, flush, closed face and retains the clip opening', async () => {
    const [body] = await buildConfiguredMeshes(DEFAULT_FILAMENT, 'clip-label');
    assertClosed(body);
    const preview = geometryFromLabelMesh(body, 'y');
    try {
      const normals = preview.getAttribute('normal');
      for (let i = normals.count - 6; i < normals.count; i++)
        expect(normals.getY(i)).toBeLessThan(-0.999);
    } finally {
      preview.dispose();
    }
    const capIndices = body.triangles.slice(
      CLIP_LABEL.retainedTriangleCount * 3,
    );
    const ys = capIndices.map((index) => body.vertices[index * 3 + 1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(
      CLIP_LABEL.faceFlatnessTolerance,
    );
    for (let i = 0; i < capIndices.length; i += 3) {
      const [a, b, c] = capIndices
        .slice(i, i + 3)
        .map((index) => body.vertices.slice(index * 3, index * 3 + 3));
      const normalY =
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(normalY).toBeLessThan(0);
    }
    const runtime = await loadManifoldRuntime();
    const solid = new runtime.Manifold(
      new runtime.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(body.vertices),
        triVerts: Uint32Array.from(body.triangles),
      }),
    );
    try {
      expect(solid.status()).toBe('NoError');
      expect(solid.genus()).toBe(1);
      expect(solid.volume()).toBeCloseTo(2939.270133, 4);
    } finally {
      solid.delete();
    }
  });

  it('exports exactly two printable, attached lines facing outward in the source print orientation', async () => {
    const parts = await buildConfiguredMeshes(DEFAULT_FILAMENT, 'clip-label');
    const text = parts[1];
    expect(text.textRows?.map((row) => row.value)).toEqual([
      DEFAULT_FILAMENT.product,
      DEFAULT_FILAMENT.colorName,
    ]);
    expect(text.textRows?.every((row) => row.strokeAudit?.passes)).toBe(true);
    const result = await generate3mf({
      filament: DEFAULT_FILAMENT,
      design: 'clip-label',
      printer: 'Bambu Lab P1S',
    });
    const buffer = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    const metadata = JSON.parse(
      await zip.file('Metadata/filament-label-lab.json')!.async('string'),
    );
    expect(metadata.template.sourceSha256).toBe(CLIP_LABEL.sourceSha256);
    expect(metadata.textRows).toHaveLength(2);
    expect(metadata.textFace.normal).toEqual([0, -1, 0]);
    const serialized = parts.map((part, index) => {
      const object = xml.match(
        new RegExp(`<object id="${index + 2}"[^>]*>([\\s\\S]*?)</object>`),
      )![1];
      return {
        ...part,
        vertices: [
          ...object.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
        ].flatMap((match) => match.slice(1).map(Number)),
        triangles: [
          ...object.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
        ].flatMap((match) => match.slice(1).map(Number)),
      };
    });
    serialized.forEach(assertClosed);
    const xs = serialized[1].vertices.filter((_, i) => i % 3 === 0);
    const ys = serialized[1].vertices.filter((_, i) => i % 3 === 1);
    const zs = serialized[1].vertices.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(
      CLIP_LABEL.textArea.minX - 0.0001,
    );
    expect(Math.max(...xs)).toBeLessThanOrEqual(
      CLIP_LABEL.textArea.maxX + 0.0001,
    );
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(CLIP_LABEL.textArea.minZ);
    expect(Math.max(...zs)).toBeLessThanOrEqual(CLIP_LABEL.textArea.maxZ);
    expect(Math.min(...ys)).toBeCloseTo(
      CLIP_LABEL.textFaceY - TEXT_PRINT_SPEC.relief,
      5,
    );
    expect(Math.max(...ys)).toBeCloseTo(
      CLIP_LABEL.textFaceY + TEXT_PRINT_SPEC.attachmentOverlap,
      5,
    );
    const runtime = await loadManifoldRuntime();
    const solids = serialized.map(
      (part) =>
        new runtime.Manifold(
          new runtime.Mesh({
            numProp: 3,
            vertProperties: Float32Array.from(part.vertices),
            triVerts: Uint32Array.from(part.triangles),
          }),
        ),
    );
    try {
      for (const glyph of solids[1].decompose()) {
        const contact = glyph.intersect(solids[0]);
        try {
          expect(contact.volume() / glyph.volume()).toBeGreaterThan(0.022);
          expect(contact.volume() / glyph.volume()).toBeLessThan(0.026);
        } finally {
          contact.delete();
          glyph.delete();
        }
      }
    } finally {
      solids.forEach((solid) => solid.delete());
    }
    await mkdir('.tmp', { recursive: true });
    await writeFile('.tmp/clip-label-smoke.3mf', buffer);
    await writeFile('.tmp/clip-label-render.json', JSON.stringify(serialized));
  });
});
