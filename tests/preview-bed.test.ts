import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  assemblyBounds,
  placeAssemblyOnBed,
  printBedLayout,
} from '../lib/build-plate';
import { createPreviewBed, previewModelPosition } from '../lib/preview-bed';
import { studioPrinterFor } from '../lib/studio-project';
import { DEFAULT_FILAMENT, PRINTERS, type DesignId } from '../lib/catalog';
import { buildConfiguredMeshes } from '../lib/generate-3mf';
import {
  fitPreviewCamera,
  PREVIEW_CAMERA_POSITIONS,
} from '../lib/preview-camera';

beforeEach(() => {
  // Textures contain only plate annotations; no browser or GPU is needed to
  // verify millimetre geometry, bounds, placement and resource ownership.
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillText: vi.fn() }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('printer-profile bed preview', () => {
  it('keeps the checker grid and outline below, hides solid surfaces, and restores them above', () => {
    const plate = createPreviewBed(studioPrinterFor('Bambu Lab X2D'), 'X2D');
    const camera = new THREE.OrthographicCamera();
    const model = new THREE.Group();
    model.position.set(10.25, 0, 0);
    const scene = new THREE.Scene();
    scene.add(model, plate.group);
    const children = [...plate.group.children];
    try {
      for (const [z, visible] of [
        [240, true],
        [-240, false],
        [0, false],
        [240, true],
      ] as const) {
        camera.position.set(75, -95, z);
        camera.lookAt(0, 0, 0);
        plate.updateView(camera);
        expect(plate.group.visible).toBe(true);
        for (const child of plate.group.children) {
          const isGrid = [
            '10 mm grid',
            '50 mm grid',
            'Printable boundary',
          ].includes(child.name);
          expect(child.visible, child.name || child.type).toBe(
            isGrid || visible,
          );
        }
        expect(plate.group.children).toEqual(children);
        expect(model.visible).toBe(true);
        expect(model.position.toArray()).toEqual([10.25, 0, 0]);
      }
    } finally {
      plate.dispose();
    }
  });

  it.each([
    ['Bambu Lab A1 mini', 180, 180],
    ['Bambu Lab P1S', 256, 256],
    ['Bambu Lab X2D', 256, 256],
    ['Bambu Lab H2D', 350, 320],
    ['Bambu Lab H2S', 340, 320],
  ] as const)('uses exact profile dimensions for %s', (name, width, depth) => {
    const plate = createPreviewBed(studioPrinterFor(name), name);
    try {
      const surface = plate.group.getObjectByName(
        'Printable area',
      ) as THREE.Mesh<THREE.PlaneGeometry>;
      expect(surface.geometry.parameters).toMatchObject({
        width,
        height: depth,
      });
      const bounds = new THREE.Box3().setFromObject(plate.group);
      expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(width + 12, 3);
      expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(depth + 32, 3);
      expect(bounds.max.z).toBeLessThan(0);
      expect(
        plate.group.getObjectByName(`${width} × ${depth} mm · 10 mm grid`),
      ).toBeDefined();
    } finally {
      plate.dispose();
    }
  });

  it('marks the X2D single-nozzle strip separately from the shared area', () => {
    const layout = printBedLayout(studioPrinterFor('Bambu Lab X2D'));
    expect(layout.common).toEqual({
      minX: 20.5,
      minY: 0,
      maxX: 256,
      maxY: 256,
    });
    expect(layout.restricted).toEqual([
      { minX: 0, minY: 0, maxX: 20.5, maxY: 256, kind: 'single-nozzle' },
    ]);
  });

  it('clips nozzle-wrapping exclusions to the bed without changing the source profile', () => {
    const bed = studioPrinterFor('Bambu Lab H2D');
    const before = structuredClone(bed);
    const { restricted } = printBedLayout(bed);
    expect(restricted).toEqual([
      { minX: 0, maxX: 25, minY: 0, maxY: 320, kind: 'single-nozzle' },
      { minX: 325, maxX: 350, minY: 0, maxY: 320, kind: 'single-nozzle' },
      { minX: 145, maxX: 256, minY: 310, maxY: 320, kind: 'excluded' },
    ]);
    expect(bed).toEqual(before);
  });

  it('keeps actual keep-out regions distinct and leaves unrestricted beds clear', () => {
    expect(
      printBedLayout(studioPrinterFor('Bambu Lab P1S')).restricted,
    ).toEqual([{ minX: 0, minY: 0, maxX: 18, maxY: 28, kind: 'excluded' }]);
    expect(
      printBedLayout(studioPrinterFor('Bambu Lab A1 mini')).restricted,
    ).toEqual([]);
  });

  it.each<DesignId>(['drybox-tab', 'clip-label'])(
    'matches exported placement and source orientation for %s on every printer',
    async (design) => {
      const parts = await buildConfiguredMeshes(DEFAULT_FILAMENT, design);
      const source = assemblyBounds(parts);
      for (const printer of PRINTERS) {
        const bed = studioPrinterFor(printer.fullName);
        const { bounds } = printBedLayout(bed);
        const position = previewModelPosition(parts, bed);
        const exported = placeAssemblyOnBed(parts, bed);
        expect(position.x + (bounds.minX + bounds.maxX) / 2).toBeCloseTo(
          exported.translation[0],
        );
        expect(position.y + (bounds.minY + bounds.maxY) / 2).toBeCloseTo(
          exported.translation[1],
        );
        expect(position.z).toBe(exported.translation[2]);
        expect(source.min[2] + position.z).toBe(0);
        // No rotation or scaling is needed: the source mesh rests directly on Z=0.
        expect(assemblyBounds(parts)).toEqual(source);
      }
    },
  );

  it('keeps both the model and plate in frame across all printer sizes', () => {
    for (const printer of PRINTERS) {
      const plate = createPreviewBed(
        studioPrinterFor(printer.fullName),
        printer.name,
      );
      try {
        for (const position of Object.values(PREVIEW_CAMERA_POSITIONS)) {
          for (const aspect of [0.5, 1.5, 4]) {
            const camera = new THREE.OrthographicCamera(
              -1,
              1,
              1,
              -1,
              0.1,
              1000,
            );
            camera.position.set(...position);
            camera.lookAt(0, 0, 0);
            const dimensions = plate.dimensions.clone();
            dimensions.z = 40;
            fitPreviewCamera(camera, dimensions, aspect);
            for (const x of [-1, 1])
              for (const y of [-1, 1])
                for (const z of [-1, 1]) {
                  const corner = new THREE.Vector3(x, y, z)
                    .multiply(dimensions)
                    .multiplyScalar(0.5)
                    .project(camera);
                  expect(Math.abs(corner.x)).toBeLessThan(1);
                  expect(Math.abs(corner.y)).toBeLessThan(1);
                  expect(Math.abs(corner.z)).toBeLessThan(1);
                }
          }
        }
      } finally {
        plate.dispose();
      }
    }
  });

  it('releases every plate geometry, material and annotation texture on replacement', () => {
    const plate = createPreviewBed(studioPrinterFor('Bambu Lab X2D'), 'X2D');
    const scene = new THREE.Scene();
    scene.add(plate.group);
    const disposed = vi.fn();
    let resourceCount = 0;
    plate.group.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)
      )
        return;
      object.geometry.addEventListener('dispose', disposed);
      resourceCount++;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        material.addEventListener('dispose', disposed);
        resourceCount++;
        if ('map' in material && material.map) {
          (material.map as THREE.Texture).addEventListener('dispose', disposed);
          resourceCount++;
        }
      }
    });
    plate.dispose();
    expect(disposed).toHaveBeenCalledTimes(resourceCount);
    expect(scene.children).toHaveLength(0);
  });
});
