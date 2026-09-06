import type { LabelMesh } from '@/lib/generate-3mf';

/** Source-specific, 75 micron bearing relief. The raw supplied asset is untouched. */
export const HINGE_CLEARANCE = {
  revision: 'bearing-relief-0.075mm-v2',
  filenameSuffix: 'hinge-r2',
  radialReliefMm: 0.075,
  socketRadiusMm: 1.4,
  pinRadiusMm: 1.3,
  qualification: 'physical print test pending',
} as const;

// The two links have mirrored spherical bearings: two sockets and two pins each.
// These centers/radii were measured from the hash-locked source STL, not inferred
// from its outer bounds. Fixed pins/sockets in the card and hook are not modified.
const BEARINGS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  'hinge-link-left': [
    [12.15, 1.4],
    [23.85, 1.3],
  ],
  'hinge-link-right': [
    [36.15, 1.3],
    [47.85, 1.4],
  ],
};
const MATCH_TOLERANCE = 0.00005; // Source Float32 tessellation error; NOT the relief.

export function relieveHingeBearings(part: LabelMesh): LabelMesh {
  const ends = BEARINGS[part.name];
  if (!ends) return part;
  const vertices = [...part.vertices];
  for (const [cx, radius] of ends) {
    for (const cy of [62.4, 66]) {
      let matches = 0;
      for (let i = 0; i < part.vertices.length; i += 3) {
        const dx = part.vertices[i] - cx;
        const dy = part.vertices[i + 1] - cy;
        const dz = part.vertices[i + 2] - 1.6;
        const distance = Math.hypot(dx, dy, dz);
        if (Math.abs(distance - radius) > MATCH_TOLERANCE) continue;
        // Enlarge the concave socket or reduce the convex pin by the radial relief
        // along its radial direction. Do not scale the whole link or assembly.
        const sign = radius === HINGE_CLEARANCE.socketRadiusMm ? 1 : -1;
        const scale = 1 + (sign * HINGE_CLEARANCE.radialReliefMm) / distance;
        vertices[i] = Math.fround(cx + dx * scale);
        vertices[i + 1] = Math.fround(cy + dy * scale);
        vertices[i + 2] = Math.fround(1.6 + dz * scale);
        matches++;
      }
      // Fail closed if this source-specific selection no longer describes the mesh.
      if (matches !== (radius === HINGE_CLEARANCE.socketRadiusMm ? 4033 : 4034))
        throw new Error('Unexpected source hinge bearing geometry');
    }
  }
  return { ...part, vertices };
}
