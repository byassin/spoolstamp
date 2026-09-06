import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { LabelMesh } from '../lib/generate-3mf';
import { DEFAULT_FILAMENT } from '../lib/catalog';
import { buildSuppliedDryBoxMeshes } from '../lib/supplied-drybox';
import {
  createPreviewMaterial,
  createPaletteTexture,
  geometryFromLabelMesh,
  setAppearanceCoordinates,
} from '../lib/preview-geometry';

const cube: LabelMesh = {
  name: 'cube',
  color: '#00AE42FF',
  materialRole: 'structure',
  vertices: [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ],
  triangles: [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ],
};

describe('preview geometry', () => {
  it('shows alpha colors without making the lettering translucent', () => {
    const body = createPreviewMaterial(
      { ...cube, color: '#ABCDEF80' },
      DEFAULT_FILAMENT,
    );
    const clear = createPreviewMaterial(
      { ...cube, color: '#00000000' },
      DEFAULT_FILAMENT,
    );
    const text = createPreviewMaterial(
      { ...cube, color: '#FFFFFFFF', materialRole: 'raised-text' },
      { ...DEFAULT_FILAMENT, transparent: true },
    );
    try {
      expect(body.opacity).toBeCloseTo(128 / 255);
      expect(body.transparent).toBe(true);
      expect(body.depthWrite).toBe(false);
      expect(clear.opacity).toBe(0.38);
      expect(text.opacity).toBe(1);
      expect(text.transparent).toBe(false);
    } finally {
      body.dispose();
      clear.dispose();
      text.dispose();
    }
  });

  it('uses all four palette colors for split and gradient textures', () => {
    const colors = ['#FF0000FF', '#00FF00FF', '#0000FFFF', '#FFFFFF80'];
    for (const colorType of ['multi', 'gradient'] as const) {
      const texture = createPaletteTexture({
        ...DEFAULT_FILAMENT,
        colors,
        colorType,
      });
      try {
        const data = texture.image.data as Uint8Array;
        const indices = [0, 85, 170, 255];
        expect(
          indices.map((index) =>
            Array.from(data.slice(index * 4, index * 4 + 4)),
          ),
        ).toEqual([
          [255, 0, 0, 255],
          [0, 255, 0, 255],
          [0, 0, 255, 255],
          [255, 255, 255, 128],
        ]);
        expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      } finally {
        texture.dispose();
      }
    }
  });

  it('applies representative palette coordinates without moving any model vertices', () => {
    const geometry = geometryFromLabelMesh(cube);
    const positions = geometry.getAttribute('position');
    const before = Array.from(positions.array);
    const bounds = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1),
    );
    try {
      for (const type of ['multi', 'gradient'] as const) {
        setAppearanceCoordinates(geometry, bounds, type);
        const uv = geometry.getAttribute('uv');
        for (let index = 0; index < positions.count; index++)
          expect(uv.getX(index)).toBe(
            type === 'multi' ? positions.getX(index) : positions.getY(index),
          );
        expect(Array.from(positions.array)).toEqual(before);
      }
    } finally {
      geometry.dispose();
    }
  });

  it('maps clip gradients along the upright label face rather than through its thickness', () => {
    const geometry = geometryFromLabelMesh(cube);
    try {
      const positions = geometry.getAttribute('position');
      setAppearanceCoordinates(
        geometry,
        new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)),
        'gradient',
        'z',
      );
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < positions.count; i++)
        expect(uv.getX(i)).toBe(positions.getZ(i));
    } finally {
      geometry.dispose();
    }
  });

  it('preserves triangle positions while splitting normals at hard edges', () => {
    const geometry = geometryFromLabelMesh(cube);
    try {
      expect(geometry.getIndex()).toBeNull();
      const positions = geometry.getAttribute('position');
      const normals = geometry.getAttribute('normal');
      expect(positions.count).toBe(cube.triangles.length);
      for (let index = 0; index < cube.triangles.length; index += 1) {
        const source = cube.triangles[index] * 3;
        expect(positions.getX(index)).toBe(Math.fround(cube.vertices[source]));
        expect(positions.getY(index)).toBe(
          Math.fround(cube.vertices[source + 1]),
        );
        expect(positions.getZ(index)).toBe(
          Math.fround(cube.vertices[source + 2]),
        );
      }

      for (let index = 0; index < positions.count; index += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, index);
        const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
        const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
        const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
        for (let corner = 0; corner < 3; corner += 1) {
          const normal = new THREE.Vector3().fromBufferAttribute(
            normals,
            index + corner,
          );
          expect(normal.dot(faceNormal)).toBeGreaterThan(0.99999);
        }
      }
    } finally {
      geometry.dispose();
    }
  });

  it('uses front-face rendering to respect the source triangle winding', () => {
    const material = createPreviewMaterial(cube);
    try {
      expect(material.side).toBe(THREE.FrontSide);
    } finally {
      material.dispose();
    }
  });

  it('keeps the supplied hook triangles unchanged and its flat cap normals independent of bevels', async () => {
    const hook = (await buildSuppliedDryBoxMeshes('#00AE42FF')).find(
      (part) => part.name === 'side-entry-mount',
    )!;
    const geometry = geometryFromLabelMesh(hook);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let capTriangles = 0;
    let mismatch = false;
    try {
      for (let index = 0; index < positions.count; index++) {
        const offset = hook.triangles[index] * 3;
        mismatch ||=
          positions.getX(index) !== hook.vertices[offset] ||
          positions.getY(index) !== hook.vertices[offset + 1] ||
          positions.getZ(index) !== hook.vertices[offset + 2];
        if (index % 3) continue;
        a.fromBufferAttribute(positions, index);
        b.fromBufferAttribute(positions, index + 1).sub(a);
        c.fromBufferAttribute(positions, index + 2).sub(a);
        const faceNormal = b.cross(c).normalize();
        if (Math.abs(faceNormal.z) < 0.999) continue;
        capTriangles++;
        for (let corner = 0; corner < 3; corner++) {
          const dot =
            normals.getX(index + corner) * faceNormal.x +
            normals.getY(index + corner) * faceNormal.y +
            normals.getZ(index + corner) * faceNormal.z;
          mismatch ||= dot < 0.99999;
        }
      }
      expect(positions.count).toBe(hook.triangles.length);
      expect(capTriangles).toBeGreaterThan(100);
      expect(mismatch).toBe(false);
    } finally {
      geometry.dispose();
    }
  });
});
