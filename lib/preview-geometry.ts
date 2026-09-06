import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LabelMesh } from '@/lib/generate-3mf';
import {
  normalizeColor,
  type FilamentAppearance,
} from '@/lib/filament-appearance';

export function createPreviewMaterial(
  part: LabelMesh,
  appearance?: FilamentAppearance,
) {
  const color = normalizeColor(part.color);
  const alpha = Number.parseInt(color.slice(7, 9), 16) / 255;
  const isBody = part.materialRole === 'structure';
  const isClear = isBody && (appearance?.transparent || alpha === 0);
  const hasPalette = isBody && appearance && appearance.colors.length > 1;
  const silk = isBody && /silk/i.test(appearance?.product ?? '');
  return new THREE.MeshStandardMaterial({
    color: hasPalette ? '#ffffff' : isClear ? '#e2e7e5' : color.slice(0, 7),
    map: hasPalette ? createPaletteTexture(appearance) : null,
    opacity: isClear ? 0.38 : Math.max(alpha, 0.18),
    transparent: isClear || alpha < 1,
    roughness: silk ? 0.32 : isBody ? 0.72 : 0.48,
    metalness: silk ? 0.16 : 0.01,
    depthWrite: !isClear && alpha >= 1,
    side: THREE.FrontSide,
  });
}

/** A representative spool palette, not a painted multi-material mesh. */
export function createPaletteTexture(appearance: FilamentAppearance) {
  const count = 256;
  const data = new Uint8Array(count * 4);
  const palette = appearance.colors.map((color) =>
    normalizeColor(color)
      .slice(1)
      .match(/../g)!
      .map((value) => parseInt(value, 16)),
  );
  for (let index = 0; index < count; index++) {
    const phase = index / (count - 1);
    if (appearance.colorType === 'multi') {
      data.set(
        palette[
          Math.min(palette.length - 1, Math.floor(phase * palette.length))
        ],
        index * 4,
      );
    } else {
      const position = phase * (palette.length - 1);
      const lower = Math.floor(position),
        upper = Math.min(lower + 1, palette.length - 1);
      for (let channel = 0; channel < 4; channel++)
        data[index * 4 + channel] = Math.round(
          palette[lower][channel] +
            (palette[upper][channel] - palette[lower][channel]) *
              (position - lower),
        );
    }
  }
  const texture = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter =
    appearance.colorType === 'multi' ? THREE.NearestFilter : THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function setAppearanceCoordinates(
  geometry: THREE.BufferGeometry,
  bounds: THREE.Box3,
  type: FilamentAppearance['colorType'],
  verticalAxis: 'y' | 'z' = 'y',
) {
  const positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  const axis = type === 'multi' ? 'x' : verticalAxis;
  const length = Math.max(0.001, bounds.max[axis] - bounds.min[axis]);
  for (let index = 0; index < positions.count; index++) {
    const coordinate =
      axis === 'x'
        ? positions.getX(index)
        : axis === 'z'
          ? positions.getZ(index)
          : positions.getY(index);
    uv[index * 2] = (coordinate - bounds.min[axis]) / length;
    uv[index * 2 + 1] = 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * The generated mesh intentionally shares indexed vertices. Expanding it at
 * real creases keeps planar caps flat and rounded facets smooth without
 * averaging a cap normal into a vertical wall normal.
 */
export function geometryFromLabelMesh(
  part: LabelMesh,
  capAxis: 'y' | 'z' = 'z',
) {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(part.vertices, 3),
  );
  indexed.setIndex(part.triangles);
  const creased = toCreasedNormals(indexed, Math.PI / 6);
  if (creased !== indexed) indexed.dispose();
  // Large, nearly horizontal STL caps must not inherit neighboring bevel
  // normals at shared vertices. That interpolation creates diagonal patches
  // across an otherwise flat hook/card. Change normals only, never positions.
  const positions = creased.getAttribute('position');
  const normals = creased.getAttribute('normal');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 3) {
    a.fromBufferAttribute(positions, index);
    b.fromBufferAttribute(positions, index + 1).sub(a);
    c.fromBufferAttribute(positions, index + 2).sub(a);
    normal.crossVectors(b, c).normalize();
    if (Math.abs(normal[capAxis]) < 0.999) continue;
    for (let corner = 0; corner < 3; corner++) {
      normals.setXYZ(index + corner, normal.x, normal.y, normal.z);
    }
  }
  return creased;
}
