import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { effectiveLabelLayout, isLabelLayout } from '../lib/label-layout';
import { buildConfiguredMeshes, generate3mf } from '../lib/generate-3mf';
import {
  DEFAULT_FILAMENT,
  DESIGNS,
  FILAMENTS_BY_PRODUCT,
  FILAMENT_TYPES,
  PRINTERS,
} from '../lib/catalog';
import { ROUNDED_ADHESIVE_LABEL } from '../lib/adhesive-label';
import { assemblyBounds, placeAssemblyOnBed } from '../lib/build-plate';
import { studioPresetFor } from '../lib/studio-project';
import { loadManifoldRuntime } from '../lib/manifold-cad';
import { auditMeshOnSerializedGrid } from './helpers/mesh-audit';

describe('label layout presets and original rounded backing', () => {
  it('keeps legacy drafts detailed except for the fixed two-line supplied clip', () => {
    for (const design of DESIGNS)
      expect(effectiveLabelLayout(design.id)).toBe(
        design.id === 'clip-label' ? 'simple' : 'detailed',
      );
    expect(effectiveLabelLayout('clip-label', 'detailed')).toBe('simple');
    expect(isLabelLayout('simple')).toBe(true);
    expect(isLabelLayout('detailed')).toBe(true);
    expect(isLabelLayout('other')).toBe(false);
    expect(() =>
      effectiveLabelLayout('adhesive-label', 'other' as 'simple'),
    ).toThrow('Unknown label layout');
  });
  it('uses layout-aware caching, preserves mechanics, and enlarges simple headlines', async () => {
    for (const design of [
      'drybox-tab',
      'adhesive-label',
      'rounded-adhesive-label',
    ] as const) {
      const simple = await buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        design,
        undefined,
        'simple',
      );
      const detailed = await buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        design,
        undefined,
        'detailed',
      );
      expect(simple).not.toBe(detailed);
      expect(
        simple.filter((part) => part.materialRole === 'structure'),
      ).toEqual(detailed.filter((part) => part.materialRole === 'structure'));
      const simpleText = simple.find(
        (part) => part.materialRole === 'raised-text',
      )!;
      const detailedText = detailed.find(
        (part) => part.materialRole === 'raised-text',
      )!;
      expect(simpleText.textRows).toHaveLength(2);
      expect(simpleText.textRows![0].height).toBeGreaterThan(
        detailedText.textRows![0].height,
      );
      expect(simpleText.textRows![1].height).toBeGreaterThan(
        detailedText.textRows![1].height,
      );
      expect(
        simpleText.textRows!.map((row) => row.value).join(' '),
      ).not.toMatch(/SKU:|HEX:|Print:|Bambu Lab/);
    }
    const simpleClip = await buildConfiguredMeshes(
      DEFAULT_FILAMENT,
      'clip-label',
      undefined,
      'simple',
    );
    expect(
      await buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        'clip-label',
        undefined,
        'detailed',
      ),
    ).toBe(simpleClip);
    expect(
      simpleClip.find((part) => part.materialRole === 'raised-text')!.textRows,
    ).toHaveLength(2);
  }, 15_000);
  it.each(['simple', 'detailed'] as const)(
    'builds a closed 60×25×1.6 rounded backing and attaches all %s glyphs',
    async (labelLayout) => {
      const meshes = await buildConfiguredMeshes(
        DEFAULT_FILAMENT,
        'rounded-adhesive-label',
        undefined,
        labelLayout,
      );
      expect(assemblyBounds([meshes[0]])).toEqual({
        min: [0, 0, 0],
        max: [60, 25, 1.6],
      });
      expect(assemblyBounds(meshes).max[2]).toBeCloseTo(2.4, 5);
      for (const mesh of meshes) {
        const audit = auditMeshOnSerializedGrid(mesh);
        expect(audit.boundaryEdges).toEqual([]);
        expect(audit.degenerateTriangles).toEqual([]);
        expect(audit.duplicateTriangles).toEqual([]);
        expect(audit.nonManifoldEdges).toEqual([]);
        expect(audit.sameDirectionEdges).toEqual([]);
        expect(
          audit.componentVolumes6.every((value) => value > BigInt(0)),
        ).toBe(true);
      }
      const runtime = await loadManifoldRuntime();
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
        expect(solids.every((solid) => solid.status() === 'NoError')).toBe(
          true,
        );
        const {
          width: w,
          height: h,
          cornerRadius: r,
          cornerSegments: n,
          bodyThickness: z,
        } = ROUNDED_ADHESIVE_LABEL;
        expect(solids[0].volume()).toBeCloseTo(
          (w * h - 4 * r * r + 2 * n * r * r * Math.sin(Math.PI / (2 * n))) * z,
          3,
        );
        for (const glyph of glyphs) {
          const intersection = glyph.intersect(solids[0]);
          try {
            expect(intersection.volume()).toBeGreaterThan(0);
          } finally {
            intersection.delete();
          }
        }
      } finally {
        glyphs.forEach((value) => value.delete());
        solids.forEach((value) => value.delete());
      }
    },
    15_000,
  );
  it('places all design/layout combinations on every supported common-nozzle bed without scaling', async () => {
    for (const design of DESIGNS)
      for (const layout of ['simple', 'detailed'] as const) {
        const meshes = await buildConfiguredMeshes(
          DEFAULT_FILAMENT,
          design.id,
          undefined,
          layout,
        );
        for (const printer of PRINTERS) {
          const placement = placeAssemblyOnBed(
            meshes,
            studioPresetFor(DEFAULT_FILAMENT, printer.fullName).printer,
          );
          expect(placement.bounds.min[2]).toBe(0);
          expect(placement.bounds.max[0] - placement.bounds.min[0]).toBeCloseTo(
            assemblyBounds(meshes).max[0] - assemblyBounds(meshes).min[0],
            8,
          );
        }
      }
  }, 15_000);
  it.each(['simple', 'detailed'] as const)(
    'records actual %s layout and original rounded provenance in the project',
    async (labelLayout) => {
      const result = await generate3mf({
        filament: DEFAULT_FILAMENT,
        design: 'rounded-adhesive-label',
        printer: 'Bambu Lab X2D',
        labelLayout,
      });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(result.filename.endsWith('-simple.3mf')).toBe(
        labelLayout === 'simple',
      );
      const metadata = JSON.parse(
        await zip.file('Metadata/filament-label-lab.json')!.async('string'),
      );
      expect(metadata.labelLayout).toBe(labelLayout);
      expect(metadata.template.origin).toBe('Spoolstamp original');
      expect(metadata.template.dimensions).toMatchObject({
        width: 60,
        height: 25,
        bodyThickness: 1.6,
        cornerRadius: 2,
      });
      expect(metadata.template.sourceSha256).toBeUndefined();
      expect(metadata.qualification.physicalFitAndCycle).toBe('pending');
      expect(await zip.file('3D/3dmodel.model')!.async('string')).toContain(
        `<metadata name="fll:label_layout">${labelLayout}</metadata>`,
      );
    },
  );
});

describe('catalog-wide simple-layout readability', () => {
  it.each(FILAMENT_TYPES)(
    'preserves every $product product/color in both simple text geometries',
    async ({ product }) => {
      for (const filament of FILAMENTS_BY_PRODUCT.get(product) ?? [])
        for (const design of [
          'drybox-tab',
          'rounded-adhesive-label',
        ] as const) {
          const meshes = await buildConfiguredMeshes(
            filament,
            design,
            undefined,
            'simple',
          );
          const rows = meshes.find(
            (part) => part.materialRole === 'raised-text',
          )!.textRows!;
          expect(
            rows
              .filter((row) => row.sourceValue === filament.product)
              .map((row) => row.value)
              .join(' '),
          ).toBe(filament.product);
          expect(
            rows
              .filter((row) => row.sourceValue === filament.colorName)
              .map((row) => row.value)
              .join(' '),
          ).toBe(filament.colorName);
          for (const row of rows) {
            expect(
              row.strokeAudit?.passes,
              `${filament.product}: ${row.value}`,
            ).toBe(true);
            expect(row.width).toBeLessThanOrEqual(
              design === 'drybox-tab' ? 54.0001 : 56.0001,
            );
            expect(row.centerY - row.height / 2).toBeGreaterThanOrEqual(
              design === 'drybox-tab' ? 2.9999 : 1.9999,
            );
            expect(row.centerY + row.height / 2).toBeLessThanOrEqual(
              design === 'drybox-tab' ? 58.0001 : 23.0001,
            );
          }
        }
    },
    60_000,
  );
});
