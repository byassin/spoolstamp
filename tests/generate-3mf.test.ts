import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildConfiguredMeshes,
  generate3mf,
  type LabelMesh,
} from '../lib/generate-3mf';
import { DEFAULT_FILAMENT, type DesignId } from '../lib/catalog';
import { SUPPLIED_DRYBOX, decodeSuppliedDryBox } from '../lib/supplied-drybox';
import {
  auditMeshAtFloat32Precision,
  auditMeshOnSerializedGrid,
} from './helpers/mesh-audit';
import { loadManifoldRuntime } from '../lib/manifold-cad';
import { auditTextStrokes, TEXT_PRINT_SPEC } from '../lib/text-printability';
import { assemblyBounds } from '../lib/build-plate';

const filament = {
  ...DEFAULT_FILAMENT,
  colorName: 'Ocean to Meadow',
  colorCode: '10902',
  colors: ['#307FE2FF', '#54FF9BFF'],
};
const digest = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

function triangleCoordinateDigest(
  mesh: Pick<LabelMesh, 'vertices' | 'triangles'>,
) {
  const buffer = Buffer.alloc(mesh.triangles.length * 12);
  mesh.triangles.forEach((vertex, index) => {
    for (let axis = 0; axis < 3; axis++)
      buffer.writeFloatLE(
        mesh.vertices[vertex * 3 + axis],
        index * 12 + axis * 4,
      );
  });
  return digest(buffer);
}

async function readModel(design: DesignId) {
  const result = await generate3mf({
    filament,
    design,
    printer: 'Bambu Lab P1S',
  });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  return {
    result,
    zip,
    model: (await zip.file('3D/3dmodel.model')?.async('string')) ?? '',
  };
}

describe('source STL preservation and 3MF export', () => {
  it('shares in-flight and resolved mesh work between preview and download', async () => {
    const first = buildConfiguredMeshes(filament, 'drybox-tab');
    expect(buildConfiguredMeshes({ ...filament }, 'drybox-tab')).toBe(first);
    const parts = await first;
    expect(await buildConfiguredMeshes(filament, 'drybox-tab')).toBe(parts);
    expect(
      await buildConfiguredMeshes(
        { ...filament, colorName: 'Changed label' },
        'drybox-tab',
      ),
    ).not.toBe(parts);
  });

  it('preserves retained source triangles byte for byte and records the six-face source repair', async () => {
    const bytes = readFileSync(
      new URL('../assets/supplied-drybox.mesh', import.meta.url),
    );
    expect(digest(bytes)).toBe(SUPPLIED_DRYBOX.assetSha256);
    expect(
      SUPPLIED_DRYBOX.retainedTriangleCount +
        SUPPLIED_DRYBOX.removedLetteringTriangleCount +
        SUPPLIED_DRYBOX.removedZeroThicknessTriangleCount,
    ).toBe(SUPPLIED_DRYBOX.sourceTriangleCount);
    const meshes = decodeSuppliedDryBox(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(meshes).toHaveLength(4);
    expect(
      meshes.reduce((count, part) => count + part.triangles.length / 3, 0),
    ).toBe(226476);
    expect(SUPPLIED_DRYBOX.removedOpposingFacePairs).toEqual([
      [81195, 88420],
      [117689, 124097],
      [117691, 124699],
    ]);
    expect(SUPPLIED_DRYBOX.removedZeroThicknessTriangleCount).toBe(6);
    for (let index = 0; index < meshes.length; index++) {
      const part = meshes[index];
      const source = SUPPLIED_DRYBOX.parts[index];
      expect(part.name).toBe(source.name);
      expect(part.preserveSourceCoordinates).toBe(true);
      expect(triangleCoordinateDigest(part)).toBe(
        source.triangleCoordinatesSha256,
      );
    }
    expect(() => decodeSuppliedDryBox(new ArrayBuffer(12))).toThrow(
      'Invalid dry-box template',
    );
  });

  it('preserves configured coordinates through XML without rounding and keeps all parts manifold', async () => {
    const { model, result } = await readModel('drybox-tab');
    const configured = await buildConfiguredMeshes(filament, 'drybox-tab');
    for (let index = 0; index < SUPPLIED_DRYBOX.parts.length; index++) {
      const source = SUPPLIED_DRYBOX.parts[index];
      const object =
        model.match(
          new RegExp(`<object id="${index + 2}"[^>]*>([\\s\\S]*?)</object>`),
        )?.[1] ?? '';
      const vertices = [
        ...object.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
      ].flatMap((match) => match.slice(1).map(Number));
      const triangles = [
        ...object.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
      ].flatMap((match) => match.slice(1).map(Number));
      expect(
        triangleCoordinateDigest({ vertices, triangles }),
        source.name,
      ).toBe(triangleCoordinateDigest(configured[index]));
      const audit = auditMeshAtFloat32Precision({
        name: source.name,
        color: '#000000FF',
        materialRole: 'structure',
        vertices,
        triangles,
      });
      expect(audit.boundaryEdges, source.name).toEqual([]);
      expect(audit.nonManifoldEdges, source.name).toEqual([]);
      expect(audit.duplicateTriangles, source.name).toEqual([]);
      expect(audit.degenerateTriangles, source.name).toEqual([]);
      expect(audit.sameDirectionEdges, source.name).toEqual([]);
      expect(
        audit.componentVolumes6.every((volume) => volume > BigInt(0)),
      ).toBe(true);
    }
    await mkdir(path.resolve('.tmp'), { recursive: true });
    await writeFile(
      path.resolve('.tmp/supplied-drybox-text-smoke.3mf'),
      Buffer.from(await result.blob.arrayBuffer()),
    );
  }, 30_000); // Audit every serialized mechanical triangle on shared CI CPUs.

  it.each<DesignId>(['drybox-tab', 'clip-label'])(
    'exports coherent geometry and material relationships for %s',
    async (design) => {
      const { zip, model, result } = await readModel(design);
      const meshes = await buildConfiguredMeshes(filament, design);
      const assemblyId = 2 + meshes.length;
      const settings =
        (await zip.file('Metadata/model_settings.config')?.async('string')) ??
        '';
      expect(result.filename).toMatch(/\.3mf$/);
      expect(zip.file('[Content_Types].xml')).not.toBeNull();
      expect(zip.file('_rels/.rels')).not.toBeNull();
      const project = JSON.parse(
        await zip.file('Metadata/project_settings.config')!.async('string'),
      );
      expect(project.printer_settings_id).toBe('Bambu Lab P1S 0.4 nozzle');
      expect(project.filament_settings_id).toEqual([
        'Bambu PLA Basic @BBL P1S 0.4 nozzle',
        'Bambu PLA Basic @BBL P1S 0.4 nozzle',
      ]);
      expect(project.filament_colour).toEqual(['#307FE2', '#000000']);
      expect(project.filament_type).toEqual(['PLA', 'PLA']);
      expect(project.filament_diameter).toEqual(['1.75', '1.75']);
      expect(model).toContain(
        '<metadata name="fll:generator">Filament Label Lab</metadata>',
      );
      expect(model).toContain(
        '<metadata name="Application">BambuStudio-02.08.02.61+FilamentLabelLab.0.1.0</metadata>',
      );
      expect(model).toContain(
        'actual generator is Filament Label Lab, not Bambu Studio',
      );
      expect(await zip.file('docProps/core.xml')!.async('string')).toContain(
        '<dc:creator>Filament Label Lab</dc:creator>',
      );
      expect(
        [...model.matchAll(/<m:color color="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ).toEqual(['#307FE2FF', '#000000FF']);
      expect(model).toContain(
        '<metadata name="fll:profile_colors">#307FE2FF,#54FF9BFF</metadata>',
      );
      const transform = model
        .match(/<build><item[^>]*transform="([^"]+)"/)?.[1]
        .split(' ')
        .map(Number);
      expect(transform?.slice(0, 9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const bounds = assemblyBounds(meshes);
      for (let axis = 0; axis < 2; axis++) {
        expect(
          (bounds.min[axis] + bounds.max[axis]) / 2 + transform![axis + 9],
        ).toBeCloseTo(128, 6);
      }
      expect(bounds.min[2] + transform![11]).toBe(0);
      expect(model).toContain(
        `<build><item objectid="${assemblyId}" transform=`,
      );
      expect(settings).toContain(`<object id="${assemblyId}">`);
      expect(settings).toContain(
        `<metadata key="object_id" value="${assemblyId}"/>`,
      );
      for (let index = 0; index < meshes.length; index++) {
        const part = meshes[index];
        const id = index + 2;
        const color = part.materialRole === 'raised-text' ? 1 : 0;
        const object =
          model.match(
            new RegExp(
              `<object id="${id}" name="${part.name}"[^>]*>([\\s\\S]*?)</object>`,
            ),
          )?.[1] ?? '';
        const settingsPart =
          settings.match(
            new RegExp(`<part id="${id}"[^>]*>([\\s\\S]*?)</part>`),
          )?.[1] ?? '';
        expect(model).toContain(`<component objectid="${id}"/>`);
        expect(settingsPart).toContain(`key="extruder" value="${color + 1}"`);
        expect(settingsPart).toContain(
          `face_count="${part.triangles.length / 3}"`,
        );
        const properties = [
          ...object.matchAll(/pid="(\d+)" p1="(\d+)" p2="(\d+)" p3="(\d+)"/g),
        ];
        expect(properties).toHaveLength(part.triangles.length / 3);
        expect(
          properties.every(
            (match) =>
              match[1] === '1' &&
              match.slice(2).every((value) => value === String(color)),
          ),
        ).toBe(true);
      }
      const metadata = JSON.parse(
        (await zip.file('Metadata/filament-label-lab.json')?.async('string')) ??
          '{}',
      );
      expect(metadata.slicingRequired).toBe(true);
      expect(
        metadata.materialRoles.find(
          (role: { role: string }) => role.role === 'raised-text',
        ).color,
      ).toBe('#000000');
      if (design === 'drybox-tab')
        expect(metadata.template.sourceSha256).toBe(
          SUPPLIED_DRYBOX.sourceSha256,
        );
    },
  );

  it('keeps new lettering closed, fully on the card, and attached at the original surface', async () => {
    const parts = await buildConfiguredMeshes(filament, 'drybox-tab');
    const lettering = parts.find(
      (part) => part.materialRole === 'raised-text',
    )!;
    const audit = auditMeshOnSerializedGrid(lettering);
    expect(audit.boundaryEdges).toEqual([]);
    expect(audit.degenerateTriangles).toEqual([]);
    expect(audit.duplicateTriangles).toEqual([]);
    expect(audit.nonManifoldEdges).toEqual([]);
    expect(audit.sameDirectionEdges).toEqual([]);
    expect(audit.componentVolumes6.every((volume) => volume > BigInt(0))).toBe(
      true,
    );
    const xs = lettering.vertices.filter((_, index) => index % 3 === 0);
    const ys = lettering.vertices.filter((_, index) => index % 3 === 1);
    const zs = lettering.vertices.filter((_, index) => index % 3 === 2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(3 - 0.0001);
    expect(Math.max(...xs)).toBeLessThanOrEqual(57 + 0.0001);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(3 - 0.0001);
    expect(Math.max(...ys)).toBeLessThanOrEqual(58 + 0.0001);
    expect(Math.min(...zs)).toBeCloseTo(SUPPLIED_DRYBOX.textFaceZ - 0.02, 5);
    expect(Math.max(...zs)).toBeCloseTo(SUPPLIED_DRYBOX.textFaceZ + 0.8, 5);
    expect(lettering.textRows?.every((row) => row.strokeAudit?.passes)).toBe(
      true,
    );
  });

  it('retains printable glyphs after serialization and physically intersects every glyph with the supplied card', async () => {
    const { model } = await readModel('drybox-tab');
    const textObject =
      model.match(/<object id="6"[^>]*>([\s\S]*?)<\/object>/)?.[1] ?? '';
    const vertices = [
      ...textObject.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
    ].flatMap((match) => match.slice(1).map(Number));
    const triangles = [
      ...textObject.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
    ].flatMap((match) => match.slice(1).map(Number));
    const runtime = await loadManifoldRuntime();
    const solid = new runtime.Manifold(
      new runtime.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(vertices),
        triVerts: Uint32Array.from(triangles),
      }),
    );
    const parts = await buildConfiguredMeshes(filament, 'drybox-tab');
    const card = parts.find((part) => part.name === 'label-card')!;
    const cardSolid = new runtime.Manifold(
      new runtime.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(card.vertices),
        triVerts: Uint32Array.from(card.triangles),
      }),
    );
    const section = solid.slice(3.6);
    try {
      const audit = auditTextStrokes(section, TEXT_PRINT_SPEC.lineWidth);
      expect(audit.passes).toBe(true);
      const expectedComponents = parts
        .find((part) => part.materialRole === 'raised-text')!
        .textRows!.reduce(
          (count, row) => count + row.strokeAudit!.components,
          0,
        );
      expect(audit.components).toBe(expectedComponents);
      for (const glyph of solid.decompose()) {
        const contact = glyph.intersect(cardSolid);
        try {
          const expectedVolume =
            (glyph.volume() /
              (TEXT_PRINT_SPEC.relief + TEXT_PRINT_SPEC.attachmentOverlap)) *
            TEXT_PRINT_SPEC.attachmentOverlap;
          expect(contact.volume() / expectedVolume).toBeGreaterThan(0.99);
          expect(contact.volume() / expectedVolume).toBeLessThan(1.01);
        } finally {
          contact.delete();
          glyph.delete();
        }
      }
    } finally {
      section.delete();
      solid.delete();
      cardSolid.delete();
    }
  });

  it.each(['spool-card', 'sample-chip'])(
    'rejects the removed %s design even for an untyped caller',
    async (design) => {
      await expect(
        buildConfiguredMeshes(filament, design as DesignId),
      ).rejects.toThrow('Unknown design.');
    },
  );
});
